import { useEffect, useRef, useState, type FormEvent } from 'react'
import { todayInColombia } from '../lib/offers.mjs'
import type { Application, Offer, Profile, Trade } from '../lib/types'
import { PlaceAddress } from './place-address'

export type ApplicationAction = 'withdraw_application' | 'register_whatsapp_click' | 'confirm_contact' | 'reject_application' | 'select_candidate'

const APPLICATION_LABEL = {
  submitted: 'Postulada', contacted: 'Contacto confirmado', selected: 'Seleccionada',
  rejected: 'Descartada', withdrawn: 'Retirada',
}
const OFFER_LABEL = { open: 'Abierta', filled: 'Cubierta', cancelled: 'Cancelada' }
const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

export function OfferCard({ offer, trades, profile, contractor, applications, workers, phones, pending, onApply, onAction, onCancel }: {
  offer: Offer
  trades: Trade[]
  profile: Profile
  contractor: boolean
  applications: Application[]
  workers: Profile[]
  phones: Record<string, string>
  pending: boolean
  onApply: (offerId: string, message: string, consent: boolean) => Promise<void>
  onAction: (action: ApplicationAction, applicationId: string, phone?: string) => Promise<void>
  onCancel: (offerId: string) => Promise<void>
}) {
  const [applying, setApplying] = useState(false)
  return (
    <article className="card offer">
      <div className="facts"><span>{OFFER_LABEL[offer.status]}</span><span>{trades.find((trade) => trade.id === offer.trade_id)?.name ?? 'Oficio'}</span></div>
      <h3>{offer.title}</h3>
      <p className="description">{offer.description}</p>
      <p>{offer.rate_type === 'negotiable' ? 'Pago a convenir' : `${pesos.format(offer.rate_amount_cop ?? 0)} ${offer.rate_type === 'daily' ? 'por día' : 'por trabajo completo'}`}</p>
      <p>{offer.city} · Inicio: {offer.start_date}{offer.end_date && ` · Fin: ${offer.end_date}`}</p>
      <PlaceAddress latitude={offer.latitude} longitude={offer.longitude} />
      <a href={`https://www.openstreetmap.org/?mlat=${offer.latitude}&mlon=${offer.longitude}#map=16/${offer.latitude}/${offer.longitude}`} target="_blank" rel="noopener noreferrer">Ver ubicación de la obra</a>
      {applications.map((application) => (
        <div className="application" key={application.id}>
          {contractor && <strong>{workers.find((worker) => worker.id === application.worker_id)?.full_name ?? 'Trabajador'}</strong>}
          {contractor && workers.filter((worker) => worker.id === application.worker_id).map((worker) => <p key={worker.id}>
            {trades.find((trade) => trade.id === worker.trade_id)?.name} · {worker.years_experience} años de experiencia
          </p>)}
          <p className="chip">{APPLICATION_LABEL[application.status]}</p>
          {application.message && <p className="description">{application.message}</p>}
          {contractor && <CandidateActions application={application} open={offer.status === 'open'} phone={phones[application.worker_id]} pending={pending} onAction={onAction} />}
          {!contractor && application.status === 'submitted' && (
            <button className="ghost" disabled={pending} onClick={() => onAction('withdraw_application', application.id)}>Retirar postulación</button>
          )}
        </div>
      ))}
      {!contractor && applications.length === 0 && offer.status === 'open' && offer.start_date >= todayInColombia() && (
        applying ? <ApplyForm offerId={offer.id} profile={profile} trades={trades} pending={pending} onApply={onApply} onCancel={() => setApplying(false)} />
          : <button className="primary" disabled={pending} onClick={() => setApplying(true)}>Postularme a esta oferta</button>
      )}
      {contractor && applications.length === 0 && <p className="note">Todavía no hay postulaciones.</p>}
      {contractor && offer.status === 'open' && <button className="ghost" disabled={pending} onClick={() => {
        if (window.confirm('¿Cancelar esta vacante y descartar sus postulaciones pendientes?')) void onCancel(offer.id)
      }}>Cancelar vacante</button>}
    </article>
  )
}

export function ApplyForm({ offerId, profile, trades, pending, onApply, onCancel, cancelLabel = 'Volver al detalle' }: {
  offerId: string
  profile: Profile
  trades: Trade[]
  pending: boolean
  onApply: (offerId: string, message: string, consent: boolean) => Promise<void>
  onCancel: () => void
  cancelLabel?: string
}) {
  const [consent, setConsent] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    await onApply(offerId, String(data.get('message') ?? ''), consent)
  }
  return (
    <form className="apply-form" onSubmit={submit}>
      <h3 ref={heading} tabIndex={-1}>Crear postulación</h3>
      <div className="zone"><strong>1. Tu perfil</strong><p>{profile.full_name} · {trades.find((trade) => trade.id === profile.trade_id)?.name} · {profile.years_experience} años de experiencia</p></div>
      <h3>2. Mensaje al contratante</h3>
      <label>Mensaje (opcional)<textarea name="message" rows={2} maxLength={300} disabled={pending} /></label>
      <h3>3. Compartir contacto</h3>
      <label className="check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={pending} required />
        Autorizo compartir mi celular con el contratante de esta oferta para que me contacte por esta vacante.
      </label>
      <button className="primary" disabled={pending || !consent}>{pending ? 'Enviando…' : 'Enviar postulación'}</button>
      <button className="ghost" type="button" disabled={pending} onClick={onCancel}>{cancelLabel}</button>
    </form>
  )
}

function CandidateActions({ application, open, phone, pending, onAction }: {
  application: Application
  open: boolean
  phone?: string
  pending: boolean
  onAction: (action: ApplicationAction, applicationId: string, phone?: string) => Promise<void>
}) {
  const canContact = ['submitted', 'contacted', 'selected'].includes(application.status)
  return (
    <>
      {canContact && <button className="ghost" disabled={pending || !phone} onClick={() => onAction('register_whatsapp_click', application.id, phone)}>Abrir WhatsApp</button>}
      {application.whatsapp_opened_at && <p className="note">Se registró un intento de abrir WhatsApp. Eso no confirma contacto ni contratación.</p>}
      {open && application.status === 'submitted' && <button className="primary" disabled={pending} onClick={() => onAction('confirm_contact', application.id)}>Confirmar que establecí contacto</button>}
      {open && application.status === 'contacted' && <button className="primary" disabled={pending} onClick={() => {
        if (window.confirm('¿Seleccionar a este trabajador? La vacante quedará cubierta y las demás postulaciones pendientes se descartarán.')) void onAction('select_candidate', application.id)
      }}>Seleccionar y cubrir vacante</button>}
      {open && ['submitted', 'contacted'].includes(application.status) && <button className="ghost" disabled={pending} onClick={() => onAction('reject_application', application.id)}>Descartar postulación</button>}
    </>
  )
}
