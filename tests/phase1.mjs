import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54329/postgres'

const host = new URL(databaseUrl).hostname
if (host !== '127.0.0.1' && host !== 'localhost') {
  throw new Error('These tests reset the database. Refusing to run outside localhost.')
}

const client = new pg.Client({ connectionString: databaseUrl })
let passed = 0

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`ok ${String(passed).padStart(2, ' ')}  ${name}`)
}

async function clearSession() {
  await client.query('reset role')
  await client.query("select set_config('request.jwt.claim.sub', '', false)")
  await client.query("select set_config('request.jwt.claims', '', false)")
}

async function enter(userId) {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ])
  await client.query('set local role authenticated')
}

async function asUser(userId, fn) {
  await client.query('begin')
  try {
    await enter(userId)
    const value = await fn()
    await client.query('commit')
    return value
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function expectFail(userId, token, fn) {
  await client.query('begin')
  try {
    await enter(userId)
    await fn()
    throw new Error(`expected ${token}`)
  } catch (error) {
    await client.query('rollback')
    if (error.message === `expected ${token}`) {
      throw new Error(`expected ${token}, but the statement succeeded`)
    }
    if (!String(error.message).includes(token)) {
      throw new Error(`expected ${token}, got ${error.code}: ${error.message}`)
    }
  }
}

async function createUser() {
  const id = randomUUID()
  await client.query('insert into auth.users (id) values ($1)', [id])
  return id
}

async function insertWorker(id, phone, latitude, longitude) {
  const trade = await client.query("select id from public.trades where name = 'Albañil'")
  await asUser(id, async () => {
    await client.query(
      `insert into public.profiles (
         id, role, full_name, city, trade_id, years_experience,
         availability, work_radius_km, latitude, longitude, is_adult, terms_version
       ) values (
         $1, 'worker', 'Ana Gómez', 'Medellín', $2, 8,
         'available', 15, $3, $4, true, 'terms-v1'
       )`,
      [id, trade.rows[0].id, latitude, longitude],
    )
    if (phone) {
      await client.query(
        'insert into public.contacts (profile_id, phone) values ($1, $2)',
        [id, phone],
      )
    }
  })
  return trade.rows[0].id
}

async function insertContractor(id) {
  await asUser(id, async () => {
    await client.query(
      `insert into public.profiles (
         id, role, full_name, company_name, city, is_adult, terms_version
       ) values (
         $1, 'contractor', 'Luis Pérez', 'Obras Pérez', 'Medellín', true, 'terms-v1'
       )`,
      [id],
    )
  })
}

async function approve(id) {
  await clearSession()
  await client.query(
    'update public.profiles set contractor_approved_at = clock_timestamp() where id = $1',
    [id],
  )
}

async function publish(contractorId, tradeId, latitude = 6.251841) {
  return asUser(contractorId, async () => {
    const result = await client.query(
      `insert into public.job_offers (
         contractor_id, trade_id, title, description, rate_type, rate_amount_cop,
         start_date, city, latitude, longitude
       ) values (
         $1, $2, 'Oficial de obra',
         'Necesitamos un oficial para la estructura de la casa.',
         'daily', 90000, current_date, 'Medellín', $3, -75.563591
       )
       returning id`,
      [contractorId, tradeId, latitude],
    )
    return result.rows[0].id
  })
}

async function apply(workerId, offerId, message = 'Tengo disponibilidad esta semana.') {
  return asUser(workerId, async () => {
    const result = await client.query(
      "select public.apply_to_offer($1, $2, true, 'contact-v1') as id",
      [offerId, message],
    )
    return result.rows[0].id
  })
}

async function phones(readerId, workerId) {
  return asUser(readerId, async () => {
    const result = await client.query(
      'select phone from public.contacts where profile_id = $1',
      [workerId],
    )
    return result.rows
  })
}

async function resetDatabase() {
  await client.query('drop schema if exists public cascade')
  await client.query('drop schema if exists internal cascade')
  await client.query('drop schema if exists auth cascade')
  await client.query('create schema public')
  await client.query('grant all on schema public to current_user')
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const found = await client.query('select 1 from pg_roles where rolname = $1', [role])
    if (found.rowCount === 0) {
      const bypass = role === 'service_role' ? ' bypassrls' : ''
      await client.query(`create role ${role} nologin${bypass}`)
    }
  }
  await client.query('create schema auth')
  await client.query('create table auth.users (id uuid primary key)')
  await client.query(`
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid
    $$
  `)
  await client.query('grant usage on schema auth to authenticated, service_role')
  await client.query('grant execute on function auth.uid() to anon, authenticated, service_role')
  const migration = readFileSync(
    new URL('../supabase/migrations/20261013190000_init.sql', import.meta.url),
    'utf8',
  )
  await client.query(migration)
}

async function session(userId) {
  const connection = new pg.Client({ connectionString: databaseUrl })
  await connection.connect()
  await connection.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  await connection.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ])
  await connection.query('set role authenticated')
  const pid = (await connection.query('select pg_backend_pid() as pid')).rows[0].pid
  return { connection, pid }
}

