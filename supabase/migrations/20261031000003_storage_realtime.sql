-- Private file bucket + owner read policy, and Realtime for the desktop queue.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'jobs', 'jobs', false, 26214400,  -- 25 MiB, matches MAX_FILE_BYTES
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Customers upload through signed upload URLs issued by the API (no policy needed).
-- Owners may read (and create signed URLs for) objects under their own shop's folder:
--   jobs/{shop_id}/{job_id}/...
create policy "jobs bucket: owners read own shop"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'jobs'
    and exists (
      select 1 from public.shops s
       where s.id::text = (storage.foldername(objects.name))[1]
         and s.owner_id = (select auth.uid())
    )
  );

-- Realtime: the desktop app subscribes to changes on its shop's jobs (RLS applies).
alter publication supabase_realtime add table public.jobs;
