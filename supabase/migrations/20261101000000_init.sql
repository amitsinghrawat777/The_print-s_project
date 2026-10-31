-- The Print's Project: MVP schema.
-- Customers never touch the database directly. The API and processor use the
-- service role. Shop owners (desktop app) use their own login and the RLS
-- policies at the bottom of this file.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  address text check (char_length(address) <= 200),
  is_accepting boolean not null default true,
  duplex_available boolean not null default false,
  -- see packages/shared/src/printPlan.ts
  mixed_color_mode text not null default 'single_pass'
    check (mixed_color_mode in ('single_pass', 'split')),
  paper_sizes text[] not null default '{A4}'
    check (cardinality(paper_sizes) >= 1 and paper_sizes <@ array['A4', 'A3', 'Legal', 'Letter']),
  timezone text not null default 'Asia/Kolkata',
  -- daily order tokens (A1…A99, B1…), see submit_job()
  token_seq integer not null default 0,
  token_seq_date date,
  created_at timestamptz not null default now()
);
create index shops_owner_id_idx on public.shops (owner_id);

-- Single-sided rates are per page, double-sided rates are per sheet.
create table public.shop_rates (
  shop_id uuid not null references public.shops (id) on delete cascade,
  paper_size text not null check (paper_size in ('A4', 'A3', 'Legal', 'Letter')),
  color_mode text not null check (color_mode in ('bw', 'color')),
  sides text not null check (sides in ('single', 'double')),
  price_paise integer not null check (price_paise between 0 and 100000),
  primary key (shop_id, paper_size, color_mode, sides)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- keep in sync with packages/shared/src/status.ts
  status text not null default 'draft' check (status in (
    'draft', 'building', 'new', 'opened', 'printing', 'ready', 'done', 'failed', 'expired'
  )),
  token text,
  -- sha256 of the customer's random access token; the token itself is never stored
  access_token_hash text not null,
  -- HMAC of the client IP, only for rate limiting
  client_ip_hash text,
  customer_name text check (char_length(customer_name) <= 40),
  note text check (char_length(note) <= 300),
  subtotal_paise integer check (subtotal_paise >= 0),
  rounding_paise integer,
  total_paise integer check (total_paise >= 0),
  -- the rate card used to price this order, so later rate changes never alter it
  rates_snapshot jsonb,
  paid_at_counter boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  printed_at timestamptz,
  done_at timestamptz,
  files_purged_at timestamptz,
  unique (id, shop_id)
);
create index jobs_shop_queue_idx on public.jobs (shop_id, status, created_at);
create index jobs_client_ip_idx on public.jobs (client_ip_hash, created_at)
  where client_ip_hash is not null;
create index jobs_unpurged_idx on public.jobs (created_at) where files_purged_at is null;

create table public.job_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  -- copied from the job so RLS and storage paths need no join
  shop_id uuid not null,
  position integer not null default 0,
  status text not null default 'pending_upload' check (status in (
    'pending_upload', 'uploaded', 'processing', 'ready', 'rejected'
  )),
  original_name text not null check (char_length(original_name) between 1 and 200),
  ext text not null,
  mime text not null,
  size_bytes integer not null check (size_bytes > 0),
  original_path text not null,
  -- normalized PDF used for preview and page count (same as original_path for PDFs)
  pdf_path text,
  page_count integer check (page_count > 0),
  -- print options, set on submit
  page_sequence integer[],
  color_pages integer[] not null default '{}',
  copies integer not null default 1 check (copies between 1 and 50),
  sides text not null default 'single' check (sides in ('single', 'double')),
  paper_size text not null default 'A4' check (paper_size in ('A4', 'A3', 'Legal', 'Letter')),
  price_paise integer check (price_paise >= 0),
  -- print-ready PDFs: [{kind, mixed, pages, path}], see shared PrintPart
  print_parts jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (job_id, shop_id) references public.jobs (id, shop_id) on delete cascade
);
create index job_files_job_id_idx on public.job_files (job_id, position);
create index job_files_shop_id_idx on public.job_files (shop_id);

create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor text not null,
  at timestamptz not null default now()
);
create index job_events_job_id_idx on public.job_events (job_id, at);
create index job_events_shop_id_idx on public.job_events (shop_id);

-- ---------------------------------------------------------------------------
-- Job status guard and audit log
-- ---------------------------------------------------------------------------

-- 'owner' for a logged-in shop owner, 'system' for the API/processor/cron.
create function private.current_actor() returns text
language sql stable
set search_path = ''
as $$
  select case nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    when 'authenticated' then 'owner'
    else 'system'
  end;
