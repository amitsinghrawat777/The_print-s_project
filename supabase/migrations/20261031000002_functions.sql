-- Business functions: status machine, tokens, job creation/submission, rate limits, expiry.
-- Functions that change data are SECURITY DEFINER and executable by service_role only.

-- ---------------------------------------------------------------------------
-- Job status machine (mirror of packages/shared/src/status.ts JOB_TRANSITIONS)
-- ---------------------------------------------------------------------------
create or replace function public.job_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select case p_from
    when 'draft'    then p_to in ('building', 'expired')
    when 'building' then p_to in ('new', 'failed', 'expired')
    when 'new'      then p_to in ('opened', 'printing', 'ready', 'done', 'expired')
    when 'opened'   then p_to in ('printing', 'ready', 'done', 'expired')
    when 'printing' then p_to in ('ready', 'opened', 'done', 'expired')
    when 'ready'    then p_to in ('done', 'printing', 'expired')
    when 'done'     then p_to in ('expired')
    when 'failed'   then p_to in ('building', 'expired')
    else false
  end;
$$;

create or replace function public.current_actor() returns text
language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('app.actor', true), ''),
    case (select auth.role())
      when 'authenticated' then 'owner'
      when 'service_role'  then 'system'
      else current_user::text
    end
  );
$$;

create or replace function public.jobs_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if not public.job_transition_allowed(old.status, new.status) then
      raise exception 'INVALID_TRANSITION: % -> %', old.status, new.status
        using errcode = 'PR422';
    end if;
    -- Shop owners may only move a job along the printing steps.
    if (select auth.role()) = 'authenticated'
       and new.status not in ('opened', 'printing', 'ready', 'done') then
      raise exception 'NOT_ALLOWED: owners cannot set status %', new.status
        using errcode = '42501';
    end if;
    new.status_changed_at := now();
    if new.status = 'ready' and new.printed_at is null then new.printed_at := now(); end if;
    if new.status = 'done' then new.done_at := now(); end if;
  end if;
  return new;
end $$;

create trigger jobs_status_guard before update on public.jobs
  for each row execute function public.jobs_before_update();

create or replace function public.jobs_log_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.job_events (job_id, from_status, to_status, actor)
    values (new.id, null, new.status, public.current_actor());
  elsif new.status is distinct from old.status then
    insert into public.job_events (job_id, from_status, to_status, actor, meta)
    values (new.id, old.status, new.status, public.current_actor(),
            case when new.error is not null then jsonb_build_object('error', new.error) end);
  end if;
  return null;
end $$;

create trigger jobs_events_ins after insert on public.jobs
  for each row execute function public.jobs_log_event();
create trigger jobs_events_upd after update on public.jobs
  for each row execute function public.jobs_log_event();

-- ---------------------------------------------------------------------------
-- Tokens: A1…A99, B1…B99 … Z99 (mirror of packages/shared/src/token.ts)
-- ---------------------------------------------------------------------------
create or replace function public.format_token(p_seq integer) returns text
language sql immutable set search_path = '' as $$
  select chr(65 + (((p_seq - 1) / 99) % 26)) || (((p_seq - 1) % 99) + 1)::text;
$$;

-- Next token for a shop; the counter resets every day in the shop's timezone.
-- The UPDATE row-locks the shop, so concurrent submits never share a token.
create or replace function public.assign_token(p_shop_id uuid, out token text, out token_date date)
language plpgsql security definer set search_path = '' as $$
declare
  v_seq integer;
begin
  update public.shops s
     set token_seq = case when s.token_seq_date = (now() at time zone s.timezone)::date
                          then s.token_seq + 1 else 1 end,
         token_seq_date = (now() at time zone s.timezone)::date
   where s.id = p_shop_id
  returning s.token_seq, s.token_seq_date into v_seq, token_date;
  if v_seq is null then
    raise exception 'SHOP_NOT_FOUND' using errcode = 'PR404';
  end if;
  token := public.format_token(v_seq);
end $$;

