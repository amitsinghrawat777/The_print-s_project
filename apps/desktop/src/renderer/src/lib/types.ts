import type { JobStatus, MixedColorMode, PaperSize, PrintPart, Sides } from '@prints/shared';

export interface Shop {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  is_accepting: boolean;
  duplex_available: boolean;
  mixed_color_mode: MixedColorMode;
  paper_sizes: PaperSize[];
  /** When a paused shop starts taking orders again by itself (6 am the next morning). */
  resume_at: string | null;
}

export interface JobFile {
  id: string;
  position: number;
  original_name: string;
  page_count: number | null;
  page_sequence: number[] | null;
  color_pages: number[];
  copies: number;
  sides: Sides;
  paper_size: PaperSize;
  price_paise: number | null;
  print_parts: PrintPart[];
}

export interface Job {
  id: string;
  token: string | null;
  status: JobStatus;
  customer_name: string | null;
  note: string | null;
  total_paise: number | null;
  paid_at_counter: boolean;
  created_at: string;
  submitted_at: string | null;
  printed_at: string | null;
  done_at: string | null;
  error: string | null;
  job_files: JobFile[];
}

export const SHOP_COLUMNS = 'id, name, slug, address, is_accepting, duplex_available, mixed_color_mode, paper_sizes, resume_at';

export const JOB_COLUMNS =
  'id, token, status, customer_name, note, total_paise, paid_at_counter, created_at, submitted_at, printed_at, done_at, error, ' +
  'job_files (id, position, original_name, page_count, page_sequence, color_pages, copies, sides, paper_size, price_paise, print_parts)';
