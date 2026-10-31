import 'server-only';
import { CUSTOMER_STATUS_LABEL, type JobStatus, type PaperSize, type Rate } from '@prints/shared';
import type { JobFileView, JobView, PublicShop } from '../types';
import type { JobRow } from './api';
import { bucket, db } from './db';

export interface ShopRow {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  is_accepting: boolean;
  duplex_available: boolean;
  paper_sizes: PaperSize[];
  shop_rates: { paper_size: PaperSize; color_mode: Rate['colorMode']; sides: Rate['sides']; price_paise: number }[];
}

const SHOP_COLUMNS =
  'id, slug, name, address, is_accepting, duplex_available, paper_sizes, shop_rates(paper_size, color_mode, sides, price_paise)';

export async function loadShopBySlug(slug: string): Promise<ShopRow | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const { data, error } = await db().from('shops').select(SHOP_COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data as ShopRow | null;
}

export async function loadShopById(id: string): Promise<ShopRow> {
  const { data, error } = await db().from('shops').select(SHOP_COLUMNS).eq('id', id).single();
  if (error) throw error;
  return data as ShopRow;
}

export function shopRates(shop: ShopRow): Rate[] {
  return shop.shop_rates.map((r) => ({
    paperSize: r.paper_size,
    colorMode: r.color_mode,
    sides: r.sides,
    pricePaise: r.price_paise,
  }));
}

export function toPublicShop(shop: ShopRow): PublicShop {
  return {
    slug: shop.slug,
    name: shop.name,
    address: shop.address,
    isAccepting: shop.is_accepting,
    duplexAvailable: shop.duplex_available,
    paperSizes: shop.paper_sizes,
    rates: shopRates(shop),
  };
}

export interface FileRow {
  id: string;
  job_id: string;
  shop_id: string;
  position: number;
  status: JobFileView['status'];
  original_name: string;
  ext: string;
  size_bytes: number;
  original_path: string;
  pdf_path: string | null;
  page_count: number | null;
  page_sequence: number[] | null;
  color_pages: number[];
  copies: number;
  sides: JobFileView['sides'];
  paper_size: PaperSize;
  price_paise: number | null;
  error: string | null;
}

const FILE_COLUMNS =
  'id, job_id, shop_id, position, status, original_name, ext, size_bytes, original_path, pdf_path, page_count, page_sequence, color_pages, copies, sides, paper_size, price_paise, error';

export async function loadFiles(jobId: string): Promise<FileRow[]> {
  const { data, error } = await db()
    .from('job_files')
    .select(FILE_COLUMNS)
    .eq('job_id', jobId)
    .order('position')
    .order('created_at');
  if (error) throw error;
  return data as FileRow[];
}

export async function loadFile(jobId: string, fileId: string): Promise<FileRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const { data, error } = await db()
    .from('job_files')
    .select(FILE_COLUMNS)
    .eq('job_id', jobId)
    .eq('id', fileId)
    .maybeSingle();
  if (error) throw error;
  return data as FileRow | null;
}

const PREVIEW_TTL_SECONDS = 15 * 60;

export async function toFileView(file: FileRow, withPreview: boolean): Promise<JobFileView> {
  let previewUrl: string | null = null;
  if (withPreview && file.status === 'ready' && file.pdf_path) {
    const { data } = await bucket().createSignedUrl(file.pdf_path, PREVIEW_TTL_SECONDS);
    previewUrl = data?.signedUrl ?? null;
  }
  return {
    id: file.id,
    name: file.original_name,
    status: file.status,
    sizeBytes: file.size_bytes,
    pageCount: file.page_count,
    error: file.error,
    previewUrl,
    pageSequence: file.page_sequence,
    colorPages: file.color_pages,
    copies: file.copies,
    sides: file.sides,
    paperSize: file.paper_size,
    pricePaise: file.price_paise,
  };
}

export async function toJobView(job: JobRow, shop: Pick<ShopRow, 'name' | 'slug'>): Promise<JobView> {
  const files = await loadFiles(job.id);
  const isDraft = job.status === 'draft';
  const status = job.status as JobStatus;
  return {
    id: job.id,
    status,
    statusLabel: CUSTOMER_STATUS_LABEL[status],
    token: job.token,
    customerName: job.customer_name,
    note: job.note,
    subtotalPaise: job.subtotal_paise,
    roundingPaise: job.rounding_paise,
    totalPaise: job.total_paise,
    createdAt: job.created_at,
    submittedAt: job.submitted_at,
    shop: { name: shop.name, slug: shop.slug },
    // after submitting, rejected files are left out of the order
    files: await Promise.all(
      files.filter((f) => isDraft || f.status === 'ready').map((f) => toFileView(f, isDraft)),
    ),
  };
}
