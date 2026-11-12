-- Run once after install.sql. Existing journal records and project settings are untouched.
begin;

create table public.qmargin_b74_media (
  id uuid primary key default gen_random_uuid(),
  encoded text not null check (
    char_length(encoded) between 1 and 1333336
    and char_length(encoded) % 4 = 0
    and encoded ~ '^[A-Za-z0-9+/]+={0,2}$'
  ),
  width integer not null check (width between 1 and 1800),
  height integer not null check (height between 1 and 1800)
);

create table public.qmargin_b74_photos (
  month date primary key check (extract(day from month) = 1),
  media_id uuid not null references public.qmargin_b74_media (id),
  alt text not null check (char_length(btrim(alt)) between 1 and 200),
  caption text not null default '' check (char_length(caption) <= 240)
);
create index qmargin_b74_photos_media on public.qmargin_b74_photos (media_id);

create table public.qmargin_b74_privacy_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.qmargin_b74_media enable row level security;
alter table public.qmargin_b74_photos enable row level security;
alter table public.qmargin_b74_privacy_requests enable row level security;

revoke all on public.qmargin_b74_media, public.qmargin_b74_photos,
  public.qmargin_b74_privacy_requests from public, anon, authenticated;

grant select on public.qmargin_b74_media, public.qmargin_b74_photos to anon, authenticated;
grant insert (encoded, width, height) on public.qmargin_b74_media to authenticated;
grant insert (month, media_id, alt, caption), update (month, media_id, alt, caption)
  on public.qmargin_b74_photos to authenticated;
grant insert (email, message) on public.qmargin_b74_privacy_requests to anon, authenticated;
grant select, delete on public.qmargin_b74_privacy_requests to authenticated;

create policy qmargin_b74_public_photo on public.qmargin_b74_photos
  for select to anon, authenticated using (month <= date_trunc('month', timezone('Asia/Kolkata', now()))::date);

create policy qmargin_b74_admin_read_photos on public.qmargin_b74_photos
  for select to authenticated using ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_admin_insert_photos on public.qmargin_b74_photos
  for insert to authenticated with check ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_admin_update_photos on public.qmargin_b74_photos
  for update to authenticated
  using ((select exists (select 1 from public.qmargin_b74_admins)))
  with check ((select exists (select 1 from public.qmargin_b74_admins)));

-- Editorial uploads stay private until referenced in a published entry or a visible monthly photo.
create policy qmargin_b74_public_media on public.qmargin_b74_media
  for select to anon, authenticated using (
    exists (
      select 1 from public.qmargin_b74_photos photo
      where photo.media_id = qmargin_b74_media.id
        and photo.month <= date_trunc('month', timezone('Asia/Kolkata', now()))::date
    )
    or exists (
      select 1 from public.qmargin_b74_posts post
      where post.published
        and starts_with(post.body, '<!-- common-hours-markdown -->')
        and strpos(post.body, '](media:' || qmargin_b74_media.id::text || ')') > 0
    )
  );

create policy qmargin_b74_admin_read_media on public.qmargin_b74_media
  for select to authenticated using ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_admin_upload_media on public.qmargin_b74_media
  for insert to authenticated with check ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_send_privacy_request on public.qmargin_b74_privacy_requests
  for insert to anon, authenticated with check (true);

create policy qmargin_b74_admin_read_privacy_requests on public.qmargin_b74_privacy_requests
  for select to authenticated using ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_admin_delete_privacy_requests on public.qmargin_b74_privacy_requests
  for delete to authenticated using ((select exists (select 1 from public.qmargin_b74_admins)));

notify pgrst, 'reload schema';
commit;