import { PILOT_CITY } from './profile.mjs'

export const CONTACT_CONSENT_VERSION = 'contact-v1'

export function todayInColombia(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function buildOffer(contractorId, input, today = todayInColombia()) {
  const title = String(input.title ?? '').trim()
  const description = String(input.description ?? '').trim()
  if (title.length < 10 || title.length > 80) return { error: 'El título debe tener entre 10 y 80 caracteres.' }
  if (description.length < 20 || description.length > 1000) {
    return { error: 'La descripción debe tener entre 20 y 1000 caracteres.' }
  }
  const tradeId = Number(input.tradeId)
  if (!Number.isInteger(tradeId) || tradeId < 1) return { error: 'Elige el oficio requerido.' }
  const rateType = input.rateType
  if (!['daily', 'fixed', 'negotiable'].includes(rateType)) return { error: 'Elige la modalidad de pago.' }
  const amount = rateType === 'negotiable' ? null : Number(input.rateAmount)
  if (amount !== null && (!Number.isInteger(amount) || amount < 20000 || amount > 2000000)) {
    return { error: 'El pago debe ser un entero entre $20.000 y $2.000.000 COP.' }
  }
  const start = String(input.startDate ?? '')
  const end = String(input.endDate ?? '')
  if (!validDate(start) || start < today) return { error: 'La fecha de inicio debe ser hoy o posterior.' }
  if (end && (!validDate(end) || end < start)) return { error: 'La fecha final no puede ser anterior al inicio.' }
  const latitude = Number(input.latitude)
  const longitude = Number(input.longitude)
  if (String(input.latitude ?? '').trim() === '' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || String(input.longitude ?? '').trim() === '' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { error: 'Indica una ubicación válida para la obra.' }
  }
  return {
    row: {
      contractor_id: contractorId, trade_id: tradeId, title, description,
      rate_type: rateType, rate_amount_cop: amount,
      start_date: start, end_date: end || null, city: PILOT_CITY, latitude, longitude,
    },
  }
}

const ERRORS = {
  consent_required: 'Debes autorizar compartir tu celular con el contratante de esta oferta.',
  consent_version_required: 'Actualiza la página y acepta nuevamente la autorización.',
  duplicate_application: 'Ya te postulaste a esta oferta. Revisa Mis postulaciones.',
  phone_required: 'Guarda tu celular en el perfil antes de postularte.',
  offer_not_open: 'La vacante ya está cerrada. Actualiza el listado.',
  offer_expired: 'La fecha de inicio ya pasó. No se permiten nuevas postulaciones.',
  contact_required: 'Confirma primero que estableciste contacto con el trabajador.',
  cannot_withdraw: 'Solo puedes retirar una postulación pendiente de contacto.',
  not_allowed: 'Tu cuenta no tiene permiso o la postulación ya cambió de estado.',
  not_found: 'La oferta o postulación ya no está disponible para tu cuenta.',
  inactive_trade: 'Ese oficio ya no está activo. Elige otro.',
  message_too_long: 'El mensaje no puede superar 300 caracteres.',
}

export function marketplaceError(error) {
  if (error?.code === '42501') return ERRORS.not_allowed
  return ERRORS[error?.message] ?? 'No se pudo completar la operación. Actualiza e intenta de nuevo.'
}
