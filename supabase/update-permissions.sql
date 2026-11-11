-- Apply only if you installed the earlier version. Keep the same tables and rows.
begin;

revoke insert, update on public.qmargin_b74_posts from authenticated;
grant insert (slug, title, tag, excerpt, body, published_on, published),
      update (slug, title, tag, excerpt, body, published_on, published)
  on public.qmargin_b74_posts to authenticated;

alter policy qmargin_b74_own_admin_record on public.qmargin_b74_admins
  using (
    user_id = (select auth.uid())
    and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true'
  );

commit;