begin;
set local lock_timeout = '5s';

alter table public.qmargin_b74_comments
  add column ignored boolean not null default false,
  add constraint qmargin_b74_comments_moderation_state check (not (approved and ignored));
grant update (ignored) on public.qmargin_b74_comments to authenticated;

notify pgrst, 'reload schema';
commit;
