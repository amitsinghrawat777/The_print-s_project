/** Limits shared by the web app, API and processor. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_JOB = 10;
export const MAX_PAGES_PER_FILE = 500;
export const MAX_COPIES = 50;
/** Upper bound on pages printed per copy of one file (e.g. "1-500,1-500" is rejected). */
export const MAX_SEQUENCE_LENGTH = 1000;
export const MAX_CUSTOMER_NAME = 40;
export const MAX_NOTE = 300;

export const STORAGE_BUCKET = 'jobs';

export type FileKind = 'pdf' | 'image' | 'office';

export interface AcceptedFileType {
  ext: string;
  mime: string;
  kind: FileKind;
}

const TYPES: AcceptedFileType[] = [
  { ext: 'pdf', mime: 'application/pdf', kind: 'pdf' },
  { ext: 'jpg', mime: 'image/jpeg', kind: 'image' },
  { ext: 'jpeg', mime: 'image/jpeg', kind: 'image' },
  { ext: 'png', mime: 'image/png', kind: 'image' },
  { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'office' },
  { ext: 'doc', mime: 'application/msword', kind: 'office' },
  { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'office' },
  { ext: 'ppt', mime: 'application/vnd.ms-powerpoint', kind: 'office' },
  { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'office' },
  { ext: 'xls', mime: 'application/vnd.ms-excel', kind: 'office' },
];

export const ACCEPTED_FILE_TYPES: readonly AcceptedFileType[] = TYPES;

/** Value for `<input type="file" accept>`. */
export const ACCEPT_ATTRIBUTE = [
  ...new Set(TYPES.flatMap((t) => [`.${t.ext}`, t.mime])),
].join(',');

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Looks a file type up by its name. The processor re-checks the real bytes. */
export function fileTypeFromName(name: string): AcceptedFileType | null {
  const ext = fileExtension(name);
  return TYPES.find((t) => t.ext === ext) ?? null;
}

export function fileTypeFromExtension(ext: string): AcceptedFileType | null {
  return TYPES.find((t) => t.ext === ext.toLowerCase()) ?? null;
}
