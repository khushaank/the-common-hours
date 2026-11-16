-- Run as postgres after the earlier harden-legacy.sql.
-- Separate anonymous policies from account-only helpers. No new grants or data changes.
begin;
set local lock_timeout = '5s';

alter policy qmargin_b74_blog_read_boundary on public.blogs to authenticated;
alter policy qmargin_b74_blog_insert_boundary on public.blogs to authenticated;
drop policy if exists qmargin_b74_blog_anon_boundary on public.blogs;
create policy qmargin_b74_blog_anon_boundary on public.blogs as restrictive for all to anon
  using (false) with check (false);

alter policy qmargin_b74_settings_read_boundary on public.site_settings to authenticated;
alter policy "Only admins can update site settings" on public.site_settings to authenticated;
drop policy if exists qmargin_b74_settings_anon_boundary on public.site_settings;
create policy qmargin_b74_settings_anon_boundary on public.site_settings as restrictive for select to anon
  using (id in ('broadcast_message', 'maintenance_mode'));

alter policy "Public profiles are viewable by everyone." on public.profiles to authenticated;
alter policy qmargin_b74_profile_read_boundary on public.profiles to authenticated;
drop policy if exists qmargin_b74_profile_anon_boundary on public.profiles;
create policy qmargin_b74_profile_anon_boundary on public.profiles as restrictive for all to anon
  using (false) with check (false);

notify pgrst, 'reload schema';
commit;