-- ---------------------------------------------------------------------------
-- create_job: a draft job + its secret, only for a shop that is accepting orders
-- ---------------------------------------------------------------------------
create or replace function public.create_job(p_slug text, p_token_hash text,
                                             out job_id uuid, out shop_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_accepting boolean;
begin
  select s.id, s.is_accepting into shop_id, v_accepting
    from public.shops s where s.slug = p_slug;
  if shop_id is null then
    raise exception 'SHOP_NOT_FOUND' using errcode = 'PR404';
  end if;
  if not v_accepting then
    raise exception 'SHOP_PAUSED' using errcode = 'PR409';
  end if;
  perform set_config('app.actor', 'customer', true);
  insert into public.jobs (shop_id) values (shop_id) returning id into job_id;
  insert into public.job_secrets (job_id, access_token_hash) values (job_id, p_token_hash);
end $$;

-- ---------------------------------------------------------------------------
-- submit_job: store the customer's choices + server-computed prices, assign a token,
-- and move the job to `building`. All or nothing.
--
-- p_files: [{ "fileId", "position", "pageSequence", "colorPages", "copies",
--             "sides", "paperSize", "pricePaise" }]
-- ---------------------------------------------------------------------------
create or replace function public.submit_job(
  p_job_id uuid,
  p_customer_name text,
  p_note text,
  p_total_paise integer,
  p_rates_snapshot jsonb,
  p_files jsonb,
  out token text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_job       public.jobs%rowtype;
  v_ready     integer;
  v_given     integer;
  v_updated   integer;
  v_date      date;
begin
  select * into v_job from public.jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'PR404';
  end if;
  if v_job.status <> 'draft' then
    raise exception 'JOB_NOT_DRAFT' using errcode = 'PR409';
  end if;

  select count(*) into v_ready
    from public.job_files f where f.job_id = p_job_id and f.status = 'ready';
  v_given := jsonb_array_length(p_files);
  if v_ready = 0 or v_given <> v_ready then
    raise exception 'FILES_MISMATCH: % ready, % submitted', v_ready, v_given
      using errcode = 'PR422';
  end if;

  -- Defence in depth: the API validates pages too, but never trust a caller.
  if exists (
    select 1
      from jsonb_to_recordset(p_files) as x("fileId" uuid, "pageSequence" integer[])
      join public.job_files f on f.id = x."fileId"
     where x."pageSequence" is null
        or cardinality(x."pageSequence") = 0
        or exists (select 1 from unnest(x."pageSequence") p where p < 1 or p > f.page_count)
  ) then
    raise exception 'BAD_PAGES' using errcode = 'PR422';
  end if;

  update public.job_files f
     set position      = x.position,
         page_sequence = x."pageSequence",
         color_pages   = coalesce(x."colorPages", '{}'),
         copies        = x.copies,
         sides         = x.sides,
         paper_size    = x."paperSize",
         price_paise   = x."pricePaise"
    from jsonb_to_recordset(p_files) as x(
           "fileId" uuid, position integer, "pageSequence" integer[], "colorPages" integer[],
           copies integer, sides text, "paperSize" text, "pricePaise" integer)
   where f.id = x."fileId" and f.job_id = p_job_id and f.status = 'ready';
  get diagnostics v_updated = row_count;
  if v_updated <> v_ready then
    raise exception 'FILES_MISMATCH' using errcode = 'PR422';
  end if;

  select t.token, t.token_date into token, v_date from public.assign_token(v_job.shop_id) t;

  perform set_config('app.actor', 'customer', true);
  update public.jobs j
     set status         = 'building',
         token          = submit_job.token,
         token_date     = v_date,
         customer_name  = p_customer_name,
         note           = nullif(p_note, ''),
         total_paise    = p_total_paise,
         rates_snapshot = p_rates_snapshot,
         submitted_at   = now()
   where j.id = p_job_id;
end $$;

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window). Returns true while the caller is under the limit.
-- ---------------------------------------------------------------------------
create or replace function public.hit_rate_limit(p_key text, p_window_seconds integer,
                                                 p_max integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return v_hits <= p_max;
end $$;

-- ---------------------------------------------------------------------------
-- Expiry: mark old jobs expired. The processor then deletes their files and sets
-- purged_at (see apps/processor cleanup).
--   draft  : 2 h after creation (customer walked away)
--   done   : 2 h after done
--   others : 24 h after creation
-- ---------------------------------------------------------------------------
create or replace function public.expire_jobs() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform set_config('app.actor', 'cron', true);
  update public.jobs j set status = 'expired'
   where (j.status = 'draft' and j.created_at < now() - interval '2 hours')
      or (j.status = 'done' and j.done_at < now() - interval '2 hours')
      or (j.status in ('building', 'new', 'opened', 'printing', 'ready', 'failed')
          and j.created_at < now() - interval '24 hours');
  get diagnostics v_count = row_count;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Execute privileges: data-changing functions are for the service role only.
-- ---------------------------------------------------------------------------
revoke all on function public.assign_token(uuid) from public, anon, authenticated;
revoke all on function public.create_job(text, text) from public, anon, authenticated;
revoke all on function public.submit_job(uuid, text, text, integer, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.hit_rate_limit(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.expire_jobs() from public, anon, authenticated;
revoke all on function public.jobs_log_event() from public, anon, authenticated;

grant execute on function public.assign_token(uuid) to service_role;
grant execute on function public.create_job(text, text) to service_role;
grant execute on function public.submit_job(uuid, text, text, integer, jsonb, jsonb)
  to service_role;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
grant execute on function public.expire_jobs() to service_role;
