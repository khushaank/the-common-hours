begin;

-- Reserve current and former published slugs against the same entry ID.
create table public.qmargin_b74_entry_slugs (
  slug text primary key check (length(slug) <= 120 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  post_id uuid not null references public.qmargin_b74_posts(id) on delete cascade,
  was_published boolean not null
);
create index qmargin_b74_entry_slugs_post on public.qmargin_b74_entry_slugs(post_id);
alter table public.qmargin_b74_entry_slugs enable row level security;
revoke all on public.qmargin_b74_entry_slugs from public, anon, authenticated;
grant select (slug, post_id) on public.qmargin_b74_entry_slugs to anon, authenticated;

create policy qmargin_b74_read_entry_slugs on public.qmargin_b74_entry_slugs
  for select to anon, authenticated using (
    was_published and exists (select 1 from public.qmargin_b74_posts p where p.id = post_id and p.published)
  );

insert into public.qmargin_b74_entry_slugs (slug, post_id, was_published)
select slug, id, published from public.qmargin_b74_posts;

create function qmargin_b74_private.remember_entry_slug()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.slug <> new.slug then
    delete from public.qmargin_b74_entry_slugs
    where slug = old.slug and post_id = old.id and not was_published;
  end if;

  insert into public.qmargin_b74_entry_slugs (slug, post_id, was_published)
  values (new.slug, new.id, new.published)
  on conflict (slug) do update
    set was_published = qmargin_b74_entry_slugs.was_published or excluded.was_published
    where qmargin_b74_entry_slugs.post_id = excluded.post_id;

  if not found then
    raise unique_violation using message = 'That URL slug belongs to another entry.';
  end if;
  return new;
end;
$$;
revoke all on function qmargin_b74_private.remember_entry_slug() from public, anon, authenticated;

create trigger qmargin_b74_keep_entry_slugs
  after insert or update of slug, published on public.qmargin_b74_posts
  for each row execute function qmargin_b74_private.remember_entry_slug();

notify pgrst, 'reload schema';
commit;
