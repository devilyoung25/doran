import { useState, type FormEvent } from 'react'
import { buildProfile } from '../lib/profile.mjs'
import type { Offer, Profile, Trade } from '../lib/types'
import { ApplyForm } from './offer-card'
import { PlaceAddress } from './place-address'

export type WorkerAction = 'choice' | 'availability' | 'application'
export type WorkZone = { latitude: number; longitude: number }
export type AvailabilityRow = NonNullable<ReturnType<typeof buildProfile>['row']>

export function WorkerActions({ mode, profile, phone, trades, zone, offers, selectedOfferId, pending, loading, onChoose, onSelectOffer, onPublish, onApply }: {
  mode: WorkerAction
  profile: Profile
  phone: string
  trades: Trade[]
  zone: WorkZone
  offers: Offer[]
  selectedOfferId: string
  pending: boolean
  loading: boolean
  onChoose: (mode: WorkerAction) => void
  onSelectOffer: (id: string) => void
  onPublish: (row: AvailabilityRow) => Promise<void>
  onApply: (offerId: string, message: string, consent: boolean) => Promise<void>
}) {
  if (mode === 'availability') return <AvailabilityForm profile={profile} phone={phone} trades={trades} zone={zone} pending={pending} onPublish={onPublish} onCancel={() => onChoose('choice')} />
  if (mode === 'application') {
    const offer = offers.find((item) => item.id === selectedOfferId)
    return <div className="worker-results">
      {!offer && <p className="note">Elige una oferta publicada. Tu postulación queda vinculada a esa vacante.</p>}
      {loading ? <p className="note" role="status">Cargando ofertas…</p> : offers.length === 0 ? <p className="note">No hay ofertas vigentes a las que puedas postularte. Puedes ofrecer tu trabajo mientras un contratante publica una vacante.</p> : !offer && <label>Oferta a la que quiero postularme
        <select value="" disabled={pending} onChange={(event) => onSelectOffer(event.target.value)}>
          <option value="">Elegir una oferta</option>
          {offers.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>}
      {offer && <>
        <h3>{offer.title}</h3>
        <p>{offer.city} · Inicio: {offer.start_date}</p>
        <p className="description">{offer.description}</p>
        <PlaceAddress latitude={offer.latitude} longitude={offer.longitude} />
        <ApplyForm key={offer.id} offerId={offer.id} profile={profile} trades={trades} pending={pending} onApply={onApply} onCancel={() => onChoose('choice')} cancelLabel="Volver a las opciones" />
      </>}
      {!loading && offers.length === 0 && <button className="primary" disabled={pending} onClick={() => onChoose('availability')}>Ofrecer mi trabajo aquí</button>}
      {!offer && <button className="ghost" disabled={pending} onClick={() => onChoose('choice')}>Volver a las opciones</button>}
    </div>
  }
  return <div className="worker-results">
    <p className="note">Puedes aparecer como trabajador disponible o solicitar una vacante publicada.</p>
    <button className="result-card" disabled={pending} onClick={() => onChoose('availability')}>
      <strong>Ofrecer mi trabajo aquí</strong><span>Crear una publicación en esta zona y conservar las anteriores.</span>
    </button>
    <button className="result-card" disabled={pending} onClick={() => onChoose('application')}>
      <strong>Postularme a una oferta</strong><span>Elegir una vacante y enviar mi postulación al contratante.</span>
    </button>
  </div>
}

function AvailabilityForm({ profile, phone, trades, zone, pending, onPublish, onCancel }: {
  profile: Profile
  phone: string
  trades: Trade[]
  zone: WorkZone
  pending: boolean
  onPublish: (row: AvailabilityRow) => Promise<void>
  onCancel: () => void
}) {
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const built = buildProfile(profile.id, 'worker', {
      fullName: profile.full_name, phone, adult: true,
      tradeId: form.get('tradeId'), yearsExperience: form.get('yearsExperience'),
      availability: 'available', availableFrom: form.get('availableFrom'),
      workRadiusKm: form.get('workRadiusKm'), ...zone,
    }, true)
    if (!built.row) return setError(built.error ?? 'Revisa los datos de disponibilidad.')
    setError('')
    await onPublish(built.row)
  }
  return <form onSubmit={submit}>
    <p className="note">Crearás una publicación independiente en esta zona. Tus publicaciones anteriores se conservan.</p>
    <fieldset disabled={pending}>
      <label>Oficio principal<select name="tradeId" defaultValue={profile.trade_id ?? ''} autoFocus required>
        <option value="">Elegir oficio</option>
        {trades.map((trade) => <option key={trade.id} value={trade.id}>{trade.name}</option>)}
      </select></label>
      <label>Años de experiencia<input name="yearsExperience" type="number" min={0} max={60} defaultValue={profile.years_experience ?? 0} required /></label>
      <label>Disponible desde<input name="availableFrom" type="date" defaultValue={profile.available_from ?? ''} /></label>
      <label>Radio de trabajo (km)<input name="workRadiusKm" type="number" min={2} max={50} defaultValue={profile.work_radius_km ?? 10} required /></label>
      <div className="zone"><strong>Zona elegida</strong><PlaceAddress latitude={zone.latitude} longitude={zone.longitude} /><p>Toca otro punto del mapa para cambiarla. Se guardará una ubicación aproximada.</p></div>
      <p className="note">Los contratantes aprobados podrán ver tu perfil disponible. Tu celular se comparte al postularte a una de sus ofertas.</p>
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={pending}>{pending ? 'Publicando…' : 'Publicar mi disponibilidad'}</button>
    <button className="ghost" type="button" disabled={pending} onClick={onCancel}>Volver a las opciones</button>
  </form>
}
