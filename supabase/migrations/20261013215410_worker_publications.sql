-- Each publication keeps its own trade and location; profile edits do not move it.
alter table public.profiles add column is_demo boolean not null default false;

alter policy profiles_select on public.profiles using (
  id = (select auth.uid())
  or is_demo
  or (role = 'worker' and (select internal.is_approved_contractor()))
  or (role = 'contractor' and internal.contractor_is_visible(id))
);

create table public.worker_publications (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles(id) on delete cascade,
  trade_id smallint not null references public.trades(id),
  years_experience integer not null check (years_experience between 0 and 60),
  work_radius_km integer not null check (work_radius_km between 2 and 50),
  available_from date,
  city text not null check (char_length(trim(city)) between 2 and 80),
  latitude numeric(9, 3) not null check (latitude between -90 and 90),
  longitude numeric(9, 3) not null check (longitude between -180 and 180),
  created_at timestamptz not null default clock_timestamp()
);

create index worker_publications_worker_idx on public.worker_publications(worker_id, created_at desc);
create index worker_publications_discovery_idx on public.worker_publications(city, trade_id, created_at desc);

alter table public.worker_publications enable row level security;
alter table public.worker_publications force row level security;

revoke all on public.worker_publications from anon, authenticated;
grant select on public.worker_publications to authenticated;
grant insert (worker_id, trade_id, years_experience, work_radius_km, available_from, city, latitude, longitude)
  on public.worker_publications to authenticated;
grant all on public.worker_publications to service_role;

create policy worker_publications_select on public.worker_publications for select to authenticated using (
  worker_id = (select auth.uid())
  or (select internal.is_approved_contractor())
  or exists (select 1 from public.profiles p where p.id = worker_id and p.is_demo)
);

create policy worker_publications_insert on public.worker_publications for insert to authenticated with check (
  worker_id = (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = worker_id and p.role = 'worker')
  and exists (select 1 from public.trades t where t.id = trade_id and t.is_active)
);

-- Earlier locations were overwritten in profiles and cannot be recovered.
insert into public.worker_publications
  (worker_id, trade_id, years_experience, work_radius_km, available_from, city, latitude, longitude)
select id, trade_id, years_experience, work_radius_km, available_from, city, latitude, longitude
from public.profiles where role = 'worker' and availability = 'available'
  and trade_id is not null and years_experience is not null and work_radius_km is not null
  and latitude is not null and longitude is not null;

notify pgrst, 'reload schema';
