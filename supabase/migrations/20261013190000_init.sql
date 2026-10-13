-- Phase 1. One offer is one vacancy. End users cannot write status,
-- approval, or consent timestamps except through the functions below.

create schema if not exists internal;

revoke all on schema internal from public;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema internal to authenticated, service_role;

create type public.profile_role as enum ('worker', 'contractor');
create type public.availability_status as enum ('available', 'busy', 'unavailable');
create type public.offer_status as enum ('open', 'filled', 'cancelled');
create type public.application_status as enum (
  'submitted', 'contacted', 'selected', 'rejected', 'withdrawn'
);
create type public.rate_type as enum ('daily', 'fixed', 'negotiable');

create table public.trades (
  id smallint generated always as identity primary key,
  name text not null unique check (char_length(trim(name)) between 2 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.profile_role not null,
  full_name text not null,
  company_name text,
  city text not null,
  trade_id smallint references public.trades (id),
  years_experience integer,
  availability public.availability_status,
  available_from date,
  work_radius_km integer,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  is_adult boolean not null,
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  contractor_approved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  availability_updated_at timestamptz,
  constraint profiles_adult check (is_adult),
  constraint profiles_name check (char_length(trim(full_name)) between 2 and 120),
  constraint profiles_city check (char_length(trim(city)) between 2 and 80),
  constraint profiles_terms check (char_length(trim(terms_version)) between 1 and 40),
  constraint profiles_worker_shape check (
    role <> 'worker' or (
      company_name is null
      and contractor_approved_at is null
      and trade_id is not null
      and years_experience between 0 and 60
      and availability is not null
      and work_radius_km between 2 and 50
      and latitude between -90 and 90
      and longitude between -180 and 180
      and availability_updated_at is not null
    )
  ),
  constraint profiles_contractor_shape check (
    role <> 'contractor' or (
      company_name is not null
      and char_length(trim(company_name)) >= 2
      and trade_id is null
      and years_experience is null
      and availability is null
      and available_from is null
      and work_radius_km is null
      and latitude is null
      and longitude is null
      and availability_updated_at is null
    )
  )
);

create table public.contacts (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  phone text not null check (phone ~ '^\+573[0-9]{9}$'),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.job_offers (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.profiles (id) on delete cascade,
  trade_id smallint not null references public.trades (id),
  title text not null,
  description text not null,
  rate_type public.rate_type not null,
  rate_amount_cop integer,
  start_date date not null,
  end_date date,
  city text not null,
  latitude numeric(9, 6) not null,
  longitude numeric(9, 6) not null,
  status public.offer_status not null default 'open',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  filled_at timestamptz,
  cancelled_at timestamptz,
  constraint job_offers_title check (char_length(trim(title)) between 10 and 80),
  constraint job_offers_description check (char_length(trim(description)) between 20 and 1000),
  constraint job_offers_city check (char_length(trim(city)) between 2 and 80),
  constraint job_offers_dates check (end_date is null or end_date >= start_date),
  constraint job_offers_latitude check (latitude between -90 and 90),
  constraint job_offers_longitude check (longitude between -180 and 180),
  constraint job_offers_rate_shape check (
    (rate_type = 'negotiable' and rate_amount_cop is null)
    or (rate_type in ('daily', 'fixed') and rate_amount_cop between 20000 and 2000000)
  ),
  constraint job_offers_status_shape check (
    (status = 'open' and filled_at is null and cancelled_at is null)
    or (status = 'filled' and filled_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and filled_at is null)
  )
);

comment on table public.job_offers is
  'One row is one vacancy. Filling it selects exactly one application.';

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  job_offer_id uuid not null references public.job_offers (id) on delete cascade,
  worker_id uuid not null references public.profiles (id) on delete cascade,
  message text,
  status public.application_status not null default 'submitted',
  contact_consent_at timestamptz not null,
  contact_consent_version text not null,
  whatsapp_opened_at timestamptz,
  contact_confirmed_at timestamptz,
  selected_at timestamptz,
  rejected_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (job_offer_id, worker_id),
  constraint applications_message check (
    message is null or char_length(message) between 1 and 300
  ),
  constraint applications_consent check (
    char_length(trim(contact_consent_version)) between 1 and 40
  ),
  constraint applications_status_shape check (
    (
      status = 'submitted'
      and contact_confirmed_at is null
      and selected_at is null
      and rejected_at is null
      and withdrawn_at is null
    )
    or (
      status = 'contacted'
      and contact_confirmed_at is not null
      and selected_at is null
      and rejected_at is null
      and withdrawn_at is null
    )
    or (
      status = 'selected'
      and contact_confirmed_at is not null
      and selected_at is not null
      and rejected_at is null
      and withdrawn_at is null
    )
    or (
      status = 'rejected'
      and rejected_at is not null
      and selected_at is null
      and withdrawn_at is null
    )
    or (
      status = 'withdrawn'
      and withdrawn_at is not null
      and contact_confirmed_at is null
      and selected_at is null
      and rejected_at is null
    )
  )
);

create unique index applications_one_selected_per_offer
  on public.applications (job_offer_id)
  where status = 'selected';

create index profiles_worker_discovery_idx
  on public.profiles (trade_id, availability, latitude, longitude)
  where role = 'worker';

create index job_offers_discovery_idx
  on public.job_offers (status, trade_id, latitude, longitude);

create index job_offers_contractor_idx
  on public.job_offers (contractor_id);

create index applications_worker_idx
  on public.applications (worker_id);

create index applications_offer_idx
  on public.applications (job_offer_id);

insert into public.trades (name) values
  ('Ayudante de obra'),
  ('Oficial'),
  ('Maestro de obra'),
  ('Albañil'),
  ('Electricista'),
  ('Plomero'),
  ('Pintor'),
  ('Carpintero'),
  ('Soldador'),
  ('Armador de hierro'),
  ('Drywall'),
  ('Operador de maquinaria'),
  ('Instalador de pisos');

create type internal.contractor_application as (
  offer_id uuid,
  offer_status public.offer_status,
  application_status public.application_status
);

create function internal.begin_transition()
returns void
language plpgsql
as $$
begin
  perform set_config('app.trusted_transition', '1', true);
end;
$$;

create function internal.end_transition()
returns void
language plpgsql
as $$
begin
  perform set_config('app.trusted_transition', '', true);
end;
$$;

create function internal.is_approved_contractor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'contractor'
      and contractor_approved_at is not null
  );
