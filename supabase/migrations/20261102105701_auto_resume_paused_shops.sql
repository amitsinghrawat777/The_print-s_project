-- Paused shops start taking orders again the next morning (06:00 in the shop's
-- timezone), so an owner who pauses during a rush and forgets doesn't turn
-- customers away for days. The owner can still resume earlier by hand.

alter table public.shops add column resume_at timestamptz;

comment on column public.shops.resume_at is
  'When a paused shop starts taking orders again (set automatically when is_accepting turns false).';

-- Sets resume_at whenever the shop is paused and clears it when it is resumed.
-- Owners can't write resume_at themselves (no column grant); this trigger does.
-- The time is computed inline: owners have no USAGE on the private schema, so
-- the trigger must not call other private functions.
create function private.shops_before_update() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_local timestamp;
  v_morning timestamp;
begin
  if new.is_accepting is distinct from old.is_accepting then
    if new.is_accepting then
      new.resume_at := null;
    else
      v_local := now() at time zone new.timezone;
      v_morning := date_trunc('day', v_local) + interval '6 hours';
      if v_morning <= v_local then
        v_morning := v_morning + interval '1 day';
      end if;
      new.resume_at := v_morning at time zone new.timezone;
    end if;
  end if;
  return new;
end;
$$;

create trigger shops_before_update
  before update on public.shops
  for each row execute function private.shops_before_update();

-- Resumes every shop whose pause has run out. Called by pg_cron every 5 minutes.
create function private.resume_paused_shops() returns integer
language sql
set search_path = ''
as $$
  with resumed as (
    update public.shops s set is_accepting = true
    where not s.is_accepting and s.resume_at <= now()
    returning 1
  )
  select count(*)::integer from resumed;
$$;

revoke execute on function private.resume_paused_shops() from public, anon, authenticated;

-- Shops that are paused right now get a resume time too.
update public.shops s set resume_at =
  case
    when date_trunc('day', now() at time zone s.timezone) + interval '6 hours' > now() at time zone s.timezone
      then (date_trunc('day', now() at time zone s.timezone) + interval '6 hours') at time zone s.timezone
    else (date_trunc('day', now() at time zone s.timezone) + interval '1 day 6 hours') at time zone s.timezone
  end
where not s.is_accepting;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule('resume-paused-shops', '*/5 * * * *', 'select private.resume_paused_shops()');

-- The desktop app shows the pause (and the automatic resume) live.
alter publication supabase_realtime add table public.shops;
