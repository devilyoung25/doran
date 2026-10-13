import { useState, type FormEvent } from 'react'
import { PILOT_CITY } from '../lib/profile.mjs'
import { buildOffer, todayInColombia } from '../lib/offers.mjs'
import type { Trade } from '../lib/types'

export type OfferLocation = { latitude: string; longitude: string }

export function OfferForm({ contractorId, trades, pending, location, onLocationChange, onPublish, onCancel }: {
  contractorId: string
  trades: Trade[]
  pending: boolean
  location: OfferLocation
  onLocationChange: (location: OfferLocation) => void
  onPublish: (row: NonNullable<ReturnType<typeof buildOffer>['row']>) => Promise<void>
  onCancel: () => void
}) {
  const [rateType, setRateType] = useState('daily')
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = Object.fromEntries(new FormData(event.currentTarget))
    const result = buildOffer(contractorId, input)
    if (!result.row) return setError(result.error ?? 'Revisa los datos de la oferta.')
    setError('')
    await onPublish(result.row)
  }
  return (
    <form onSubmit={submit}>
      <h2>Crear oferta</h2>
      <p className="note">Una oferta cubre un solo puesto en {PILOT_CITY}.</p>
      <fieldset disabled={pending}>
        <h3>1. Trabajo requerido</h3>
        <label>Título<input name="title" minLength={10} maxLength={80} autoFocus required /></label>
        <label>Oficio<select name="tradeId" required>
          <option value="">Elegir</option>
          {trades.map((trade) => <option key={trade.id} value={trade.id}>{trade.name}</option>)}
        </select></label>
        <label>Descripción<textarea name="description" minLength={20} maxLength={1000} rows={4} required /></label>
        <h3>2. Pago y fechas</h3>
        <label>Modalidad de pago<select name="rateType" value={rateType} onChange={(event) => setRateType(event.target.value)}>
          <option value="daily">Por día</option>
          <option value="fixed">Por trabajo completo</option>
          <option value="negotiable">A convenir</option>
        </select></label>
        {rateType !== 'negotiable' && <label>Pago (COP)<input name="rateAmount" type="number" min={20000} max={2000000} step={1} required /></label>}
        <label>Fecha de inicio<input name="startDate" type="date" min={todayInColombia()} required /></label>
        <label>Fecha final (opcional)<input name="endDate" type="date" min={todayInColombia()} /></label>
        <h3>3. Ubicación de la obra</h3>
        <p className="note">Toca un punto del mapa para ubicar la obra en {PILOT_CITY}. Los datos del formulario se conservan mientras eliges.</p>
        <label>Latitud de la obra<input name="latitude" type="number" step="any" min={-90} max={90} placeholder="4.813" value={location.latitude} onChange={(event) => onLocationChange({ ...location, latitude: event.target.value })} required /></label>
        <label>Longitud de la obra<input name="longitude" type="number" step="any" min={-180} max={180} placeholder="-75.696" value={location.longitude} onChange={(event) => onLocationChange({ ...location, longitude: event.target.value })} required /></label>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={pending}>{pending ? 'Publicando…' : 'Publicar oferta'}</button>
      <button className="ghost" type="button" onClick={onCancel} disabled={pending}>Volver al listado</button>
    </form>
  )
}
