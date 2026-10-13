-- Fictional accounts have no password, identities or contact data. Re-running is safe.
do $$
begin
  if exists (
    select 1 from public.profiles
    where id::text like 'd0000000-0000-4000-8000-%' and not is_demo
  ) then
    raise exception 'demo_id_conflicts_with_real_profile';
  end if;
end;
$$;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'demo-pereira-' || n || '@example.invalid',
  '{"demo":true}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array[1, 11, 12, 13, 14, 15]) as n
on conflict (id) do nothing;

insert into public.profiles
  (id, role, full_name, company_name, city, is_adult, terms_version, contractor_approved_at, is_demo)
values ('d0000000-0000-4000-8000-000000000001', 'contractor', '[DEMO] Obras Pereira',
  'Empresa ficticia de prueba', 'Pereira', true, 'demo-v1', now(), true)
on conflict (id) do nothing;

insert into public.profiles
  (id, role, full_name, city, trade_id, years_experience, availability, work_radius_km,
   latitude, longitude, is_adult, terms_version, is_demo)
select ('d0000000-0000-4000-8000-' || lpad(d.n::text, 12, '0'))::uuid,
  'worker', d.name, 'Pereira', t.id, d.years, 'available', 10, d.lat, d.lng, true, 'demo-v1', true
from (values
  (11, '[DEMO] Ana · Centro', 'Oficial', 7, 4.814, -75.694),
  (12, '[DEMO] Luis · Pinares', 'Electricista', 5, 4.802, -75.689),
  (13, '[DEMO] Marta · Cuba', 'Pintor', 6, 4.804, -75.733),
  (14, '[DEMO] Diego · Boston', 'Plomero', 4, 4.798, -75.703),
  (15, '[DEMO] Sara · Cerritos', 'Albañil', 9, 4.805, -75.798)
) as d(n, name, trade, years, lat, lng)
join public.trades t on t.name = d.trade and t.is_active
on conflict (id) do nothing;

insert into public.worker_publications
  (id, worker_id, trade_id, years_experience, work_radius_km, available_from, city, latitude, longitude)
select replace(p.id::text, 'd0000000-', 'e0000000-')::uuid,
  p.id, p.trade_id, p.years_experience, p.work_radius_km, null, p.city, p.latitude, p.longitude
from public.profiles p where p.is_demo and p.role = 'worker'
on conflict (id) do nothing;

insert into public.job_offers
  (id, contractor_id, trade_id, title, description, rate_type, rate_amount_cop,
   start_date, end_date, city, latitude, longitude)
select ('f0000000-0000-4000-8000-' || lpad(d.n::text, 12, '0'))::uuid,
  'd0000000-0000-4000-8000-000000000001', t.id, d.title,
  'Vacante ficticia para probar el mapa y las postulaciones. No representa un trabajo real ni genera contacto con una empresa.',
  'daily', d.pay, current_date + 30, current_date + 60, 'Pereira', d.lat, d.lng
from (values
  (1, 'Oficial', '[DEMO] Oficial para obra · Centro', 95000, 4.811, -75.694),
  (2, 'Pintor', '[DEMO] Pintura de vivienda · Cuba', 85000, 4.803, -75.729),
  (3, 'Electricista', '[DEMO] Instalación eléctrica · Pinares', 120000, 4.801, -75.691),
  (4, 'Albañil', '[DEMO] Mampostería de obra · Cerritos', 100000, 4.806, -75.803)
) as d(n, trade, title, pay, lat, lng)
join public.trades t on t.name = d.trade and t.is_active
on conflict (id) do nothing;