async function main() {
  await client.connect()
  await resetDatabase()

  const trade = (await client.query("select id from public.trades where name = 'Albañil'")).rows[0].id

  await check('apply_to_offer does not accept a client timestamp', async () => {
    const args = await client.query(`
      select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'apply_to_offer'
    `)
    if (args.rows[0].args !== 'p_offer_id uuid, p_message text, p_consent boolean, p_consent_version text') {
      throw new Error(args.rows[0].args)
    }
  })

  await check('anonymous role cannot read profiles', async () => {
    await client.query('begin')
    let denied = false
    try {
      await client.query('set local role anon')
      await client.query('select id from public.profiles')
    } catch (error) {
      denied = String(error.message).includes('permission denied')
      if (!denied) throw error
    } finally {
      await client.query('rollback')
    }
    if (!denied) throw new Error('anonymous role read profiles')
  })

  const actor = await createUser()
  await check('authenticated users cannot arm a trusted write', async () => {
    await expectFail(actor, 'permission denied', async () => {
      await client.query('select internal.begin_transition()')
    })
  })

  await check('insert cannot set contractor approval without column privilege', async () => {
    await expectFail(actor, 'permission denied', async () => {
      await client.query(
        `insert into public.profiles (
           id, role, full_name, company_name, city, is_adult, terms_version, contractor_approved_at
         ) values ($1, 'contractor', 'Luis Pérez', 'Obras Pérez', 'Medellín', true, 'terms-v1', now())`,
        [actor],
      )
    })
  })

  await client.query('grant insert (contractor_approved_at) on public.profiles to authenticated')
  try {
    await check('insert trigger rejects contractor approval', async () => {
      await expectFail(actor, 'admin_field', async () => {
        await client.query(
          `insert into public.profiles (
             id, role, full_name, company_name, city, is_adult, terms_version, contractor_approved_at
           ) values ($1, 'contractor', 'Luis Pérez', 'Obras Pérez', 'Medellín', true, 'terms-v1', now())`,
          [actor],
        )
      })
    })
  } finally {
    await client.query('revoke insert (contractor_approved_at) on public.profiles from authenticated')
  }

  await client.query('grant insert (terms_accepted_at) on public.profiles to authenticated')
  try {
    await check('profile consent time is stamped by the database', async () => {
      await asUser(actor, async () => {
        await client.query(
          `insert into public.profiles (
             id, role, full_name, company_name, city, is_adult, terms_version, terms_accepted_at
           ) values (
             $1, 'contractor', 'Luis Pérez', 'Obras Pérez', 'Medellín', true, 'terms-v1', '2000-01-01'
           )`,
          [actor],
        )
      })
      const stamped = await client.query(
        `select terms_accepted_at > timestamptz '2010-01-01' as ok,
                contractor_approved_at is null as unapproved
         from public.profiles where id = $1`,
        [actor],
      )
      if (!stamped.rows[0].ok || !stamped.rows[0].unapproved) {
        throw new Error('profile stored a client timestamp or an approval')
      }
    })
  } finally {
    await client.query('revoke insert (terms_accepted_at) on public.profiles from authenticated')
  }

  await check('update cannot change approval or role without column privilege', async () => {
    await expectFail(actor, 'permission denied', async () => {
      await client.query(
        'update public.profiles set contractor_approved_at = now() where id = $1',
        [actor],
      )
    })
    await expectFail(actor, 'permission denied', async () => {
      await client.query("update public.profiles set role = 'worker' where id = $1", [actor])
    })
  })

  await client.query('grant update (contractor_approved_at, role) on public.profiles to authenticated')
  try {
    await check('update trigger keeps approval and role under database control', async () => {
      await expectFail(actor, 'admin_field', async () => {
        await client.query(
          'update public.profiles set contractor_approved_at = now() where id = $1',
          [actor],
        )
      })
      await expectFail(actor, 'role_immutable', async () => {
        await client.query("update public.profiles set role = 'worker' where id = $1", [actor])
      })
      const row = await client.query(
        'select role::text as role, contractor_approved_at is null as unapproved from public.profiles where id = $1',
        [actor],
      )
      if (row.rows[0].role !== 'contractor' || !row.rows[0].unapproved) {
        throw new Error('administrative fields changed')
      }
    })
  } finally {
    await client.query('revoke update (contractor_approved_at, role) on public.profiles from authenticated')
  }

  const worker = await createUser()
  await insertWorker(worker, '+573001110001', 6.244812, -75.58119)
  await check('worker zone is stored to about 100 meters', async () => {
    const row = await client.query(
      'select latitude = 6.245 and longitude = -75.581 as ok from public.profiles where id = $1',
      [worker],
    )
    if (!row.rows[0].ok) throw new Error('coordinates were not rounded')
  })

  await check('availability time changes only when availability changes', async () => {
    const before = await client.query(
      'select availability_updated_at::text as ts from public.profiles where id = $1',
      [worker],
    )
    await asUser(worker, async () => {
      await client.query("update public.profiles set full_name = 'Ana G. Rojas' where id = $1", [worker])
    })
    const same = await client.query(
      'select availability_updated_at::text = $2 as same from public.profiles where id = $1',
      [worker, before.rows[0].ts],
    )
    if (!same.rows[0].same) throw new Error('name edit refreshed availability')
    await sleep(20)
    await asUser(worker, async () => {
      await client.query("update public.profiles set availability = 'busy' where id = $1", [worker])
    })
    const moved = await client.query(
      'select availability_updated_at::text > $2 as moved from public.profiles where id = $1',
      [worker, before.rows[0].ts],
    )
    if (!moved.rows[0].moved) throw new Error('availability edit did not stamp the metric')
  })

  const contractor = actor
  await check('an unapproved contractor cannot publish or list workers', async () => {
    await expectFail(contractor, 'row-level security', async () => {
      await client.query(
        `insert into public.job_offers (
           contractor_id, trade_id, title, description, rate_type, rate_amount_cop,
           start_date, city, latitude, longitude
         ) values (
           $1, $2, 'Oficial de obra',
           'Necesitamos un oficial para la estructura de la casa.',
           'daily', 90000, current_date, 'Medellín', 6.25, -75.56
         )`,
        [contractor, trade],
      )
    })
    const visible = await asUser(contractor, async () => {
      return client.query("select id from public.profiles where role = 'worker'")
    })
    if (visible.rowCount !== 0) throw new Error('unapproved contractor listed workers')
  })

  await approve(contractor)
  await check('a worker cannot publish a vacancy', async () => {
    await expectFail(worker, 'row-level security', async () => {
      await client.query(
        `insert into public.job_offers (
           contractor_id, trade_id, title, description, rate_type, rate_amount_cop,
           start_date, city, latitude, longitude
         ) values (
           $1, $2, 'Oficial de obra',
           'Necesitamos un oficial para la estructura de la casa.',
           'daily', 90000, current_date, 'Medellín', 6.25, -75.56
         )`,
        [worker, trade],
      )
    })
  })

  const offerId = await publish(contractor, trade)
  await check('an approved contractor publishes one open vacancy', async () => {
    const row = await client.query(
      `select status = 'open' as open,
              latitude = 6.251841 as precise,
              created_at is not null as stamped
       from public.job_offers where id = $1`,
      [offerId],
    )
    if (!row.rows[0].open || !row.rows[0].precise || !row.rows[0].stamped) {
      throw new Error('offer was not stored as an open vacancy')
    }
  })

  await check('offer status cannot be forced by a direct update', async () => {
    await expectFail(contractor, 'permission denied', async () => {
      await client.query(
        "update public.job_offers set status = 'filled', filled_at = now() where id = $1",
        [offerId],
      )
    })
  })

  await client.query(
    'grant update (status, filled_at, cancelled_at) on public.job_offers to authenticated',
  )
  try {
    await check('offer trigger rejects a direct status change', async () => {
      await expectFail(contractor, 'protected_field', async () => {
        await client.query(
          "update public.job_offers set status = 'filled', filled_at = now() where id = $1",
          [offerId],
        )
      })
    })
  } finally {
    await client.query(
      'revoke update (status, filled_at, cancelled_at) on public.job_offers from authenticated',
    )
  }

  const outsider = await createUser()
  await insertContractor(outsider)
  await approve(outsider)

  await check('another contractor cannot see the phone before an application exists', async () => {
    if ((await phones(contractor, worker)).length !== 0) {
      throw new Error('phone was visible before consent')
    }
  })

  const noPhone = await createUser()
  await insertWorker(noPhone, null, 6.2, -75.5)
  await check('applying requires a phone and explicit consent', async () => {
    await expectFail(noPhone, 'phone_required', async () => {
      await client.query(
        "select public.apply_to_offer($1, null, true, 'contact-v1')",
        [offerId],
      )
    })
    await expectFail(worker, 'consent_required', async () => {
      await client.query(
        "select public.apply_to_offer($1, null, false, 'contact-v1')",
        [offerId],
      )
    })
  })

  const applicationId = await apply(worker, offerId)
  await check('consent and application time are recorded by the server', async () => {
    const row = await client.query(
      `select status = 'submitted' as submitted,
              contact_consent_version = 'contact-v1' as version,
              contact_consent_at > created_at - interval '1 minute' as consent_now,
              created_at is not null as created
       from public.applications where id = $1`,
      [applicationId],
    )
    if (!row.rows[0].submitted || !row.rows[0].version || !row.rows[0].consent_now || !row.rows[0].created) {
      throw new Error('application timestamps were not recorded')
    }
  })

  await check('the same worker cannot apply twice', async () => {
    await expectFail(worker, 'duplicate_application', async () => {
      await client.query(
        "select public.apply_to_offer($1, 'Otra vez', true, 'contact-v1')",
        [offerId],
      )
    })
  })

  await check('applications cannot be inserted directly', async () => {
    await expectFail(worker, 'permission denied', async () => {
      await client.query(
        `insert into public.applications (
           job_offer_id, worker_id, status, contact_consent_at, contact_consent_version
         ) values ($1, $2, 'submitted', now(), 'contact-v1')`,
        [offerId, worker],
      )
    })
  })

  await check('contractors are isolated from each other', async () => {
    const foreignApps = await asUser(outsider, async () => {
      return client.query('select id from public.applications where job_offer_id = $1', [offerId])
    })
    if (foreignApps.rowCount !== 0) throw new Error('foreign contractor read the application')
    if ((await phones(outsider, worker)).length !== 0) {
      throw new Error('foreign contractor read the phone')
    }
    await expectFail(outsider, 'not_found', async () => {
      await client.query('select public.select_candidate($1)', [applicationId])
    })
    const ownPhone = await phones(contractor, worker)
    if (ownPhone.length !== 1 || ownPhone[0].phone !== '+573001110001') {
      throw new Error('owner could not read the consented phone')
    }
  })

  const otherWorker = await createUser()
  await insertWorker(otherWorker, '+573001110002', 6.3, -75.6)
  await check('workers cannot read other worker profiles', async () => {
    const rows = await asUser(worker, async () => {
      return client.query('select id from public.profiles where id = $1', [otherWorker])
    })
    if (rows.rowCount !== 0) throw new Error('worker profile was visible to another worker')
  })

  await check('opening WhatsApp records a click and leaves the status untouched', async () => {
    await asUser(contractor, async () => {
      await client.query('select public.register_whatsapp_click($1)', [applicationId])
    })
    const first = await client.query(
      `select status::text as status, whatsapp_opened_at::text as opened,
              contact_confirmed_at is null as unconfirmed
       from public.applications where id = $1`,
      [applicationId],
    )
    if (first.rows[0].status !== 'submitted' || !first.rows[0].unconfirmed || !first.rows[0].opened) {
      throw new Error('WhatsApp click changed the contact state')
    }
    await asUser(contractor, async () => {
      await client.query('select public.register_whatsapp_click($1)', [applicationId])
    })
    const second = await client.query(
      'select whatsapp_opened_at::text = $2 as same from public.applications where id = $1',
      [applicationId, first.rows[0].opened],
    )
    if (!second.rows[0].same) throw new Error('a second click replaced the first timestamp')
  })

  await check('selection requires a confirmed contact', async () => {
    await expectFail(contractor, 'contact_required', async () => {
      await client.query('select public.select_candidate($1)', [applicationId])
    })
  })

  await asUser(contractor, async () => {
    await client.query('select public.confirm_contact($1)', [applicationId])
  })
  const otherApplication = await apply(otherWorker, offerId, 'También puedo ir.')

  await check('confirming contact is a separate event from the WhatsApp click', async () => {
    const row = await client.query(
      `select status = 'contacted' as contacted,
              contact_confirmed_at is not null as confirmed,
              whatsapp_opened_at is not null as clicked
       from public.applications where id = $1`,
      [applicationId],
    )
    if (!row.rows[0].contacted || !row.rows[0].confirmed || !row.rows[0].clicked) {
      throw new Error('contact confirmation was not stored separately')
    }
  })

  await asUser(contractor, async () => {
    await client.query('select public.select_candidate($1)', [applicationId])
  })

  await check('selecting a candidate fills the vacancy and rejects the rest', async () => {
    const row = await client.query(
      `select j.status = 'filled' as filled,
              j.filled_at is not null as filled_at,
              a.status = 'selected' as selected,
              a.selected_at is not null as selected_at,
              a.created_at <= a.contact_confirmed_at
                and a.contact_confirmed_at <= a.selected_at
                and a.selected_at <= j.filled_at as ordered,
              b.status = 'rejected' as other_rejected
       from public.job_offers j
       join public.applications a on a.id = $2
       join public.applications b on b.id = $3
       where j.id = $1`,
      [offerId, applicationId, otherApplication],
    )
    const state = row.rows[0]
    if (!state.filled || !state.filled_at || !state.selected || !state.selected_at || !state.ordered || !state.other_rejected) {
      throw new Error(`selection did not close the vacancy: ${JSON.stringify(state)}`)
    }
    const selectedCount = await client.query(
      "select count(*)::int as n from public.applications where job_offer_id = $1 and status = 'selected'",
      [offerId],
    )
    if (selectedCount.rows[0].n !== 1) throw new Error('more than one selected application')
  })

  await check('a filled vacancy is closed to new applications', async () => {
    const late = await createUser()
    await insertWorker(late, '+573001110003', 6.21, -75.57)
    await expectFail(late, 'offer_not_open', async () => {
      await client.query(
        "select public.apply_to_offer($1, null, true, 'contact-v1')",
        [offerId],
      )
    })
    const open = await asUser(late, async () => {
      return client.query(
        "select id from public.job_offers where id = $1 and status = 'open'",
        [offerId],
      )
    })
    if (open.rowCount !== 0) throw new Error('filled vacancy still looks open')
  })

  await check('rejection keeps the phone and withdrawal removes it', async () => {
    if ((await phones(contractor, otherWorker)).length !== 1) {
      throw new Error('rejected applicant phone was hidden')
    }
    const shared = await createUser()
    await insertWorker(shared, '+573001110004', 6.22, -75.58)
    const first = await publish(contractor, trade, 6.26)
    const second = await publish(contractor, trade, 6.27)
    const firstApp = await apply(shared, first)
    await apply(shared, second)
    if ((await phones(contractor, shared)).length !== 1) throw new Error('consented phone hidden')
    await asUser(shared, async () => {
      await client.query('select public.withdraw_application($1)', [firstApp])
    })
    if ((await phones(contractor, shared)).length !== 1) {
      throw new Error('phone hidden while another application was still active')
    }
    const remaining = await client.query(
      `select id from public.applications
       where worker_id = $1 and job_offer_id = $2`,
      [shared, second],
    )
    await asUser(shared, async () => {
      await client.query('select public.withdraw_application($1)', [remaining.rows[0].id])
    })
    if ((await phones(contractor, shared)).length !== 0) {
      throw new Error('phone remained visible after every application was withdrawn')
    }
    const own = await phones(shared, shared)
    if (own.length !== 1) throw new Error('worker lost access to their own phone')
  })

  await check('cancelling a vacancy rejects its active applications', async () => {
    const offer = await publish(contractor, trade, 6.28)
    const applicant = await createUser()
    await insertWorker(applicant, '+573001110005', 6.23, -75.59)
    const application = await apply(applicant, offer)
    await asUser(contractor, async () => {
      await client.query('select public.cancel_offer($1)', [offer])
    })
    const row = await client.query(
      `select j.status = 'cancelled' as cancelled,
              a.status = 'rejected' as rejected
       from public.job_offers j
       join public.applications a on a.id = $2
       where j.id = $1`,
      [offer, application],
    )
    if (!row.rows[0].cancelled || !row.rows[0].rejected) {
      throw new Error('cancel did not close the vacancy')
    }
  })

  await check('a second selection waits on the offer lock', async () => {
    const offer = await publish(contractor, trade, 6.29)
    const applicant = await createUser()
    await insertWorker(applicant, '+573001110006', 6.24, -75.6)
    const application = await apply(applicant, offer)
    await asUser(contractor, async () => {
      await client.query('select public.confirm_contact($1)', [application])
    })

    const holder = new pg.Client({ connectionString: databaseUrl })
    await holder.connect()
    await holder.query('begin')
    await holder.query('select id from public.job_offers where id = $1 for update', [offer])
    const holderPid = (await holder.query('select pg_backend_pid() as pid')).rows[0].pid

    const waiter = await session(contractor)
    await waiter.connection.query("set statement_timeout = '5s'")
    const pending = waiter.connection.query('select public.select_candidate($1)', [application])
    let blocked = false
    const started = Date.now()
    while (Date.now() - started < 2000) {
      const locks = await client.query('select pg_blocking_pids($1::int) as pids', [waiter.pid])
      const pids = locks.rows[0].pids ?? []
      if (pids.map(Number).includes(Number(holderPid))) {
        blocked = true
        break
      }
      await sleep(40)
    }
    await holder.query('rollback')
    await holder.end()
    await pending
    await waiter.connection.end()
    if (!blocked) throw new Error('selection did not wait for the offer lock')
  })

  await check('concurrent selections leave exactly one selected candidate', async () => {
    const offer = await publish(contractor, trade, 6.3)
    const firstWorker = await createUser()
    const secondWorker = await createUser()
    await insertWorker(firstWorker, '+573001110007', 6.31, -75.61)
    await insertWorker(secondWorker, '+573001110008', 6.32, -75.62)
    const firstApp = await apply(firstWorker, offer, 'Primera postulación.')
    const secondApp = await apply(secondWorker, offer, 'Segunda postulación.')
    await asUser(contractor, async () => {
      await client.query('select public.confirm_contact($1)', [firstApp])
      await client.query('select public.confirm_contact($1)', [secondApp])
    })

    const run = async (applicationId) => {
      const db = await session(contractor)
      try {
        await db.connection.query('select public.select_candidate($1)', [applicationId])
        return 'selected'
      } catch (error) {
        return error.message
      } finally {
        await db.connection.end()
      }
    }

    const results = await Promise.all([run(firstApp), run(secondApp)])
    const wins = results.filter((result) => result === 'selected')
    const losses = results.filter((result) => String(result).includes('offer_not_open'))
    if (wins.length !== 1 || losses.length !== 1) {
      throw new Error(`unexpected race results: ${results.join(' | ')}`)
    }
    const row = await client.query(
      `select j.status = 'filled' as filled,
              count(*) filter (where a.status = 'selected')::int as selected,
              count(*) filter (where a.status = 'rejected')::int as rejected
       from public.job_offers j
       join public.applications a on a.job_offer_id = j.id
       where j.id = $1
       group by j.status`,
      [offer],
    )
    if (!row.rows[0].filled || row.rows[0].selected !== 1 || row.rows[0].rejected !== 1) {
      throw new Error(`vacancy ended inconsistent: ${JSON.stringify(row.rows[0])}`)
    }
  })
}

try {
  await main()
  console.log(`\n${passed} tests passed`)
} catch (error) {
  console.error(`\nFAILED after ${passed} passed`)
  console.error(error)
  process.exitCode = 1
} finally {
  await client.end()
}
