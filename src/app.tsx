import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { PILOT_CITY, PILOT_ZONE, buildProfile, roundZone } from './lib/profile.mjs'
import { supabase } from './lib/supabase'
import type { Profile, Role, Trade } from './lib/types'
import { Marketplace } from './features/marketplace'
import { DiscoveryMap } from './features/discovery-map'
import { PlaceAddress } from './features/place-address'

type View = 'login' | 'signup' | 'profile' | 'home'
type ZoneStatus = 'idle' | 'locating' | 'ready' | 'fallback'

const AVAILABILITY_LABEL: Record<NonNullable<Profile['availability']>, string> = {
  available: 'Disponible',
  busy: 'Ocupado',
  unavailable: 'No disponible',
}

function authMessage(message: string) {
  if (/invalid login/i.test(message)) return 'Correo o contraseña incorrectos.'
  if (/already registered/i.test(message)) return 'Ese correo ya está registrado.'
  if (/email not confirmed/i.test(message)) return 'No se pudo iniciar sesión. El piloto requiere registro sin confirmación de correo.'
  if (/invalid/i.test(message) && /email/i.test(message)) return 'Ese correo no es válido.'
  if (/rate limit/i.test(message)) return 'Hay que esperar un momento antes de crear otra cuenta.'
  return message
}

function nationalPhone(phone: string) {
  return phone.startsWith('+57') ? phone.slice(3) : phone
}

function readZone() {
  if (!navigator.geolocation) return Promise.resolve(null)
  return new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = roundZone(position.coords.latitude)
        const longitude = roundZone(position.coords.longitude)
        resolve(latitude == null || longitude == null ? null : { latitude, longitude })
      },
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    )
  })
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<View>('login')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [hasContact, setHasContact] = useState(false)
  const [phone, setPhone] = useState('')
  const [trades, setTrades] = useState<Trade[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!supabase) {
      setReady(true)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    setProfile(null)
    setHasContact(false)
    setPhone('')
    setTrades([])
    setError('')
    setView('home')
    if (!supabase || !session) {
      return
    }
    let cancel = false
    const userId = session.user.id
    Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('contacts').select('phone').eq('profile_id', userId).maybeSingle(),
      supabase.from('trades').select('id, name').eq('is_active', true).order('name'),
    ]).then(([profileRes, contactRes, tradeRes]) => {
      if (cancel) return
      const failed = profileRes.error ?? contactRes.error ?? tradeRes.error
      if (failed) {
        setError(failed.message)
        return
      }
      const nextProfile = profileRes.data as Profile | null
      setProfile(nextProfile)
      setHasContact(Boolean(contactRes.data))
      setPhone(contactRes.data?.phone ?? '')
      setTrades((tradeRes.data ?? []) as Trade[])
      setView(nextProfile && contactRes.data ? 'home' : 'profile')
    })
    return () => { cancel = true }
  }, [session?.user.id])

  async function signIn(email: string, password: string) {
    setError('')
    setNotice('')
    if (!supabase) return setError(missingKey)
    const { error: signError } = await supabase.auth.signInWithPassword({ email, password })
    if (signError) setError(authMessage(signError.message))
  }

  async function signUp(email: string, password: string) {
    setError('')
    setNotice('')
    if (!supabase) return setError(missingKey)
    const { data, error: signError } = await supabase.auth.signUp({ email, password })
    if (signError) return setError(authMessage(signError.message))
    if (!data.session) {
      setError('La cuenta quedó creada, pero no se pudo entrar. Intenta de nuevo.')
      setView('login')
    }
  }

  async function saveProfile(role: Role, input: ProfileInput) {
    setError('')
    if (!supabase || !session) return setError(missingKey)
    const nextRole = profile?.role ?? role
    const built = buildProfile(session.user.id, nextRole, input, Boolean(profile))
    if (!built.row || !built.phone) return setError(built.error ?? 'No se pudo armar el perfil.')

    const row = built.row as never
    const write = profile
      ? supabase.from('profiles').update(row).eq('id', session.user.id)
      : supabase.from('profiles').insert(row)
    const { data: savedProfile, error: profileError } = await write.select('*').single()
    if (profileError) return setError(profileError.message)
    // A failed contact write must retry the saved profile, not insert it again.
    setProfile(savedProfile as Profile)

    const contact = hasContact
      ? supabase.from('contacts').update({ phone: built.phone }).eq('profile_id', session.user.id)
      : supabase.from('contacts').insert({ profile_id: session.user.id, phone: built.phone })
    const { error: contactError } = await contact
    if (contactError) return setError(contactError.message)
    setHasContact(true)
    setPhone(built.phone)
    setView('home')
  }

  async function signOut() {
    setError('')
    setNotice('')
    const result = await supabase?.auth.signOut()
    if (result?.error) return setError(authMessage(result.error.message))
    setView('login')
  }

  return (
    <main className={ready && session && profile && view === 'home' ? 'screen map-screen' : 'screen'}>
      <header className="brand">
        <span className="mark" aria-hidden="true">D</span>
        <div>
          <h1>Doran</h1>
          <p>Personal para obras en {PILOT_CITY}</p>
        </div>
        {ready && session && profile && view === 'home' && <details className="account-menu">
          <summary><span className="account-name">{profile.full_name}</span><span className="account-role">{profile.role === 'worker' ? 'Trabajador' : 'Contratante'}</span></summary>
          <Home profile={profile} trades={trades} error={error}
            onEdit={() => { setError(''); setView('profile') }} onSignOut={signOut} />
        </details>}
      </header>
      {!ready && <p className="note">Cargando…</p>}
      {ready && !session && view === 'signup' && (
        <Signup error={error} notice={notice} onSubmit={signUp} onLogin={() => { setError(''); setView('login') }} />
      )}
      {ready && !session && view !== 'signup' && (
        <Login error={error} notice={notice} onSubmit={signIn} onSignup={() => { setError(''); setView('signup') }} />
      )}
      {ready && session && !profile && view !== 'profile' && (error ? (
        <div className="card"><p className="error" role="alert">{error}</p><button className="ghost" onClick={signOut}>Salir y volver a intentar</button></div>
      ) : <p className="note">Cargando…</p>)}
      {ready && session && view === 'profile' && (
        <ProfileForm
          lockedRole={profile?.role ?? null}
          profile={profile}
          phone={nationalPhone(phone)}
          trades={trades}
          error={error}
          onSubmit={saveProfile}
          onCancel={profile && hasContact ? () => { setError(''); setView('home') } : undefined}
        />
      )}
      {ready && session && view === 'home' && profile && (
        <Marketplace key={profile.id} profile={profile} phone={phone} trades={trades} />
      )}
    </main>
  )
}