$$;

create function internal.contractor_is_visible(p_contractor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.job_offers j
    where j.contractor_id = p_contractor
      and (
        j.status = 'open'
        or exists (
          select 1
          from public.applications a
          where a.job_offer_id = j.id
            and a.worker_id = auth.uid()
        )
      )
  );
$$;

create function internal.caller_applied(p_offer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.applications
    where job_offer_id = p_offer_id
      and worker_id = auth.uid()
  );
$$;

create function internal.owns_offer(p_offer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.job_offers
    where id = p_offer_id
      and contractor_id = auth.uid()
  );
$$;

-- Withdrawn applications stop sharing the phone. Rejected and selected still share it.
create function internal.can_read_worker_phone(p_worker uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.applications a
    join public.job_offers j on j.id = a.job_offer_id
    where a.worker_id = p_worker
      and j.contractor_id = auth.uid()
      and a.contact_consent_at is not null
      and a.status <> 'withdrawn'
      and exists (
        select 1
        from public.profiles c
        where c.id = auth.uid()
          and c.role = 'contractor'
          and c.contractor_approved_at is not null
      )
  );
$$;

create function internal.lock_offer(p_offer_id uuid)
returns public.job_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.job_offers;
begin
  select *
    into v_offer
  from public.job_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return v_offer;
end;
$$;