$$;

create function private.jobs_before_update() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  if new.status is distinct from old.status then
    -- keep in sync with JOB_TRANSITIONS in packages/shared/src/status.ts
    allowed := case old.status
      when 'draft' then array['building', 'expired']
      when 'building' then array['new', 'failed', 'expired']
      when 'new' then array['opened', 'printing', 'done', 'expired']
      when 'opened' then array['new', 'printing', 'ready', 'done', 'expired']
      when 'printing' then array['opened', 'ready', 'done', 'expired']
      when 'ready' then array['printing', 'done', 'expired']
      when 'failed' then array['building', 'expired']
      else array[]::text[]
    end;
    if not (new.status = any (allowed)) then
      raise exception 'Job cannot go from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;

    -- owners only move jobs around the queue; building and expiry are the system's job
    if private.current_actor() = 'owner'
       and not (new.status = any (array['new', 'opened', 'printing', 'ready', 'done'])) then
      raise exception 'Owners cannot set status %', new.status using errcode = 'insufficient_privilege';
    end if;

    if new.status = 'ready' and new.printed_at is null then
      new.printed_at := now();
    end if;
    if new.status = 'done' then
      new.done_at := now();
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger jobs_before_update
  before update on public.jobs
  for each row execute function private.jobs_before_update();

-- security definer: owners may not write job_events themselves
create function private.log_job_event() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.job_events (job_id, shop_id, from_status, to_status, actor)
    values (
      new.id,
      new.shop_id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      private.current_actor()
    );
  end if;
  return null;
end;
$$;

create trigger jobs_log_event
  after insert or update of status on public.jobs
  for each row execute function private.log_job_event();

create function private.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger job_files_touch
  before update on public.job_files
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RPCs for the API and processor (service role only)
-- ---------------------------------------------------------------------------

-- Atomically stores the customer's print options and price, assigns the daily
-- token and moves the job to 'building'. Raises NOT_EDITABLE, SHOP_PAUSED or
-- FILES_MISMATCH (the API maps these to HTTP errors).
create function public.submit_job(
  p_job_id uuid,
  p_customer_name text,
  p_note text,
  p_files jsonb,
  p_subtotal_paise integer,
  p_rounding_paise integer,
  p_total_paise integer,
  p_rates_snapshot jsonb
) returns table (token text, total_paise integer)
language plpgsql
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_shop public.shops%rowtype;
  v_today date;
  v_seq integer;
  v_token text;
  v_ready integer;
  v_matched integer;
begin
  select * into v_job from public.jobs j where j.id = p_job_id for update;
  if not found or v_job.status <> 'draft' then
    raise exception 'NOT_EDITABLE';
  end if;

  -- the submission must list exactly the job's ready files
  select count(*) into v_ready
  from public.job_files f where f.job_id = p_job_id and f.status = 'ready';

  update public.job_files f set
    position = x.position,
    page_sequence = x."pageSequence",
    color_pages = x."colorPages",
    copies = x.copies,
    sides = x.sides,
    paper_size = x."paperSize",
    price_paise = x."pricePaise"
  from jsonb_to_recordset(p_files) as x(
    "fileId" uuid, position integer, "pageSequence" integer[], "colorPages" integer[],
    copies integer, sides text, "paperSize" text, "pricePaise" integer
  )
  where f.id = x."fileId" and f.job_id = p_job_id and f.status = 'ready';
  get diagnostics v_matched = row_count;

  if v_matched <> v_ready or v_matched <> jsonb_array_length(p_files) then
    raise exception 'FILES_MISMATCH';
  end if;

  -- lock the shop row so two submits never get the same token
  select * into v_shop from public.shops s where s.id = v_job.shop_id for update;
  if not v_shop.is_accepting then
    raise exception 'SHOP_PAUSED';
  end if;

  v_today := (now() at time zone v_shop.timezone)::date;
  v_seq := case when v_shop.token_seq_date = v_today then v_shop.token_seq + 1 else 1 end;
  update public.shops s set token_seq = v_seq, token_seq_date = v_today where s.id = v_shop.id;
  -- A1…A99, B1…B99, … Z99, then wraps
  v_token := chr(65 + ((v_seq - 1) / 99) % 26) || (((v_seq - 1) % 99) + 1)::text;

  update public.jobs j set
    status = 'building',
    token = v_token,
    customer_name = p_customer_name,
    note = nullif(p_note, ''),
    subtotal_paise = p_subtotal_paise,
    rounding_paise = p_rounding_paise,
    total_paise = p_total_paise,
    rates_snapshot = p_rates_snapshot,
    submitted_at = now()
  where j.id = p_job_id;

  return query select v_token, p_total_paise;
