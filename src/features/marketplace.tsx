import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PILOT_CITY, PILOT_ZONE } from '../lib/profile.mjs'
import { CONTACT_CONSENT_VERSION, buildOffer, marketplaceError, todayInColombia } from '../lib/offers.mjs'
import type { Application, Offer, Profile, Trade, WorkerPublication } from '../lib/types'
import { OfferForm, type OfferLocation } from './offer-form'
import { OfferCard, type ApplicationAction } from './offer-card'
import { DiscoveryMap } from './discovery-map'
import { WorkerDiscovery } from './worker-discovery'
import { WorkerActions, type WorkerAction, type WorkZone, type AvailabilityRow } from './worker-actions'

export function Marketplace({ profile, phone, trades }: {
  profile: Profile
  phone: string
  trades: Trade[]
}) {
  const [offers, setOffers] = useState<Offer[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [workers, setWorkers] = useState<Profile[]>([])
  const [phones, setPhones] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [tab, setTab] = useState('offers')
  const [tradeId, setTradeId] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [selectedOfferId, setSelectedOfferId] = useState('')
  const [discoveryWorkers, setDiscoveryWorkers] = useState<WorkerPublication[]>([])
  const [selectedWorkerId, setSelectedWorkerId] = useState('')
  const [resultsOpen, setResultsOpen] = useState(true)
  const [detailOpen, setDetailOpen] = useState(false)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1023px)').matches)
  const [location, setLocation] = useState<OfferLocation>({ latitude: '', longitude: '' })
  const [workerAction, setWorkerAction] = useState<WorkerAction | null>(null)
  const [workZone, setWorkZone] = useState<WorkZone>({
    latitude: profile.latitude ?? PILOT_ZONE.latitude,
    longitude: profile.longitude ?? PILOT_ZONE.longitude,
  })
  const contractor = profile.role === 'contractor'
  const approved = Boolean(profile.contractor_approved_at)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
    function adapt() {
      setCompact(media.matches)
      if (media.matches && detailOpen) setResultsOpen(false)
    }
    adapt()
    media.addEventListener('change', adapt)
    return () => media.removeEventListener('change', adapt)
  }, [detailOpen])

  useEffect(() => {
    if (!supabase || (contractor && !approved)) {
      setLoading(false)
      return
    }
    const db = supabase
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    setError('')
    async function load() {
      try {
        // shortcut: latest 50 offers, add pagination before expanding the pilot.
        let query = db.from('job_offers').select('*').order('created_at', { ascending: false }).limit(50)
        query = contractor
          ? query.eq('contractor_id', profile.id)
          : query.eq('city', PILOT_CITY).eq('status', 'open').gte('start_date', todayInColombia())
        const offerRes = await query
        if (offerRes.error) throw offerRes.error
        // shortcut: latest 50 visible publications, add pagination when the pilot grows.
        const publicationRes = await db.from('worker_publications').select('*, profiles!inner(*)')
          .eq('city', PILOT_CITY).order('created_at', { ascending: false }).limit(50)
        if (publicationRes.error) throw publicationRes.error
        let nextOffers = (offerRes.data ?? []) as Offer[]
        const offerIds = nextOffers.map((offer) => offer.id)
        const appRes = contractor
          ? offerIds.length
            ? await db.from('applications').select('*').in('job_offer_id', offerIds).order('created_at')
            : { data: [], error: null }
          : await db.from('applications').select('*, job_offers(*)').eq('worker_id', profile.id).order('created_at', { ascending: false })
        if (appRes.error) throw appRes.error
        const nextApps = (appRes.data ?? []) as (Application & { job_offers?: Offer })[]
        if (!contractor) {
          const history = nextApps.flatMap((application) => application.job_offers ? [application.job_offers] : [])
          nextOffers = [...new Map([...nextOffers, ...history].map((offer) => [offer.id, offer])).values()]
        }
        const workerIds = [...new Set(nextApps.map((application) => application.worker_id))]
        let nextWorkers: Profile[] = []
        let nextPhones: Record<string, string> = {}
        if (contractor && workerIds.length) {
          const [workerRes, phoneRes] = await Promise.all([
            db.from('profiles').select('*').in('id', workerIds),
            db.from('contacts').select('profile_id, phone').in('profile_id', workerIds),
          ])
          if (workerRes.error || phoneRes.error) throw workerRes.error ?? phoneRes.error
          nextWorkers = (workerRes.data ?? []) as Profile[]
          nextPhones = Object.fromEntries((phoneRes.data ?? []).map((contact) => [contact.profile_id, contact.phone]))
        }
        if (cancelled) return
        setOffers(nextOffers)
        setApplications(nextApps)
        setWorkers(nextWorkers)
        setPhones(nextPhones)
        setDiscoveryWorkers((publicationRes.data ?? []) as WorkerPublication[])
      } catch (failure) {
        if (!cancelled) {
          setLoadFailed(true)
          setError(marketplaceError(failure))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [profile.id, contractor, approved, refresh])

  async function perform(operation: () => Promise<void>, message: string) {
    if (pending || loading) return
    setPending(true)
    setError('')
    setNotice('')
    try {
      await operation()
      setNotice(message)
      setRefresh((value) => value + 1)
    } catch (failure) {
      setError(marketplaceError(failure))
    } finally {
      setPending(false)
    }
  }

  async function publish(row: NonNullable<ReturnType<typeof buildOffer>['row']>) {
    await perform(async () => {
      if (!supabase) throw new Error('missing_client')
      const result = await supabase.from('job_offers').insert(row)
      if (result.error) throw result.error
      setPublishing(false)
      setDetailOpen(false)
      setResultsOpen(true)
      setSelectedOfferId('')
    }, 'Vacante publicada.')
  }

  async function apply(offerId: string, message: string, consent: boolean) {
    await perform(async () => {
      if (!supabase) throw new Error('missing_client')
      const result = await supabase.rpc('apply_to_offer', {
        p_offer_id: offerId, p_message: message.trim() || null,
        p_consent: consent, p_consent_version: CONTACT_CONSENT_VERSION,
      })
      if (result.error) throw result.error
      setWorkerAction(null)
      setSelectedOfferId(offerId)
      setTab('applications')
    }, 'Postulación registrada. El contratante ya puede consultar tu celular.')
  }

  async function publishAvailability(row: AvailabilityRow) {
    await perform(async () => {
      if (!supabase) throw new Error('missing_client')
      const result = await supabase.from('worker_publications').insert({
        worker_id: profile.id, trade_id: row.trade_id, years_experience: row.years_experience,
        work_radius_km: row.work_radius_km, available_from: row.available_from,
        city: row.city, latitude: row.latitude, longitude: row.longitude,
      }).select('id').single()
      if (result.error) throw result.error
      setWorkerAction(null)
      setDetailOpen(false)
      setResultsOpen(true)
      setSelectedOfferId('')
      setSelectedWorkerId(result.data.id)
    }, 'Publicación guardada. Tus puntos anteriores se conservan en el mapa.')
  }

  async function action(name: ApplicationAction, applicationId: string, phone?: string) {
    if (name === 'register_whatsapp_click' && (!phone || !/^\+573\d{9}$/.test(phone))) {
      return setError('El celular no está disponible para esta postulación.')
    }
    // Open on the user gesture; an awaited RPC can trigger the browser popup blocker.
    const popup = name === 'register_whatsapp_click' && !pending && !loading ? window.open('about:blank', '_blank') : null
    if (popup) popup.opener = null
    await perform(async () => {
      try {
        if (!supabase) throw new Error('missing_client')
        const result = await supabase.rpc(name, { p_application_id: applicationId })
        if (result.error) throw result.error
        if (name === 'register_whatsapp_click') {
          const url = `https://wa.me/${phone!.slice(1)}`
          if (popup) popup.location.href = url
          else window.location.assign(url)
        }
      } catch (failure) {
        popup?.close()
        throw failure
      }
    }, name === 'register_whatsapp_click' ? 'Intento de abrir WhatsApp registrado; el contacto requiere confirmación.' : 'Estado actualizado.')
  }

  async function cancel(offerId: string) {
    await perform(async () => {
      if (!supabase) throw new Error('missing_client')
      const result = await supabase.rpc('cancel_offer', { p_offer_id: offerId })
      if (result.error) throw result.error
    }, 'Vacante cancelada.')
  }

  const visible = offers.filter((offer) => {
    if (contractor) return !tradeId || offer.trade_id === Number(tradeId)
    if (tab === 'applications') return applications.some((application) => application.job_offer_id === offer.id)
    return offer.status === 'open' && offer.start_date >= todayInColombia() && (!tradeId || offer.trade_id === Number(tradeId))
  })
  const selectedOffer = visible.find((offer) => offer.id === selectedOfferId)
  const selectedWorker = discoveryWorkers.find((worker) => worker.id === selectedWorkerId)
  const visibleWorkers = discoveryWorkers.filter((worker) => !tradeId || worker.trade_id === Number(tradeId))
  const myPublications = visibleWorkers.filter((worker) => worker.worker_id === profile.id)
  const viewingWorkers = tab === 'workers'
  const availableOffers = offers.filter((offer) => offer.status === 'open' && offer.start_date >= todayInColombia()
    && !applications.some((application) => application.job_offer_id === offer.id))
  const workerPoints = visibleWorkers.map((worker) => ({
    id: worker.id, label: `${worker.profiles.full_name} · ${trades.find((trade) => trade.id === worker.trade_id)?.name}`,
    latitude: worker.latitude, longitude: worker.longitude,
    kind: worker.worker_id === profile.id ? 'mine' as const : 'worker' as const,
  }))
  const resultPoints = viewingWorkers ? workerPoints : [
    ...visible.map((offer) => ({ id: offer.id, label: offer.title, latitude: offer.latitude, longitude: offer.longitude, kind: 'offer' as const })),
    ...(!contractor ? workerPoints : []),
  ]
  const points = publishing && location.latitude && location.longitude
    ? [...resultPoints, { id: 'location', label: 'Ubicación elegida', latitude: Number(location.latitude), longitude: Number(location.longitude) }]
    : workerAction === 'availability' || workerAction === 'choice'
      ? [...resultPoints, { id: 'chosen-zone', label: 'Zona elegida para ofrecer mi trabajo', ...workZone }]
      : resultPoints

  function selectResult(id: string) {
    if (id === 'chosen-zone') return startWorkerAction('choice')
    if (workerAction !== 'application') setWorkerAction(null)
    if (discoveryWorkers.some((worker) => worker.id === id)) {
      setSelectedWorkerId(id)
      setSelectedOfferId('')
    } else {
      setSelectedOfferId(id)
      setSelectedWorkerId('')
    }
    setDetailOpen(Boolean(id))
    if (compact && id) setResultsOpen(false)
  }

  function changeTab(next: string) {
    setWorkerAction(null)
    setTab(next)
    setSelectedOfferId('')
    setSelectedWorkerId('')
    setDetailOpen(false)
  }

  function startWorkerAction(mode: WorkerAction, zone?: WorkZone) {
    if (pending) return
    if (zone) setWorkZone(zone)
    setWorkerAction(mode)
    setTab('offers')
    setTradeId('')
    setSelectedOfferId('')
    setSelectedWorkerId('')
    setDetailOpen(true)
    if (compact) setResultsOpen(false)
  }

  function clickMap(latitude: number, longitude: number) {
    if (pending) return
    if (contractor) {
      if (!approved) return setError('Tu cuenta necesita aprobación para publicar una oferta.')
      startPublishing()
      setLocation({ latitude: String(latitude), longitude: String(longitude) })
    } else if (workerAction === 'application') {
      setWorkZone({ latitude, longitude })
      setDetailOpen(true)
      if (compact) setResultsOpen(false)
    } else startWorkerAction('choice', { latitude, longitude })
  }

  function startPublishing() {
    if (!publishing) setLocation({ latitude: '', longitude: '' })
    setPublishing(true)
    setDetailOpen(true)
    setTab('offers')
    if (compact) setResultsOpen(false)
  }

  return (
    <section className="map-workspace" aria-label="Vacantes y postulaciones" data-detail-open={detailOpen}>
      <DiscoveryMap points={points} selectedId={selectedWorkerId || selectedOfferId}
        onSelect={publishing || workerAction === 'availability' ? undefined : selectResult} onMapClick={clickMap}
        sidebarInsets={{ left: resultsOpen ? 352 : 0, right: detailOpen ? 432 : 0 }}
        onPick={pending ? undefined : publishing ? (latitude, longitude) => setLocation({ latitude: String(latitude), longitude: String(longitude) })
          : workerAction === 'availability' ? (latitude, longitude) => setWorkZone({ latitude, longitude }) : undefined} />

      <div className="map-toolbar">
        <button className="primary" aria-expanded={resultsOpen} aria-controls="results-panel" onClick={() => {
          setResultsOpen(!resultsOpen)
          if (!resultsOpen && compact) setDetailOpen(false)
        }}>{resultsOpen ? 'Ocultar explorador' : 'Explorar mapa'}</button>
        {contractor && <button className="primary" disabled={!approved || pending} onClick={startPublishing}>{publishing ? 'Continuar oferta' : '+ Crear oferta'}</button>}
        {!contractor && <button className="primary" disabled={pending} onClick={() => startWorkerAction('choice')}>+ Trabajo y postulaciones</button>}
        {!detailOpen && !publishing && (workerAction || selectedOffer || selectedWorker) && <button className="ghost" onClick={() => setDetailOpen(true)}>Abrir detalle</button>}
      </div>

      <aside id="results-panel" className="workspace-panel results-panel" hidden={!resultsOpen} aria-label="Explorar resultados">
        <div className="panel-heading"><h2>Explorar {PILOT_CITY}</h2><button className="ghost" onClick={() => setResultsOpen(false)} aria-label="Cerrar explorador">×</button></div>
        {contractor && !approved ? <p className="note">Tu cuenta espera aprobación manual para publicar ofertas y consultar trabajadores.</p> : <>
          <div className="actions workspace-tabs">
            <button className="ghost" disabled={pending || publishing} aria-pressed={tab === 'offers'} onClick={() => changeTab('offers')}>{contractor ? 'Mis ofertas' : 'Ofertas'}</button>
            <button className="ghost" disabled={pending || publishing} aria-pressed={tab === (contractor ? 'workers' : 'applications')} onClick={() => changeTab(contractor ? 'workers' : 'applications')}>{contractor ? 'Trabajadores' : 'Mis postulaciones'}</button>
          </div>
          <p className="note map-legend"><span>● Vacantes</span><span>● Trabajadores</span>{!contractor && <span>● Mis publicaciones</span>}</p>
          <p className="note">Los perfiles y vacantes marcados DEMO son ficticios para probar el mapa.</p>
          {!contractor && tab === 'offers' && <>
            <h3>Mis publicaciones ({myPublications.length})</h3>
            {myPublications.map((worker) => <button key={worker.id} className="result-card" onClick={() => selectResult(worker.id)} disabled={pending} aria-pressed={selectedWorkerId === worker.id}>
              <strong>{trades.find((trade) => trade.id === worker.trade_id)?.name} · Disponible</strong>
              <span>Zona: {worker.latitude.toFixed(3)}, {worker.longitude.toFixed(3)}</span>
              <span>Ver publicación →</span>
            </button>)}
            {myPublications.length === 0 && !loading && <p className="note">Todavía no hay publicaciones tuyas para este oficio.</p>}
          </>}
          {viewingWorkers ? <WorkerDiscovery trades={trades} workers={visibleWorkers} loading={loading}
            tradeId={tradeId} onTradeChange={(id) => { setTradeId(id); setSelectedWorkerId(''); setDetailOpen(false) }}
            onRefresh={() => setRefresh((value) => value + 1)} selectedId={selectedWorkerId} onSelect={selectResult} /> : <>
            <p className="note">{contractor ? 'Toca un punto del mapa para crear una oferta, o elige una existente para revisar sus candidatos.' : 'Toca un punto del mapa para ofrecer tu trabajo o elegir una oferta a la que postularte.'}</p>
            {tab === 'offers' && <label>Filtrar por oficio<select value={tradeId} onChange={(event) => { setTradeId(event.target.value); setSelectedOfferId(''); setDetailOpen(false) }}>
              <option value="">Todos los oficios</option>
              {trades.map((trade) => <option key={trade.id} value={trade.id}>{trade.name}</option>)}
            </select></label>}
            <button className="ghost" disabled={pending || loading} onClick={() => setRefresh((value) => value + 1)}>Actualizar listado</button>
            {loading ? <p className="note" role="status">Cargando vacantes…</p> : !loadFailed && <>
              <p className="result-count">{visible.length} {visible.length === 1 ? 'oferta' : 'ofertas'}</p>
              {visible.length === 0 && <p className="note">{tab === 'applications' ? 'Todavía no te has postulado.' : contractor ? 'Todavía no tienes ofertas. Usa Crear oferta para publicar la primera.' : 'No hay ofertas vigentes. Un contratante debe publicar una para que puedas postularte.'}</p>}
              {visible.map((offer) => <button key={offer.id} className="result-card" aria-pressed={selectedOfferId === offer.id} disabled={publishing} onClick={() => selectResult(offer.id)}>
                <strong>{offer.title}</strong><span>{trades.find((trade) => trade.id === offer.trade_id)?.name} · {offer.city}</span><span>{offer.status === 'open' ? 'Ver oferta' : offer.status === 'filled' ? 'Cubierta · Ver estado' : 'Cancelada · Ver estado'} →</span>
              </button>)}
            </>}
          </>}
        </>}
      </aside>

      <aside className="workspace-panel detail-panel" hidden={!detailOpen} aria-label={publishing ? 'Formulario de oferta' : workerAction ? 'Trabajo y postulaciones' : 'Detalle del resultado'}>
        <div className="panel-heading"><h2>{publishing ? 'Nueva oferta' : workerAction === 'choice' ? '¿Qué quieres hacer aquí?' : workerAction === 'availability' ? 'Ofrecer mi trabajo aquí' : workerAction === 'application' ? 'Postularme a una oferta' : selectedWorker ? 'Publicación del trabajador' : 'Oferta y postulaciones'}</h2><button className="ghost" onClick={() => setDetailOpen(false)} aria-label="Ocultar detalle">×</button></div>
        {publishing ? <OfferForm contractorId={profile.id} trades={trades} location={location} onLocationChange={setLocation}
          pending={pending || loading} onPublish={publish} onCancel={() => { setPublishing(false); setDetailOpen(false); setResultsOpen(true) }} />
          : workerAction ? <WorkerActions mode={workerAction} profile={profile} phone={phone} trades={trades} zone={workZone}
            offers={availableOffers} selectedOfferId={selectedOfferId} pending={pending || loading} loading={loading}
            onChoose={startWorkerAction} onSelectOffer={setSelectedOfferId} onPublish={publishAvailability} onApply={apply} />
          : selectedWorker ? <article className="card"><h3>{selectedWorker.profiles.full_name}</h3>
            <p>{trades.find((trade) => trade.id === selectedWorker.trade_id)?.name} · {selectedWorker.years_experience} años de experiencia</p>
            <p>{selectedWorker.city} · Radio de trabajo: {selectedWorker.work_radius_km} km</p>
            {selectedWorker.available_from && <p>Disponible desde: {selectedWorker.available_from}</p>}
            <p className="note">El celular se comparte cuando este trabajador se postula a una de tus ofertas.</p>
            <p>Zona: {selectedWorker.latitude.toFixed(3)}, {selectedWorker.longitude.toFixed(3)}</p>
            {selectedWorker.profiles.is_demo && <p className="note">Perfil DEMO: persona ficticia, sin datos de contacto reales.</p>}
            {contractor && <button className="primary" onClick={startPublishing}>Crear oferta para recibir postulaciones</button>}
            {selectedWorker.worker_id === profile.id && <button className="primary" onClick={() => startWorkerAction('availability', { latitude: selectedWorker.latitude, longitude: selectedWorker.longitude })}>Crear otra publicación en esta zona</button>}
          </article>
          : selectedOffer ? <OfferCard key={selectedOffer.id} offer={selectedOffer} trades={trades} profile={profile} contractor={contractor}
            applications={applications.filter((application) => application.job_offer_id === selectedOffer.id)}
            workers={workers} phones={phones} pending={pending || loading} onApply={apply} onAction={action} onCancel={cancel} />
          : <p className="note">Selecciona un resultado para ver su detalle.</p>}
      </aside>

      {(notice || error) && <div className="workspace-feedback">
        <div>{notice && <p className="note" role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
        <button className="ghost" aria-label="Cerrar aviso" onClick={() => { setNotice(''); setError('') }}>×</button>
      </div>}
    </section>
  )
}