create function internal.lock_offer_applications(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.applications
  where job_offer_id = p_offer_id
  order by id
  for update;
end;
$$;

-- Lock the offer before its applications so contractor operations cannot deadlock.
create function internal.prepare_contractor_application(p_application_id uuid)
returns internal.contractor_application
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_offer_id uuid;
  v_offer public.job_offers;
  v_status public.application_status;
  v_result internal.contractor_application;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select a.job_offer_id, j.contractor_id
    into v_offer_id, v_owner
  from public.applications a
  join public.job_offers j on j.id = a.job_offer_id
  where a.id = p_application_id;

  if v_offer_id is null or v_owner is distinct from auth.uid() then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_offer := internal.lock_offer(v_offer_id);

  if v_offer.contractor_id is distinct from auth.uid() then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not internal.is_approved_contractor() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform internal.lock_offer_applications(v_offer.id);

  select a.status
    into v_status
  from public.applications a
  where a.id = p_application_id;

  v_result.offer_id := v_offer.id;
  v_result.offer_status := v_offer.status;
  v_result.application_status := v_status;
  return v_result;
end;
$$;

create function internal.guard_profile_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_trade_changed boolean;
begin
  new.full_name := trim(new.full_name);
  new.city := trim(new.city);
  new.company_name := nullif(trim(new.company_name), '');

  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.id is distinct from auth.uid() then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if auth.uid() is not null and new.contractor_approved_at is not null then
      raise exception 'admin_field' using errcode = '42501';
    end if;
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
    if auth.uid() is not null or new.terms_accepted_at is null then
      new.terms_accepted_at := clock_timestamp();
    end if;
    v_trade_changed := new.trade_id is not null;
  else
    if auth.uid() is not null and new.role is distinct from old.role then
      raise exception 'role_immutable' using errcode = '42501';
    end if;
    if auth.uid() is not null
       and new.contractor_approved_at is distinct from old.contractor_approved_at then
      raise exception 'admin_field' using errcode = '42501';
    end if;
    if new.id is distinct from old.id then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    new.terms_accepted_at := old.terms_accepted_at;
    new.terms_version := old.terms_version;
    new.updated_at := clock_timestamp();
    v_trade_changed := new.trade_id is distinct from old.trade_id;
  end if;

  if v_trade_changed and not exists (
    select 1 from public.trades t where t.id = new.trade_id and t.is_active
  ) then
    raise exception 'inactive_trade' using errcode = 'P0001';
  end if;

  if new.role = 'worker' then
    new.latitude := round(new.latitude, 3);
    new.longitude := round(new.longitude, 3);
    if tg_op = 'INSERT' then
      new.availability_updated_at := clock_timestamp();
    elsif new.availability is distinct from old.availability
       or new.available_from is distinct from old.available_from then
      new.availability_updated_at := clock_timestamp();
    else
      new.availability_updated_at := old.availability_updated_at;
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard
before insert or update on public.profiles
for each row execute function internal.guard_profile_write();

create function internal.guard_contact_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.phone := trim(new.phone);
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.profile_id := old.profile_id;
  end if;
  return new;
end;
$$;

create trigger contacts_guard
before insert or update on public.contacts
for each row execute function internal.guard_contact_write();

create function internal.guard_offer_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_end_user boolean := auth.uid() is not null
    and current_setting('app.trusted_transition', true) is distinct from '1';
begin
  new.title := trim(new.title);
  new.description := trim(new.description);
  new.city := trim(new.city);

  if v_end_user and tg_op = 'INSERT' then
    if new.contractor_id is distinct from auth.uid() then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if new.status is distinct from 'open'
       or new.filled_at is not null
       or new.cancelled_at is not null then
      raise exception 'protected_field' using errcode = '42501';
    end if;
    if new.start_date < current_date then
      raise exception 'offer_expired' using errcode = 'P0001';
    end if;
  elsif v_end_user and tg_op = 'UPDATE' then
    if new.status is distinct from old.status
       or new.filled_at is distinct from old.filled_at
       or new.cancelled_at is distinct from old.cancelled_at
       or new.contractor_id is distinct from old.contractor_id
       or new.created_at is distinct from old.created_at then
      raise exception 'protected_field' using errcode = '42501';
    end if;
    if old.status is distinct from 'open' then
      raise exception 'offer_not_open' using errcode = 'P0001';
    end if;
    if new.start_date is distinct from old.start_date and new.start_date < current_date then
      raise exception 'offer_expired' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.trades t where t.id = new.trade_id and t.is_active
    ) then
      raise exception 'inactive_trade' using errcode = 'P0001';
    end if;
  elsif new.trade_id is distinct from old.trade_id then
    if not exists (
      select 1 from public.trades t where t.id = new.trade_id and t.is_active
    ) then
      raise exception 'inactive_trade' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger job_offers_guard
before insert or update on public.job_offers
for each row execute function internal.guard_offer_write();

create function internal.guard_application_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.job_offer_id := old.job_offer_id;
    new.worker_id := old.worker_id;
    new.contact_consent_at := old.contact_consent_at;
    new.contact_consent_version := old.contact_consent_version;
  end if;
  new.updated_at := clock_timestamp();

  if auth.uid() is not null
     and current_setting('app.trusted_transition', true) is distinct from '1' then
    raise exception 'direct_write_forbidden' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger applications_guard
before insert or update on public.applications
for each row execute function internal.guard_application_write();

