-- Apply after install.sql and add-editorial-features.sql in the journal project.
begin;

create table public.qmargin_b74_weekly_photos (
  id uuid primary key default gen_random_uuid(),
  week date not null check (extract(isodow from week) = 1),
  media_id uuid not null references public.qmargin_b74_media (id),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  alt text not null check (char_length(btrim(alt)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  featured boolean not null default true,
  created_at timestamptz not null default now()
);

create index qmargin_b74_weekly_order on public.qmargin_b74_weekly_photos (week desc, created_at, id);
create index qmargin_b74_weekly_media on public.qmargin_b74_weekly_photos (media_id);

alter table public.qmargin_b74_weekly_photos enable row level security;
revoke all on public.qmargin_b74_weekly_photos from public, anon, authenticated;
grant select on public.qmargin_b74_weekly_photos to anon, authenticated;
grant insert (id, week, media_id, title, alt, description, featured),
  update (title, alt, description, featured) on public.qmargin_b74_weekly_photos to authenticated;

create policy qmargin_b74_public_weekly_photos on public.qmargin_b74_weekly_photos
  for select to anon, authenticated
  using (week <= (select date_trunc('week', timezone('Asia/Kolkata', now()))::date));

create policy qmargin_b74_admin_read_weekly_photos on public.qmargin_b74_weekly_photos
  for select to authenticated using ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_admin_add_weekly_photos on public.qmargin_b74_weekly_photos
  for insert to authenticated with check ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_admin_edit_weekly_photos on public.qmargin_b74_weekly_photos
  for update to authenticated
  using ((select exists (select 1 from public.qmargin_b74_admins)))
  with check ((select exists (select 1 from public.qmargin_b74_admins)));

-- The earlier policies still authorize media in published posts and monthly photos.
create policy qmargin_b74_public_weekly_media on public.qmargin_b74_media
  for select to anon, authenticated using (
    exists (
      select 1 from public.qmargin_b74_weekly_photos photo
      where photo.media_id = qmargin_b74_media.id
        and photo.week <= (select date_trunc('week', timezone('Asia/Kolkata', now()))::date)
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qmargin-b74-attachments', 'qmargin-b74-attachments', false, 26214400, array['application/octet-stream']);

create policy qmargin_b74_editor_upload_attachments on storage.objects
  for insert to authenticated with check (
    bucket_id = 'qmargin-b74-attachments'
    and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    and (select exists (select 1 from public.qmargin_b74_admins))
  );

create policy qmargin_b74_editor_read_attachments on storage.objects
  for select to authenticated using (
    bucket_id = 'qmargin-b74-attachments'
    and (select exists (select 1 from public.qmargin_b74_admins))
  );

create policy qmargin_b74_public_read_attachments on storage.objects
  for select to anon, authenticated using (
    bucket_id = 'qmargin-b74-attachments'
    and storage.allow_any_operation(array['object.get_authenticated', 'object.get_authenticated_info'])
    and exists (
      select 1 from public.qmargin_b74_posts post
      where post.published
        and starts_with(post.body, '<!-- common-hours-markdown -->')
        and strpos(post.body, '](attachment:' || storage.objects.name || ')') > 0
    )
  );

notify pgrst, 'reload schema';
commit;
