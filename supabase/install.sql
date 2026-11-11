-- Run once in the Supabase SQL Editor. All objects are new and prefixed.
-- A name collision aborts the transaction instead of adopting an existing table.
begin;

create table public.qmargin_b74_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.qmargin_b74_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (char_length(slug) <= 120 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  tag text not null check (char_length(btrim(tag)) between 1 and 40),
  excerpt text not null check (char_length(btrim(excerpt)) between 1 and 500),
  body text not null check (char_length(btrim(body)) between 1 and 100000),
  published_on date not null default current_date,
  published boolean not null default false
);

create table public.qmargin_b74_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.qmargin_b74_posts (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  approved boolean not null default false
);

create index qmargin_b74_posts_public_order
  on public.qmargin_b74_posts (published_on desc, id desc) where published;
create index qmargin_b74_comments_post_order
  on public.qmargin_b74_comments (post_id, created_at, id);

alter table public.qmargin_b74_admins enable row level security;
alter table public.qmargin_b74_posts enable row level security;
alter table public.qmargin_b74_comments enable row level security;

revoke all on public.qmargin_b74_admins, public.qmargin_b74_posts,
  public.qmargin_b74_comments from public, anon, authenticated;
grant select on public.qmargin_b74_admins to authenticated;
grant select on public.qmargin_b74_posts, public.qmargin_b74_comments to anon, authenticated;
grant insert (slug, title, tag, excerpt, body, published_on, published),
      update (slug, title, tag, excerpt, body, published_on, published)
  on public.qmargin_b74_posts to authenticated;
grant insert (post_id, display_name, body) on public.qmargin_b74_comments to anon, authenticated;
grant update (approved), delete on public.qmargin_b74_comments to authenticated;

create policy qmargin_b74_own_admin_record on public.qmargin_b74_admins
  for select to authenticated using (
    user_id = (select auth.uid())
    and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true'
  );

create policy qmargin_b74_read_published on public.qmargin_b74_posts
  for select to anon, authenticated using (published);

create policy qmargin_b74_admin_read_posts on public.qmargin_b74_posts
  for select to authenticated using ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_admin_insert_posts on public.qmargin_b74_posts
  for insert to authenticated with check ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_admin_update_posts on public.qmargin_b74_posts
  for update to authenticated
  using ((select exists (select 1 from public.qmargin_b74_admins)))
  with check ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_read_approved on public.qmargin_b74_comments
  for select to anon, authenticated
  using (approved and exists (
    select 1 from public.qmargin_b74_posts p where p.id = post_id and p.published
  ));

create policy qmargin_b74_submit_comment on public.qmargin_b74_comments
  for insert to anon, authenticated
  with check (not approved and exists (
    select 1 from public.qmargin_b74_posts p where p.id = post_id and p.published
  ));

create policy qmargin_b74_admin_read_comments on public.qmargin_b74_comments
  for select to authenticated using ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_admin_update_comments on public.qmargin_b74_comments
  for update to authenticated
  using ((select exists (select 1 from public.qmargin_b74_admins)))
  with check ((select exists (select 1 from public.qmargin_b74_admins)));

create policy qmargin_b74_admin_delete_comments on public.qmargin_b74_comments
  for delete to authenticated using ((select exists (select 1 from public.qmargin_b74_admins)));

commit;

-- After creating or selecting an Auth user, copy its UUID and run separately.
-- insert into public.qmargin_b74_admins (user_id)
-- values ('PASTE_AUTH_USER_UUID_HERE'::uuid) on conflict do nothing;