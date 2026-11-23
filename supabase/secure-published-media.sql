-- Keep retired weekly photos private unless a published entry explicitly pairs them.
-- The weekly image policy already uses the rows the caller can see in this table.
begin;
set local lock_timeout = '5s';
alter policy qmargin_b74_public_weekly_photos on public.qmargin_b74_weekly_photos
  using (
    week <= (select date_trunc('week', timezone('Asia/Kolkata', now()))::date)
    and ((featured and week <> date '1900-01-01') or exists (
      select 1 from public.qmargin_b74_posts post
      where post.published and post.paired_photo = qmargin_b74_weekly_photos.id::text
    ))
  );
commit;
