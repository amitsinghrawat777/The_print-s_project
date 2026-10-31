/** Upload rules shared by the web app (early feedback) and the API/processor (enforcement). */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_JOB = 10;
export const MAX_PAGES_PER_FILE = 500;

export type FileKind = "pdf" | "image" | "office";

export interface AllowedType {
  mime: string;
  ext: string;
  kind: FileKind;
  label: string;
}

export const ALLOWED_TYPES: readonly AllowedType[] = [
  { mime: "application/pdf", ext: "pdf", kind: "pdf", label: "PDF" },
  { mime: "image/jpeg", ext: "jpg", kind: "image", label: "JPG" },
  { mime: "image/png", ext: "png", kind: "image", label: "PNG" },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: "docx",
    kind: "office",
    label: "Word",
  },
  { mime: "application/msword", ext: "doc", kind: "office", label: "Word (old)" },
  {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: "pptx",
    kind: "office",
    label: "PowerPoint",
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
    kind: "office",
    label: "Excel",
  },
];

/** Value for an <input type="file" accept="..."> attribute. */
export const ACCEPT_ATTRIBUTE = ALLOWED_TYPES.flatMap((t) => [t.mime, `.${t.ext}`])
  .concat(".jpeg")
  .join(",");

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  const ext = fileName.slice(dot + 1).toLowerCase();
  return ext === "jpeg" ? "jpg" : ext;
}

/** Looks up a type by file extension (browsers often send a wrong or empty MIME). */
export function typeForFileName(fileName: string): AllowedType | undefined {
  const ext = extensionOf(fileName);
  return ALLOWED_TYPES.find((t) => t.ext === ext);
}

export function typeForMime(mime: string): AllowedType | undefined {
  return ALLOWED_TYPES.find((t) => t.mime === mime);
}

export type FileCheck = { ok: true; type: AllowedType } | { ok: false; error: string };

export function checkUpload(fileName: string, sizeBytes: number): FileCheck {
  const type = typeForFileName(fileName);
  if (!type) {
    return {
      ok: false,
      error: `This file type isn't supported. Use ${ALLOWED_TYPES.map((t) => t.label)
        .filter((l, i, a) => a.indexOf(l) === i && !l.includes("old"))
        .join(", ")}.`,
    };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { ok: false, error: "File is empty" };
  if (sizeBytes > MAX_FILE_BYTES) {
    return { ok: false, error: `File is too big (max ${MAX_FILE_BYTES / 1024 / 1024} MB)` };
  }
  return { ok: true, type };
}

/** Keeps a display-safe file name: strips paths/control chars, caps length. */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  if (clean.length <= 120) return clean || "file";
  const ext = extensionOf(clean);
  return `${clean.slice(0, 110)}….${ext}`;
}