create function public.apply_to_offer(
  p_offer_id uuid,
  p_message text,
  p_consent boolean,
  p_consent_version text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.profile_role;
  v_offer public.job_offers;
  v_message text;
  v_application_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_consent is not true then
    raise exception 'consent_required' using errcode = 'P0001';
  end if;
  if nullif(trim(p_consent_version), '') is null
     or trim(p_consent_version) <> 'contact-v1' then
    raise exception 'consent_version_required' using errcode = 'P0001';
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'worker' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.contacts where profile_id = auth.uid()
  ) then
    raise exception 'phone_required' using errcode = 'P0001';
  end if;

  v_message := nullif(trim(p_message), '');
  if v_message is not null and char_length(v_message) > 300 then
    raise exception 'message_too_long' using errcode = 'P0001';
  end if;

  v_offer := internal.lock_offer(p_offer_id);
  if v_offer.status is distinct from 'open' then
    raise exception 'offer_not_open' using errcode = 'P0001';
  end if;
  if v_offer.start_date < current_date
     or (v_offer.end_date is not null and v_offer.end_date < current_date) then
    raise exception 'offer_expired' using errcode = 'P0001';
  end if;

  begin
    perform internal.begin_transition();
    insert into public.applications (
      job_offer_id,
      worker_id,
      message,
      status,
      contact_consent_at,
      contact_consent_version
    ) values (
      p_offer_id,
      auth.uid(),
      v_message,
      'submitted',
      clock_timestamp(),
      trim(p_consent_version)
    )
    returning id into v_application_id;
    perform internal.end_transition();
  exception
    when unique_violation then
      raise exception 'duplicate_application' using errcode = '23505';
  end;

  return v_application_id;
end;
$$;

create function public.withdraw_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker uuid;
  v_offer_id uuid;
  v_status public.application_status;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select worker_id, job_offer_id
    into v_worker, v_offer_id
  from public.applications
  where id = p_application_id;

  if v_worker is null or v_worker is distinct from auth.uid() then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform internal.lock_offer(v_offer_id);
  perform internal.lock_offer_applications(v_offer_id);

  select status into v_status
  from public.applications
  where id = p_application_id;

  if v_status is distinct from 'submitted' then
    raise exception 'cannot_withdraw' using errcode = 'P0001';
  end if;

  perform internal.begin_transition();
  update public.applications
    set status = 'withdrawn',
        withdrawn_at = clock_timestamp()
    where id = p_application_id;
  perform internal.end_transition();
end;
$$;