end;
$$;

-- Jobs whose files should be deleted: done for 2h, drafts idle for 2h, or anything older than 24h.
create function public.jobs_to_purge(p_limit integer default 50)
returns table (id uuid, shop_id uuid, status text)
language sql stable
set search_path = ''
as $$
  select j.id, j.shop_id, j.status
  from public.jobs j
  where j.files_purged_at is null
    and (
      (j.status = 'done' and j.done_at < now() - interval '2 hours')
      or (j.status = 'draft' and j.created_at < now() - interval '2 hours')
      or j.created_at < now() - interval '24 hours'
    )
  order by j.created_at
  limit p_limit;
$$;

-- Marks jobs as purged after their storage objects are deleted.
create function public.mark_jobs_purged(p_job_ids uuid[]) returns void
language sql
set search_path = ''
as $$
  update public.jobs j set
    files_purged_at = now(),
    status = case when j.status in ('done', 'expired') then j.status else 'expired' end
  where j.id = any (p_job_ids);
$$;

revoke execute on function public.submit_job(uuid, text, text, jsonb, integer, integer, integer, jsonb)
  from public, anon, authenticated;
revoke execute on function public.jobs_to_purge(integer) from public, anon, authenticated;
revoke execute on function public.mark_jobs_purged(uuid[]) from public, anon, authenticated;
grant execute on function public.submit_job(uuid, text, text, jsonb, integer, integer, integer, jsonb)
  to service_role;
grant execute on function public.jobs_to_purge(integer) to service_role;
grant execute on function public.mark_jobs_purged(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Privileges and row level security (shop owners)
-- ---------------------------------------------------------------------------

alter table public.shops enable row level security;
alter table public.shop_rates enable row level security;
alter table public.jobs enable row level security;
alter table public.job_files enable row level security;
alter table public.job_events enable row level security;

revoke all on public.shops, public.shop_rates, public.jobs, public.job_files, public.job_events
  from anon, authenticated;

grant select on public.shops to authenticated;
grant insert (name, slug, address, duplex_available, mixed_color_mode, paper_sizes, timezone)
  on public.shops to authenticated;
grant update (name, address, is_accepting, duplex_available, mixed_color_mode, paper_sizes, timezone)
  on public.shops to authenticated;
grant select, insert, update, delete on public.shop_rates to authenticated;
grant select on public.jobs to authenticated;
grant update (status, paid_at_counter) on public.jobs to authenticated;
grant select on public.job_files to authenticated;
grant select on public.job_events to authenticated;

create policy "owners read their shops" on public.shops
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "owners create their shops" on public.shops
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "owners update their shops" on public.shops
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "owners manage their rates" on public.shop_rates
  for all to authenticated
  using (shop_id in (select s.id from public.shops s where s.owner_id = (select auth.uid())))
  with check (shop_id in (select s.id from public.shops s where s.owner_id = (select auth.uid())));

-- owners never see drafts: those are still being edited by the customer
create policy "owners read their submitted jobs" on public.jobs
  for select to authenticated
  using (
    status <> 'draft'
    and shop_id in (select s.id from public.shops s where s.owner_id = (select auth.uid()))
  );
create policy "owners update their jobs" on public.jobs
  for update to authenticated
  using (
    status <> 'draft'
    and shop_id in (select s.id from public.shops s where s.owner_id = (select auth.uid()))
  )
  with check (shop_id in (select s.id from public.shops s where s.owner_id = (select auth.uid())));

create policy "owners read their job files" on public.job_files
  for select to authenticated
  using (
    shop_id in (select s.id from public.shops s where s.owner_id = (select auth.uid()))
    and job_id in (select j.id from public.jobs j where j.status <> 'draft')
  );

create policy "owners read their job events" on public.job_events
  for select to authenticated
  using (shop_id in (select s.id from public.shops s where s.owner_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Storage: one private bucket, objects under {shop_id}/{job_id}/...
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'jobs', 'jobs', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

-- Owners can read (and create signed URLs for) files of their own shops.
-- Uploads and deletes only happen through the service role.
create policy "owners read their shop files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'jobs'
    and (storage.foldername(name))[1] in (
      select s.id::text from public.shops s where s.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime: the desktop app subscribes to its shop's jobs
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.jobs;