const missingKey = 'En .env faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Están en Project Settings → API, la clave anon. La contraseña de la base no se usa en el navegador.'

function Login({ error, notice, onSubmit, onSignup }: {
  error: string
  notice: string
  onSubmit: (email: string, password: string) => Promise<void>
  onSignup: () => void
}) {
  const [pending, setPending] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    await onSubmit(String(form.get('email')).trim(), String(form.get('password')))
    setPending(false)
  }
  return (
    <form onSubmit={submit}>
      <div className="auth-heading"><span className="eyebrow">BIENVENIDO A DORAN</span><h2>Tu próxima obra empieza aquí.</h2><p>Entra para explorar oportunidades y talento cerca de ti.</p></div>
      <label>Correo<input name="email" type="email" autoComplete="email" required /></label>
      <label>Contraseña<input name="password" type="password" autoComplete="current-password" minLength={6} required /></label>
      {notice && <p className="note">{notice}</p>}
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</button>
      <button className="ghost" type="button" onClick={onSignup}>Crear cuenta</button>
    </form>
  )
}

function Signup({ error, notice, onSubmit, onLogin }: {
  error: string
  notice: string
  onSubmit: (email: string, password: string) => Promise<void>
  onLogin: () => void
}) {
  const [pending, setPending] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    await onSubmit(String(form.get('email')).trim(), String(form.get('password')))
    setPending(false)
  }
  return (
    <form onSubmit={submit}>
      <div className="auth-heading"><span className="eyebrow">EMPIEZA A CONECTAR</span><h2>Construyamos nuevas oportunidades.</h2><p>Crea tu cuenta y encuentra tu lugar en la próxima obra.</p></div>
      <label>Correo<input name="email" type="email" autoComplete="email" required /></label>
      <label>Contraseña<input name="password" type="password" autoComplete="new-password" minLength={6} required /></label>
      <p className="note">Después eliges si buscas trabajo o si contratas. El rol queda fijo al guardar el perfil.</p>
      {notice && <p className="note">{notice}</p>}
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={pending}>{pending ? 'Creando…' : 'Crear cuenta'}</button>
      <button className="ghost" type="button" onClick={onLogin}>Ya tengo cuenta</button>
    </form>
  )
}

