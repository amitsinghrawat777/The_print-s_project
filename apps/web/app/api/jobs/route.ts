import { createJobBody } from '@prints/shared';
import { ApiError, clientIpHash, newAccessToken, parseBody, route } from '@/lib/server/api';
import { db } from '@/lib/server/db';
import { loadShopBySlug } from '@/lib/server/views';
import type { CreateJobResponse } from '@/lib/types';

const JOBS_PER_IP = 10;
const WINDOW_MINUTES = 10;

/** Starts a draft order when the customer adds their first file. */
export const POST = route(async (req) => {
  const { slug } = await parseBody(req, createJobBody);
  const shop = await loadShopBySlug(slug);
  if (!shop) throw new ApiError(404, 'NOT_FOUND', 'Shop not found');
  if (!shop.is_accepting) {
    throw new ApiError(409, 'SHOP_PAUSED', "This shop isn't taking online orders right now");
  }

  const ipHash = clientIpHash(req);
  if (ipHash) {
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const { count, error } = await db()
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('client_ip_hash', ipHash)
      .gte('created_at', since);
    if (error) throw error;
    if ((count ?? 0) >= JOBS_PER_IP) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many orders from this device. Please wait a few minutes.');
    }
  }

  const { token, hash } = newAccessToken();
  const { data, error } = await db()
    .from('jobs')
    .insert({ shop_id: shop.id, access_token_hash: hash, client_ip_hash: ipHash })
    .select('id')
    .single();
  if (error) throw error;

  const body: CreateJobResponse = { jobId: data.id, accessToken: token };
  return Response.json(body, { status: 201 });
});
