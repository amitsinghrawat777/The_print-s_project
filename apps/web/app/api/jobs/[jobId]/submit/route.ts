import {
  PricingError,
  SubmitJobBody,
  isValidSequence,
  priceJob,
  type SubmitJobResponse,
} from "@print/shared";
import { db } from "@/lib/server/db";
import { HttpError, fromDbError, handler, json, parseBody } from "@/lib/server/http";
import { loadFiles, requireDraft, requireJob } from "@/lib/server/jobs";
import { notifyProcessor } from "@/lib/server/processor";
import { loadRates } from "@/lib/server/shops";

/**
 * Send the order to the shop. The server re-validates every choice against the real
 * page counts, prices it with the shop's current rate card (shared/pricing) and
 * rejects the submit if that differs from the price the customer saw.
 */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ jobId: string }> }) => {
  const { jobId } = await ctx.params;
  const job = await requireJob(req, jobId);
  requireDraft(job);
  if (!job.shops.is_accepting) {
    throw new HttpError(409, "This shop isn't taking orders right now.", "SHOP_PAUSED");
  }
  const body = await parseBody(req, SubmitJobBody);

  const files = await loadFiles(jobId);
  if (files.some((f) => ["pending_upload", "uploaded", "processing"].includes(f.status))) {
    throw new HttpError(409, "Please wait until all files have finished uploading.", "NOT_READY");
  }
  const ready = new Map(files.filter((f) => f.status === "ready").map((f) => [f.id, f]));
  const given = new Set(body.files.map((f) => f.fileId));
  if (ready.size === 0) throw new HttpError(422, "Add at least one file.", "NO_FILES");
  if (given.size !== body.files.length || given.size !== ready.size || [...given].some((id) => !ready.has(id))) {
    throw new HttpError(422, "Your files changed. Please refresh the page.", "FILES_MISMATCH");
  }
  const positions = new Set(body.files.map((f) => f.position));
  if (positions.size !== body.files.length) {
    throw new HttpError(422, "Invalid file order.", "BAD_ORDER");
  }

  for (const sel of body.files) {
    const pageCount = ready.get(sel.fileId)!.page_count ?? 0;
    const name = ready.get(sel.fileId)!.original_name;
    if (!isValidSequence(sel.pageSequence, pageCount)) {
      throw new HttpError(422, `${name}: choose pages between 1 and ${pageCount}.`, "BAD_PAGES");
    }
    if (sel.colorPages.some((p) => p > pageCount)) {
      throw new HttpError(422, `${name}: colour pages must be between 1 and ${pageCount}.`, "BAD_PAGES");
    }
    if (sel.sides === "double" && !job.shops.duplex_available) {
      throw new HttpError(422, "This shop can't print double sided.", "NO_DUPLEX");
    }
  }

  const rates = await loadRates(job.shop_id, job.shops.duplex_available);
  let price;
  try {
    price = priceJob(body.files, rates);
  } catch (err) {
    if (err instanceof PricingError) throw new HttpError(422, err.message, "PRICING");
    throw err;
  }
  if (price.totalPaise !== body.clientTotalPaise) {
    throw new HttpError(409, "The shop's prices just changed. Please check the new total.", "PRICE_CHANGED", {
      totalPaise: price.totalPaise,
    });
  }

  const { data, error } = await db().rpc("submit_job", {
    p_job_id: jobId,
    p_customer_name: body.customerName,
    p_note: body.note ?? "",
    p_total_paise: price.totalPaise,
    p_rates_snapshot: rates,
    p_files: body.files.map((f, i) => ({
      fileId: f.fileId,
      position: f.position,
      pageSequence: f.pageSequence,
      colorPages: [...new Set(f.colorPages)].sort((a, b) => a - b),
      copies: f.copies,
      sides: f.sides,
      paperSize: f.paperSize,
      pricePaise: price.files[i]!.totalPaise,
    })),
  });
  if (error) throw fromDbError(error);
  // A single OUT parameter may come back as a scalar or as { token } depending on PostgREST.
  const token = typeof data === "string" ? data : (data as { token?: unknown } | null)?.token;
  if (typeof token !== "string") {
    console.error("[submit] unexpected submit_job result", data);
    throw new HttpError(500, "Order saved, but something went wrong. Please refresh.");
  }

  await notifyProcessor("/build-job", { jobId });
  return json<SubmitJobResponse>({ token, totalPaise: price.totalPaise });
});
