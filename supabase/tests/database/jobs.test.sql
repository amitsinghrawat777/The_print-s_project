-- Run with: npx supabase test db
begin;
select plan(22);

-- Fixtures (as the service role / postgres): a second owner with their own shop,
-- and helpers that create a draft job with one ready file in the demo shop.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
        'authenticated', 'authenticated', 'other@demo.test', '', now(), now());
insert into public.shops (id, owner_id, name, slug)
values ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'Other Shop', 'other-shop');

create function pg_temp.new_draft() returns uuid language plpgsql as $$
declare v_job uuid;
begin
  insert into public.jobs (shop_id, access_token_hash)
  values ('22222222-2222-4222-8222-222222222222', 'hash') returning id into v_job;
  insert into public.job_files (job_id, shop_id, status, original_name, ext, mime, size_bytes, original_path, pdf_path, page_count)
  values (v_job, '22222222-2222-4222-8222-222222222222', 'ready', 'a.pdf', 'pdf', 'application/pdf', 10, 'x', 'x', 3);
  return v_job;
end $$;

create function pg_temp.files_for(p_job uuid) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'fileId', f.id, 'position', 0, 'pageSequence', '[1,2,3]'::jsonb, 'colorPages', '[2]'::jsonb,
    'copies', 1, 'sides', 'single', 'paperSize', 'A4', 'pricePaise', 1400))
  from public.job_files f where f.job_id = p_job;
$$;

create function pg_temp.submit(p_job uuid) returns text language sql as $$
  select token from public.submit_job(p_job, 'Ravi', '', pg_temp.files_for(p_job), 1400, 0, 1400, '[]');
$$;

create temp table t (name text primary key, job uuid);
grant all on t to authenticated;
insert into t values ('a', pg_temp.new_draft()), ('b', pg_temp.new_draft()), ('draft', pg_temp.new_draft());

-- submit_job: tokens, prices, options
select is(pg_temp.submit((select job from t where name = 'a')), 'A1', 'first order of the day gets A1');
select is(pg_temp.submit((select job from t where name = 'b')), 'A2', 'second order gets A2');
select is((select status from public.jobs where id = (select job from t where name = 'a')), 'building', 'submitted job is building');
select is((select total_paise from public.jobs where id = (select job from t where name = 'a')), 1400, 'total is stored');
select is((select page_sequence from public.job_files where job_id = (select job from t where name = 'a')), array[1,2,3], 'page sequence is stored');
select throws_ok(format('select pg_temp.submit(%L)', (select job from t where name = 'a')), 'NOT_EDITABLE', 'cannot submit twice');

select throws_ok(
  format($q$select public.submit_job(%L, 'X', '', '[]', 0, 0, 0, '[]')$q$, (select job from t where name = 'draft')),
  'FILES_MISMATCH', 'submission must include every ready file');

update public.shops set token_seq_date = token_seq_date - 1 where id = '22222222-2222-4222-8222-222222222222';
insert into t values ('c', pg_temp.new_draft());
select is(pg_temp.submit((select job from t where name = 'c')), 'A1', 'tokens restart each day');

update public.shops set token_seq = 99 where id = '22222222-2222-4222-8222-222222222222';
insert into t values ('d', pg_temp.new_draft());
select is(pg_temp.submit((select job from t where name = 'd')), 'B1', 'after A99 comes B1');

update public.shops set is_accepting = false where id = '22222222-2222-4222-8222-222222222222';
select throws_ok(format('select pg_temp.submit(%L)', (select job from t where name = 'draft')), 'SHOP_PAUSED', 'paused shop refuses orders');
update public.shops set is_accepting = true where id = '22222222-2222-4222-8222-222222222222';

-- status guard
select throws_ok(
  format($q$update public.jobs set status = 'done' where id = %L$q$, (select job from t where name = 'a')),
  '23514', null, 'building cannot jump to done');
update public.jobs set status = 'new' where id in (select job from t where name in ('a', 'b'));
select is(
  (select array_agg(to_status order by at, id) from public.job_events where job_id = (select job from t where name = 'a')),
  array['draft', 'building', 'new'], 'every status change is logged');

-- the owner, through RLS
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.jobs where id in (select job from t)), 4, 'owner sees submitted jobs');
select is((select count(*)::int from public.jobs where id = (select job from t where name = 'draft')), 0, 'owner does not see drafts');
select is((select count(*)::int from public.job_files where job_id = (select job from t where name = 'a')), 1, 'owner sees files of submitted jobs');

update public.jobs set status = 'opened', paid_at_counter = true where id = (select job from t where name = 'a');
select is((select status from public.jobs where id = (select job from t where name = 'a')), 'opened', 'owner can move a job along the queue');

select throws_ok(
  format($q$update public.jobs set status = 'expired' where id = %L$q$, (select job from t where name = 'b')),
  '42501', null, 'owner cannot expire jobs');
select throws_ok(
  format($q$update public.jobs set total_paise = 0 where id = %L$q$, (select job from t where name = 'b')),
  '42501', null, 'owner cannot change the price');
select throws_ok($q$insert into public.job_events (job_id, shop_id, to_status, actor) values (gen_random_uuid(), gen_random_uuid(), 'x', 'x')$q$,
  '42501', null, 'owner cannot write the audit log');

reset role;
select is(
  (select actor from public.job_events where job_id = (select job from t where name = 'a') order by id desc limit 1),
  'owner', 'owner actions are attributed to the owner');

-- a different owner sees nothing of the demo shop
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.jobs), 0, 'other owners see no jobs');
reset role;

-- anonymous clients have no table access at all
set local role anon;
select throws_ok('select * from public.jobs', '42501', null, 'anon cannot read jobs');
reset role;

select * from finish();
rollback;
