create table if not exists public.trip_votes (
  id uuid primary key default gen_random_uuid(),
  voter text not null check (voter in ('Mercedes', 'Lucrecia', 'Alejandro', 'Fermín')),
  day_id text not null,
  plan_id text not null,
  rating integer not null check (rating between 1 and 4),
  must_do boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (voter, day_id, plan_id)
);

alter table public.trip_votes
add column if not exists must_do boolean not null default false;

create or replace function public.set_trip_votes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trip_votes_updated_at on public.trip_votes;

create trigger trip_votes_updated_at
before update on public.trip_votes
for each row
execute function public.set_trip_votes_updated_at();

alter table public.trip_votes enable row level security;

drop policy if exists "Everyone can read trip votes" on public.trip_votes;
create policy "Everyone can read trip votes"
on public.trip_votes
for select
to anon, authenticated
using (true);

drop policy if exists "Everyone can insert trip votes" on public.trip_votes;
create policy "Everyone can insert trip votes"
on public.trip_votes
for insert
to anon, authenticated
with check (true);

drop policy if exists "Everyone can update trip votes" on public.trip_votes;
create policy "Everyone can update trip votes"
on public.trip_votes
for update
to anon, authenticated
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_votes'
  ) then
    alter publication supabase_realtime add table public.trip_votes;
  end if;
end;
$$;