create function public.register_whatsapp_click(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v internal.contractor_application;
begin
  v := internal.prepare_contractor_application(p_application_id);
  if v.application_status not in ('submitted', 'contacted', 'selected') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform internal.begin_transition();
  update public.applications
    set whatsapp_opened_at = coalesce(whatsapp_opened_at, clock_timestamp())
    where id = p_application_id;
  perform internal.end_transition();
end;
$$;

create function public.confirm_contact(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v internal.contractor_application;
begin
  v := internal.prepare_contractor_application(p_application_id);
  if v.offer_status is distinct from 'open' then
    raise exception 'offer_not_open' using errcode = 'P0001';
  end if;
  if v.application_status is distinct from 'submitted' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform internal.begin_transition();
  update public.applications
    set status = 'contacted',
        contact_confirmed_at = clock_timestamp()
    where id = p_application_id;
  perform internal.end_transition();
end;
$$;

create function public.reject_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v internal.contractor_application;
begin
  v := internal.prepare_contractor_application(p_application_id);
  if v.offer_status is distinct from 'open' then
    raise exception 'offer_not_open' using errcode = 'P0001';
  end if;
  if v.application_status not in ('submitted', 'contacted') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform internal.begin_transition();
  update public.applications
    set status = 'rejected',
        rejected_at = clock_timestamp()
    where id = p_application_id;
  perform internal.end_transition();
end;
$$;

create function public.select_candidate(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v internal.contractor_application;
begin
  v := internal.prepare_contractor_application(p_application_id);
  if v.offer_status is distinct from 'open' then
    raise exception 'offer_not_open' using errcode = 'P0001';
  end if;
  if v.application_status is distinct from 'contacted' then
    raise exception 'contact_required' using errcode = 'P0001';
  end if;

  -- Offer row is already locked. Status, selection, and rejections commit or roll back together.
  perform internal.begin_transition();
  update public.applications
    set status = 'selected',
        selected_at = clock_timestamp()
    where id = p_application_id;

  update public.job_offers
    set status = 'filled',
        filled_at = clock_timestamp()
    where id = v.offer_id;

  update public.applications
    set status = 'rejected',
        rejected_at = clock_timestamp()
    where job_offer_id = v.offer_id
      and id <> p_application_id
      and status in ('submitted', 'contacted');
  perform internal.end_transition();
end;
$$;

create function public.cancel_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_offer public.job_offers;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select contractor_id into v_owner
  from public.job_offers
  where id = p_offer_id;

  if v_owner is null or v_owner is distinct from auth.uid() then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not internal.is_approved_contractor() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_offer := internal.lock_offer(p_offer_id);
  if v_offer.contractor_id is distinct from auth.uid() then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_offer.status is distinct from 'open' then
    raise exception 'offer_not_open' using errcode = 'P0001';
  end if;

  perform internal.lock_offer_applications(p_offer_id);
  perform internal.begin_transition();
  update public.job_offers
    set status = 'cancelled',
        cancelled_at = clock_timestamp()
    where id = p_offer_id;
  update public.applications
    set status = 'rejected',
        rejected_at = clock_timestamp()
    where job_offer_id = p_offer_id
      and status in ('submitted', 'contacted');
  perform internal.end_transition();
end;
$$;

revoke all on all tables in schema public from public, anon, authenticated;

grant select on public.trades to authenticated;

grant select on public.profiles to authenticated;
grant insert (
  id, role, full_name, company_name, city, trade_id, years_experience,
  availability, available_from, work_radius_km, latitude, longitude,
  is_adult, terms_version
) on public.profiles to authenticated;
grant update (
  full_name, company_name, city, trade_id, years_experience,
  availability, available_from, work_radius_km, latitude, longitude
) on public.profiles to authenticated;

grant select on public.contacts to authenticated;
grant insert (profile_id, phone) on public.contacts to authenticated;
grant update (phone) on public.contacts to authenticated;

grant select on public.job_offers to authenticated;
grant insert (
  contractor_id, trade_id, title, description, rate_type, rate_amount_cop,
  start_date, end_date, city, latitude, longitude
) on public.job_offers to authenticated;
grant update (
  trade_id, title, description, rate_type, rate_amount_cop,
  start_date, end_date, city, latitude, longitude
) on public.job_offers to authenticated;

grant select on public.applications to authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;

revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema internal from public, anon, authenticated;

grant execute on function public.apply_to_offer(uuid, text, boolean, text) to authenticated, service_role;
grant execute on function public.withdraw_application(uuid) to authenticated, service_role;
grant execute on function public.register_whatsapp_click(uuid) to authenticated, service_role;
grant execute on function public.confirm_contact(uuid) to authenticated, service_role;
grant execute on function public.reject_application(uuid) to authenticated, service_role;
grant execute on function public.select_candidate(uuid) to authenticated, service_role;
grant execute on function public.cancel_offer(uuid) to authenticated, service_role;

grant execute on function internal.is_approved_contractor() to authenticated;
grant execute on function internal.contractor_is_visible(uuid) to authenticated;
grant execute on function internal.caller_applied(uuid) to authenticated;
grant execute on function internal.owns_offer(uuid) to authenticated;
grant execute on function internal.can_read_worker_phone(uuid) to authenticated;
grant execute on function internal.guard_profile_write() to authenticated, service_role;
grant execute on function internal.guard_contact_write() to authenticated, service_role;
grant execute on function internal.guard_offer_write() to authenticated, service_role;
grant execute on function internal.guard_application_write() to authenticated, service_role;

alter table public.trades enable row level security;
alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.job_offers enable row level security;
alter table public.applications enable row level security;

alter table public.trades force row level security;
alter table public.profiles force row level security;
alter table public.contacts force row level security;
alter table public.job_offers force row level security;
alter table public.applications force row level security;

create policy trades_select on public.trades
for select to authenticated
using (true);

create policy profiles_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or (role = 'worker' and internal.is_approved_contractor())
  or (role = 'contractor' and internal.contractor_is_visible(id))
);

create policy profiles_insert on public.profiles
for insert to authenticated
with check (id = auth.uid());

create policy profiles_update on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy contacts_select on public.contacts
for select to authenticated
using (
  profile_id = auth.uid()
  or internal.can_read_worker_phone(profile_id)
);

create policy contacts_insert on public.contacts
for insert to authenticated
with check (profile_id = auth.uid());

create policy contacts_update on public.contacts
for update to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

create policy job_offers_select on public.job_offers
for select to authenticated
using (
  contractor_id = auth.uid()
  or status = 'open'
  or internal.caller_applied(id)
);

create policy job_offers_insert on public.job_offers
for insert to authenticated
with check (
  contractor_id = auth.uid()
  and status = 'open'
  and filled_at is null
  and cancelled_at is null
  and internal.is_approved_contractor()
);

create policy job_offers_update on public.job_offers
for update to authenticated
using (
  contractor_id = auth.uid()
  and status = 'open'
  and internal.is_approved_contractor()
)
with check (
  contractor_id = auth.uid()
  and status = 'open'
  and internal.is_approved_contractor()
);

create policy applications_select on public.applications
for select to authenticated
using (
  worker_id = auth.uid()
  or (
    internal.is_approved_contractor()
    and internal.owns_offer(job_offer_id)
  )
);
