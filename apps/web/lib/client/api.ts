"use client";

import {
  JOB_TOKEN_HEADER,
  type CreateJobResponse,
  type JobView,
  type RegisterFileResponse,
  type SubmitJobBody,
  type SubmitJobResponse,
} from "@print/shared";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// ---- Job credentials (kept in this browser for 24h) ----

interface StoredJob {
  jobId: string;
  accessToken: string;
  savedAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode etc. — the page still works for this visit */
  }
}

const memory = new Map<string, StoredJob>();

export const jobStore = {
  /** The current draft order for a shop, if any. */
  draftFor(slug: string): StoredJob | null {
    return jobStore.read(`draft:${slug}`);
  },
  setDraft(slug: string, job: StoredJob | null) {
    jobStore.write(`draft:${slug}`, job);
    if (job) jobStore.write(`job:${job.jobId}`, job);
  },
  tokenFor(jobId: string): string | null {
    return jobStore.read(`job:${jobId}`)?.accessToken ?? null;
  },
  read(key: string): StoredJob | null {
    const raw = safeGet(`print:${key}`);
    const job = raw ? (JSON.parse(raw) as StoredJob) : (memory.get(key) ?? null);
    if (job && Date.now() - job.savedAt > DAY_MS) {
      jobStore.write(key, null);
      return null;
    }
    return job;
  },
  write(key: string, job: StoredJob | null) {
    if (job) memory.set(key, job);
    else memory.delete(key);
    safeSet(`print:${key}`, job ? JSON.stringify(job) : null);
  },
};

// ---- HTTP ----

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.token) headers.set(JOB_TOKEN_HEADER, init.token);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiRequestError(0, "No internet connection. Please try again.");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      typeof data.error === "string" ? data.error : "Something went wrong.",
      typeof data.code === "string" ? data.code : undefined,
      data,
    );
  }
  return data as T;
}

export const api = {
  createJob: (slug: string) =>
    request<CreateJobResponse>("/api/jobs", { method: "POST", body: JSON.stringify({ slug }) }),

  getJob: (jobId: string, token: string) => request<JobView>(`/api/jobs/${jobId}`, { token }),

  registerFile: (jobId: string, token: string, file: File) =>
    request<RegisterFileResponse>(`/api/jobs/${jobId}/files`, {
      method: "POST",
      token,
      body: JSON.stringify({ name: file.name, size: file.size, mime: file.type || undefined }),
    }),

  completeFile: (jobId: string, token: string, fileId: string) =>
    request<{ ok: true }>(`/api/jobs/${jobId}/files/${fileId}/complete`, { method: "POST", token }),

  deleteFile: (jobId: string, token: string, fileId: string) =>
    request<{ ok: true }>(`/api/jobs/${jobId}/files/${fileId}`, { method: "DELETE", token }),

  submit: (jobId: string, token: string, body: SubmitJobBody) =>
    request<SubmitJobResponse>(`/api/jobs/${jobId}/submit`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
    }),
};

/** PUTs the bytes to the signed storage URL, reporting progress 0..1. */
export function uploadToSignedUrl(
  url: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiRequestError(xhr.status, "Upload failed. Please try again."));
    };
    xhr.onerror = () => reject(new ApiRequestError(0, "Upload failed — check your internet."));
    xhr.send(file);
  });
}
