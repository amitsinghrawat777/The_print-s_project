import { priceJob, PricingError, submitJobBody, type FilePrintOptions } from '@prints/shared';
import { ApiError, parseBody, requireDraft, requireJob, route } from '@/lib/server/api';
import { db } from '@/lib/server/db';
import { notifyProcessor } from '@/lib/server/processor';
import { loadFiles, loadShopById, shopRates, toJobView } from '@/lib/server/views';

const RPC_ERRORS: Record<string, ApiError> = {
  NOT_EDITABLE: new ApiError(409, 'NOT_EDITABLE', 'This order has already been sent'),
  SHOP_PAUSED: new ApiError(409, 'SHOP_PAUSED', "This shop isn't taking online orders right now"),
  FILES_MISMATCH: new ApiError(409, 'FILES_NOT_READY', 'Your files changed. Please check your order again.'),
};

/**
 * Sends the order to the shop. The price is recalculated here from the real
 * page counts and the shop's current rates; the browser's total is only
 * used to detect that the customer saw a different price.
 */
export const POST = route(async (req, ctx: RouteContext<'/api/jobs/[jobId]/submit'>) => {
  const { jobId } = await ctx.params;
  const job = await requireJob(req, jobId);
  requireDraft(job);
  const body = await parseBody(req, submitJobBody);

  const [shop, files] = await Promise.all([loadShopById(job.shop_id), loadFiles(job.id)]);
  if (!shop.is_accepting) throw RPC_ERRORS.SHOP_PAUSED!;

  if (files.some((f) => f.status !== 'ready' && f.status !== 'rejected')) {
    throw new ApiError(409, 'FILES_NOT_READY', 'Some files are still uploading or being prepared');
  }
  const ready = new Map(files.filter((f) => f.status === 'ready').map((f) => [f.id, f]));
  if (ready.size === 0) throw new ApiError(400, 'BAD_REQUEST', 'Add at least one file');
  if (body.files.length !== ready.size || body.files.some((f) => !ready.has(f.fileId))) {
    throw RPC_ERRORS.FILES_MISMATCH!;
  }

  const options: FilePrintOptions[] = body.files.map((f) => {
    const file = ready.get(f.fileId)!;
    const pageCount = file.page_count!;
    const outside = [...f.pageSequence, ...f.colorPages].find((p) => p > pageCount);
    if (outside !== undefined) {
      throw new ApiError(400, 'BAD_REQUEST', `"${file.original_name}" has no page ${outside}`);
    }
    if (f.sides === 'double' && !shop.duplex_available) {
      throw new ApiError(400, 'BAD_REQUEST', "This shop can't print on both sides");
    }
    if (!shop.paper_sizes.includes(f.paperSize)) {
      throw new ApiError(400, 'BAD_REQUEST', `This shop doesn't stock ${f.paperSize} paper`);
    }
    return {
      pageSequence: f.pageSequence,
      colorPages: [...new Set(f.colorPages)].sort((a, b) => a - b),
      copies: f.copies,
      sides: f.sides,
      paperSize: f.paperSize,
    };
  });

  const rates = shopRates(shop);
  let price;
  try {
    price = priceJob(options, rates);
  } catch (error) {
    if (error instanceof PricingError) throw new ApiError(400, 'BAD_REQUEST', error.message);
    throw error;
  }
  if (price.totalPaise !== body.clientTotalPaise) {
    throw new ApiError(409, 'PRICE_CHANGED', 'The price has changed. Please check the new total.', {
      totalPaise: price.totalPaise,
    });
  }

  const { error } = await db().rpc('submit_job', {
    p_job_id: job.id,
    p_customer_name: body.customerName,
    p_note: body.note,
    p_files: body.files.map((f, index) => ({
      ...options[index],
      fileId: f.fileId,
      position: index,
      pricePaise: price.files[index]!.pricePaise,
    })),
    p_subtotal_paise: price.subtotalPaise,
    p_rounding_paise: price.roundingPaise,
    p_total_paise: price.totalPaise,
    p_rates_snapshot: rates,
  });
  if (error) {
    const known = RPC_ERRORS[error.message];
    if (known) throw known;
    throw error;
  }

  await notifyProcessor('/build-job', { jobId: job.id });
  const submitted = await requireJob(req, jobId);
  return Response.json({ job: await toJobView(submitted, shop) });
});
