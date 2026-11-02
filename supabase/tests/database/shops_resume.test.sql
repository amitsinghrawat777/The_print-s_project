-- Run with: npx supabase test db
-- Paused shops resume automatically the next morning.
begin;
select plan(9);

-- The owner pauses from the desktop app. Runs as the owner first: PL/pgSQL
-- caches resolved names per session, which would otherwise hide missing privileges.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ update public.shops set is_accepting = false where id = '22222222-2222-4222-8222-222222222222' $$,
  'owner can pause their shop'
);
select isnt(
  (select resume_at from public.shops where id = '22222222-2222-4222-8222-222222222222'), null,
  'pausing sets a resume time'
);
select is(
  (select to_char(resume_at at time zone 'Asia/Kolkata', 'HH24:MI') from public.shops where id = '22222222-2222-4222-8222-222222222222'),
  '06:00',
  'it resumes at 6 am shop time'
);
select ok(
  (select resume_at > now() and resume_at <= now() + interval '24 hours' from public.shops where id = '22222222-2222-4222-8222-222222222222'),
  'that is the next 6 am, within a day'
);
select throws_ok(
  $$ update public.shops set resume_at = now() + interval '30 days' where id = '22222222-2222-4222-8222-222222222222' $$,
  '42501', null,
  'owner cannot set the resume time directly'
);

reset role;
select is(private.resume_paused_shops(), 0, 'nothing resumes before the time');

-- the night passes
update public.shops set resume_at = now() - interval '1 minute' where id = '22222222-2222-4222-8222-222222222222';
select is(private.resume_paused_shops(), 1, 'the shop resumes once the time has passed');
select is(
  (select row(is_accepting, resume_at)::text from public.shops where id = '22222222-2222-4222-8222-222222222222'),
  '(t,)',
  'it is taking orders again and the resume time is cleared'
);

select is(
  (select schedule from cron.job where jobname = 'resume-paused-shops'),
  '*/5 * * * *',
  'pg_cron runs the resume job every 5 minutes'
);

select * from finish();
rollback;
