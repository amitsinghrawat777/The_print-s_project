-- Hardening from the Supabase security advisor (applied to the hosted project too).

-- Fix mutable search_path on the updated_at trigger function.
alter function public.touch_updated_at() set search_path = '';

-- Move the RLS helper out of the API-exposed schema so it can't be called via /rpc.
-- Policies reference the function by OID, so they keep working after the move.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.is_shop_owner(uuid) set schema private;
