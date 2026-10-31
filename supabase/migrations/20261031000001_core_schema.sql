-- The Print's Project — core schema (see ARCHITECTURE.md §4).
-- Money is integer paise. Status values mirror packages/shared/src/status.ts.

-- ---------------------------------------------------------------------------
-- Shops and rate cards
-- ---------------------------------------------------------------------------
create table public.shops (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 80),
  slug              text not null unique
                    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  is_accepting      boolean not null default true,
  duplex_available  boolean not null default false,
  mixed_color_mode  text not null default 'split'
                    check (mixed_color_mode in ('split', 'single_pass')),
  timezone          text not null default 'Asia/Kolkata',
  token_seq         integer not null default 0,
  token_seq_date    date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index shops_owner_id_idx on public.shops (owner_id);

create table public.shop_rates (
  shop_id      uuid not null references public.shops (id) on delete cascade,
  paper_size   text not null check (paper_size in ('A4', 'A3', 'Legal')),
  color_mode   text not null check (color_mode in ('bw', 'color')),
  sides        text not null check (sides in ('single', 'double')),
  -- per page for single sided, per sheet for double sided
  price_paise  integer not null check (price_paise between 0 and 100000),
  primary key (shop_id, paper_size, color_mode, sides)
);

-- ---------------------------------------------------------------------------
-- Jobs (one customer order) and their files
-- ---------------------------------------------------------------------------
create table public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops (id) on delete cascade,
  status             text not null default 'draft'
                     check (status in ('draft', 'building', 'new', 'opened', 'printing',
                                       'ready', 'done', 'failed', 'expired')),
  token              text,                        -- "A47", unique per shop per day
  token_date         date,
  customer_name      text check (char_length(customer_name) <= 40),
  note               text check (char_length(note) <= 300),
  total_paise        integer check (total_paise >= 0),
  rates_snapshot     jsonb,                       -- rate card used to price this order
  paid_at_counter    boolean not null default false,
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  status_changed_at  timestamptz not null default now(),
  submitted_at       timestamptz,
  printed_at         timestamptz,
  done_at            timestamptz,
  purged_at          timestamptz                  -- storage objects deleted
);
create index jobs_shop_status_idx on public.jobs (shop_id, status, created_at desc);
create index jobs_status_created_idx on public.jobs (status, created_at);
create unique index jobs_shop_token_uniq on public.jobs (shop_id, token_date, token)
  where token is not null;

-- The customer's job secret lives in its own table so owners, who can read jobs,
-- never see it. Only the service role (public API) touches this table.
create table public.job_secrets (
  job_id             uuid primary key references public.jobs (id) on delete cascade,
  access_token_hash  text not null              -- sha256 hex of the customer's job secret
);

create table public.job_files (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs (id) on delete cascade,
  shop_id            uuid not null references public.shops (id) on delete cascade,
  position           integer not null default 0,
  status             text not null default 'pending_upload'
                     check (status in ('pending_upload', 'uploaded', 'processing',
                                       'ready', 'rejected')),
  original_name      text not null check (char_length(original_name) <= 255),
  kind               text not null check (kind in ('pdf', 'image', 'office')),
  ext                text not null check (ext ~ '^[a-z0-9]{1,5}$'),
  mime               text not null,
  size_bytes         integer not null check (size_bytes > 0),
  original_path      text not null,
  pdf_path           text,
  page_count         integer check (page_count > 0),
  error              text,
  -- customer's choices, written at submit
  page_sequence      integer[],
  color_pages        integer[],
  copies             integer check (copies between 1 and 100),
  sides              text check (sides in ('single', 'double')),
  paper_size         text check (paper_size in ('A4', 'A3', 'Legal')),
  price_paise        integer check (price_paise >= 0),
  -- print-ready output, written by the processor's build step
  print_mode         text check (print_mode in ('split', 'single_pass')),
  bw_print_path      text,
  bw_print_pages     integer,
  color_print_path   text,
  color_print_pages  integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index job_files_job_idx on public.job_files (job_id, position);
create index job_files_shop_idx on public.job_files (shop_id);

create table public.job_events (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.jobs (id) on delete cascade,
  from_status  text,
  to_status    text not null,
  actor        text not null,
  meta         jsonb,
  at           timestamptz not null default now()
);
create index job_events_job_idx on public.job_events (job_id, at);

-- Fixed-window rate limiting for the public API (keys are hashed, never raw IPs).
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger shops_touch before update on public.shops
  for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();
create trigger job_files_touch before update on public.job_files
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges + Row Level Security
--
-- Customers never use the database directly: the public API (service role) does it
-- for them. So `anon` gets nothing. Shop owners (`authenticated`) see only their shops.
-- ---------------------------------------------------------------------------
alter table public.shops       enable row level security;
alter table public.shop_rates  enable row level security;
alter table public.jobs        enable row level security;
alter table public.job_files   enable row level security;
alter table public.job_events  enable row level security;
alter table public.rate_limits enable row level security;
alter table public.job_secrets enable row level security;

revoke all on public.shops, public.shop_rates, public.jobs, public.job_files,
              public.job_events, public.rate_limits, public.job_secrets
  from anon, authenticated;

-- Helper used by policies: is the current user the owner of this shop?
create or replace function public.is_shop_owner(p_shop_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shops s where s.id = p_shop_id and s.owner_id = (select auth.uid())
  );
$$;
revoke all on function public.is_shop_owner(uuid) from public, anon;
grant execute on function public.is_shop_owner(uuid) to authenticated;

-- shops: owners read their shops, create one for themselves, and edit settings
-- (not slug/owner/token counters).
grant select, insert on public.shops to authenticated;
grant update (name, is_accepting, duplex_available, mixed_color_mode, timezone)
  on public.shops to authenticated;
create policy shops_owner_select on public.shops for select to authenticated
  using (owner_id = (select auth.uid()));
create policy shops_owner_insert on public.shops for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy shops_owner_update on public.shops for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- shop_rates: owners manage their rate card.
grant select, insert, update, delete on public.shop_rates to authenticated;
create policy rates_owner_all on public.shop_rates for all to authenticated
  using (public.is_shop_owner(shop_id)) with check (public.is_shop_owner(shop_id));

-- jobs: owners read their shop's jobs and may only change status + paid flag
-- (which statuses is enforced by the transition trigger).
grant select on public.jobs to authenticated;
grant update (status, paid_at_counter) on public.jobs to authenticated;
create policy jobs_owner_select on public.jobs for select to authenticated
  using (public.is_shop_owner(shop_id));
create policy jobs_owner_update on public.jobs for update to authenticated
  using (public.is_shop_owner(shop_id)) with check (public.is_shop_owner(shop_id));

-- job_files / job_events: read-only for owners.
grant select on public.job_files to authenticated;
create policy job_files_owner_select on public.job_files for select to authenticated
  using (public.is_shop_owner(shop_id));

grant select on public.job_events to authenticated;
create policy job_events_owner_select on public.job_events for select to authenticated
  using (exists (select 1 from public.jobs j
                 where j.id = job_events.job_id and public.is_shop_owner(j.shop_id)));