type ProfileInput = {
  fullName: string
  companyName: string
  tradeId: string
  yearsExperience: string
  availability: string
  availableFrom: string
  workRadiusKm: string
  latitude: number
  longitude: number
  phone: string
  adult: boolean
  terms: boolean
}

function ProfileForm({ lockedRole, profile, phone, trades, error, onSubmit, onCancel }: {
  lockedRole: Role | null
  profile: Profile | null
  phone: string
  trades: Trade[]
  error: string
  onSubmit: (role: Role, input: ProfileInput) => Promise<void>
  onCancel?: () => void
}) {
  const [role, setRole] = useState<Role | null>(lockedRole)
  const [zone, setZone] = useState({
    latitude: profile?.latitude ?? PILOT_ZONE.latitude,
    longitude: profile?.longitude ?? PILOT_ZONE.longitude,
  })
  const [zoneStatus, setZoneStatus] = useState<ZoneStatus>(profile?.latitude == null ? 'idle' : 'ready')
  const [pending, setPending] = useState(false)

  async function locate() {
    setZoneStatus('locating')
    const found = await readZone()
    if (found) {
      setZone(found)
      setZoneStatus('ready')
    } else {
      setZone(PILOT_ZONE)
      setZoneStatus('fallback')
    }
  }

  useEffect(() => {
    if (role !== 'worker' || profile) return
    let cancel = false
    setZoneStatus('locating')
    readZone().then((found) => {
      if (cancel) return
      if (found) {
        setZone(found)
        setZoneStatus('ready')
      } else {
        setZone(PILOT_ZONE)
        setZoneStatus('fallback')
      }
    })
    return () => { cancel = true }
  }, [role, profile])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!role) return
    if (role === 'worker' && zoneStatus === 'locating') return
    const form = new FormData(event.currentTarget)
    setPending(true)
    await onSubmit(role, {
      fullName: String(form.get('fullName')),
      companyName: String(form.get('companyName') ?? ''),
      tradeId: String(form.get('tradeId') ?? ''),
      yearsExperience: String(form.get('yearsExperience') ?? ''),
      availability: String(form.get('availability') ?? ''),
      availableFrom: String(form.get('availableFrom') ?? ''),
      workRadiusKm: String(form.get('workRadiusKm') ?? ''),
      latitude: zone.latitude,
      longitude: zone.longitude,
      phone: String(form.get('phone')),
      adult: form.get('adult') === 'on',
      terms: form.get('terms') === 'on',
    })
    setPending(false)
  }

  const zoneCopy = zoneStatus === 'locating'
    ? 'Buscando tu zona…'
    : zoneStatus === 'fallback'
      ? 'No pudimos usar tu ubicación. Dejamos el centro de Pereira, aproximado a unos 100 metros.'
      : 'Zona de trabajo aproximada a unos 100 metros. Puedes cambiarla tocando el mapa.'

  return (
    <form onSubmit={submit}>
      {lockedRole ? (
        <p className="chip">{lockedRole === 'worker' ? 'Trabajador' : 'Contratante'}</p>
      ) : (
        <RolePicker role={role} onChange={setRole} />
      )}
      {!role && <p className="note">Elige un rol para ver los datos que te corresponden.</p>}
      {role && (
        <>
          <label>Nombre<input name="fullName" defaultValue={profile?.full_name ?? ''} required /></label>
          {role === 'contractor' && (
            <label>Nombre del contratante o empresa<input name="companyName" defaultValue={profile?.company_name ?? ''} required /></label>
          )}
          {role === 'worker' && (
            <>
              <label>
                Oficio
                <select name="tradeId" defaultValue={profile?.trade_id ?? ''} required>
                  <option value="">Elegir</option>
                  {trades.map((trade) => <option key={trade.id} value={trade.id}>{trade.name}</option>)}
                </select>
              </label>
              <label>Años de experiencia<input name="yearsExperience" type="number" min={0} max={60} defaultValue={profile?.years_experience ?? 0} required /></label>
              <label>
                Disponibilidad
                <select name="availability" defaultValue={profile?.availability ?? 'available'}>
                  <option value="available">Disponible</option>
                  <option value="busy">Ocupado</option>
                  <option value="unavailable">No disponible</option>
                </select>
              </label>
              <label>Disponible desde<input name="availableFrom" type="date" defaultValue={profile?.available_from ?? ''} /></label>
              <label>Radio de trabajo (km)<input name="workRadiusKm" type="number" min={2} max={50} defaultValue={profile?.work_radius_km ?? 10} required /></label>
              <div className="zone">
                <strong>Zona en {PILOT_CITY}</strong>
                <p>{zoneCopy}</p>
                <PlaceAddress latitude={zone.latitude} longitude={zone.longitude} />
                <button className="ghost" type="button" onClick={locate} disabled={zoneStatus === 'locating'}>
                  {zoneStatus === 'locating' ? 'Buscando…' : 'Usar mi ubicación'}
                </button>
              </div>
              <DiscoveryMap points={[{ id: 'zone', ...zone, label: 'Mi zona de trabajo aproximada' }]} selectedId="zone" initialCenter={zone}
                onPick={pending || zoneStatus === 'locating' ? undefined : (latitude, longitude) => {
                  setZone({ latitude: roundZone(latitude)!, longitude: roundZone(longitude)! })
                  setZoneStatus('ready')
                }} />
            </>
          )}
          <label>Celular<input name="phone" inputMode="tel" autoComplete="tel" defaultValue={phone} placeholder="3001234567" required /></label>
          <label className="check">
            <input name="adult" type="checkbox" defaultChecked={Boolean(profile)} />
            Confirmo que soy mayor de edad.
          </label>
          {!profile && (
            <label className="check">
              <input name="terms" type="checkbox" />
              Estoy probando una demo técnica en {PILOT_CITY}.
            </label>
          )}
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {role && (
        <button className="primary" disabled={pending || (role === 'worker' && zoneStatus === 'locating')}>
          {pending ? 'Guardando…' : 'Guardar perfil'}
        </button>
      )}
      {onCancel && <button className="ghost" type="button" onClick={onCancel}>Volver</button>}
    </form>
  )
}

function RolePicker({ role, onChange }: { role: Role | null; onChange: (role: Role) => void }) {
  return (
    <div className="roles">
      <button type="button" className={role === 'worker' ? 'role selected' : 'role'} aria-pressed={role === 'worker'} onClick={() => onChange('worker')}>
        <strong>Trabajador</strong>
        <span>Oficio, disponibilidad y zona</span>
      </button>
      <button type="button" className={role === 'contractor' ? 'role selected' : 'role'} aria-pressed={role === 'contractor'} onClick={() => onChange('contractor')}>
        <strong>Contratante</strong>
        <span>Empresa y vacantes</span>
      </button>
    </div>
  )
}

function Home({ profile, trades, error, onEdit, onSignOut }: {
  profile: Profile
  trades: Trade[]
  error: string
  onEdit: () => void
  onSignOut: () => void
}) {
  const trade = trades.find((item) => item.id === profile.trade_id)
  const initial = profile.full_name.trim().charAt(0).toUpperCase()
  return (
    <section className="card">
      <div className="who">
        <span className="avatar" aria-hidden="true">{initial}</span>
        <div>
          <h2>{profile.full_name}</h2>
          <p>{profile.role === 'worker' ? 'Trabajador' : 'Contratante'} · {profile.city}</p>
        </div>
      </div>
      <div className="facts">
        {profile.company_name && <span>{profile.company_name}</span>}
        {trade && <span>{trade.name}</span>}
        {profile.availability && <span>{AVAILABILITY_LABEL[profile.availability]}</span>}
      </div>
      {profile.role === 'contractor' && !profile.contractor_approved_at && (
        <p className="note">Tu cuenta espera aprobación manual. Hasta entonces no puedes publicar vacantes ni ver trabajadores.</p>
      )}
      {profile.role === 'contractor' && profile.contractor_approved_at && (
        <p className="note">Cuenta aprobada. Puedes publicar una vacante y revisar sus postulaciones.</p>
      )}
      {profile.role === 'worker' && (
        <p className="note">Explora ofertas y consulta el avance en Mis postulaciones.</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="primary" type="button" onClick={onEdit}>Editar perfil</button>
        <button className="ghost" type="button" onClick={onSignOut}>Salir</button>
      </div>
    </section>
  )
}
