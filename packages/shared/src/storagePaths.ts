/**
 * Object paths inside the private `jobs` bucket (see ARCHITECTURE.md §5).
 * The first segment is always the shop id; storage RLS policies rely on that.
 */
export const JOBS_BUCKET = "jobs";

export const storagePaths = {
  original: (shopId: string, jobId: string, fileId: string, ext: string) =>
    `${shopId}/${jobId}/original/${fileId}.${ext}`,
  pdf: (shopId: string, jobId: string, fileId: string) => `${shopId}/${jobId}/pdf/${fileId}.pdf`,
  printBw: (shopId: string, jobId: string, fileId: string) =>
    `${shopId}/${jobId}/print/${fileId}-bw.pdf`,
  printColor: (shopId: string, jobId: string, fileId: string) =>
    `${shopId}/${jobId}/print/${fileId}-color.pdf`,
  jobPrefix: (shopId: string, jobId: string) => `${shopId}/${jobId}`,
};
