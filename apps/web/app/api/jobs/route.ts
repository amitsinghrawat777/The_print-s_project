import { CreateJobBody, type CreateJobResponse } from "@print/shared";
import { db } from "@/lib/server/db";
import { fromDbError, handler, json, parseBody } from "@/lib/server/http";
import { rateLimit, rateLimitByIp } from "@/lib/server/rateLimit";
import { newAccessToken } from "@/lib/server/tokens";

/** Start a draft order at a shop. Returns the job id and its secret access token. */
export const POST = handler(async (req: Request) => {
  const { slug } = await parseBody(req, CreateJobBody);
  await rateLimitByIp(req, "create-job", 20, 600);
  await rateLimit("create-job-shop", slug, 500, 600);

  const { token, hash } = await newAccessToken();
  const { data, error } = await db()
    .rpc("create_job", { p_slug: slug, p_token_hash: hash })
    .single<{ job_id: string; shop_id: string }>();
  if (error || !data) throw fromDbError(error ?? { message: "no row" });

  return json<CreateJobResponse>({ jobId: data.job_id, accessToken: token }, 201);
});
