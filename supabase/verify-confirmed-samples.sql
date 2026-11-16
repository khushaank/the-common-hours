-- Read-only confirmation of the approved cleanup and private backup.
select
  (select json_agg(title order by title) from public.qmargin_b74_posts) as retained_articles,
  (select count(*) from public.qmargin_b74_weekly_photos) as retained_weekly_photos,
  (select count(*) from public.qmargin_b74_photos) as retained_monthly_photos,
  (select count(*) from public.qmargin_b74_comments) as remaining_comments,
  jsonb_array_length(data -> 'posts') as backed_up_entries,
  jsonb_array_length(data -> 'photos') as backed_up_photos,
  jsonb_array_length(data -> 'comments') as backed_up_comments,
  has_table_privilege('anon', 'qmargin_b74_private.sample_cleanup_20261116', 'SELECT') as visitors_can_read_backup,
  has_table_privilege('authenticated', 'qmargin_b74_private.sample_cleanup_20261116', 'SELECT') as clients_can_read_backup
from qmargin_b74_private.sample_cleanup_20261116 where id = 1;
