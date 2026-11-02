import type { ApiErrorCode, SubmitJobBody } from '@prints/shared';
import type { CreateJobResponse, JobFileView, JobView, PublicShop, RegisterFileResponse } from '../types';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, opts: { token?: string; method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { 'x-job-token': opts.token } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK', 'No internet connection. Check your network and try again.');
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error;
    throw new ApiRequestError(res.status, err?.code ?? 'INTERNAL', err?.message ?? 'Something went wrong', err?.details);
  }
  return json as T;
}

export const api = {
  shop: (slug: string) => request<{ shop: PublicShop }>(`/api/shops/${slug}`).then((r) => r.shop),
  createJob: (slug: string) => request<CreateJobResponse>('/api/jobs', { method: 'POST', body: { slug } }),
  job: (jobId: string, token: string) => request<{ job: JobView }>(`/api/jobs/${jobId}`, { token }).then((r) => r.job),
  registerFile: (jobId: string, token: string, file: { name: string; size: number }) =>
    request<RegisterFileResponse>(`/api/jobs/${jobId}/files`, { token, method: 'POST', body: file }),
  completeFile: (jobId: string, token: string, fileId: string) =>
    request<{ file: JobFileView }>(`/api/jobs/${jobId}/files/${fileId}/complete`, { token, method: 'POST' }).then(
      (r) => r.file,
    ),
  deleteFile: (jobId: string, token: string, fileId: string) =>
    request<void>(`/api/jobs/${jobId}/files/${fileId}`, { token, method: 'DELETE' }),
  submit: (jobId: string, token: string, body: SubmitJobBody) =>
    request<{ job: JobView }>(`/api/jobs/${jobId}/submit`, { token, method: 'POST', body }).then((r) => r.job),
};

/** PUTs a file straight to storage through a signed URL, reporting progress (0–1). */
export function uploadFile(
  url: string,
  file: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', contentType);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status}). Please try again.`));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
}
