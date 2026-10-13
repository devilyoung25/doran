export const PILOT_CITY = 'Pereira'
export const PILOT_ZONE = { latitude: 4.813, longitude: -75.696 }
export const TERMS_VERSION = 'demo-v1'

const AVAILABILITY = ['available', 'busy', 'unavailable']

export function roundZone(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const rounded = Number(number.toFixed(3))
  return Number.isFinite(rounded) ? rounded : null
}

// National mobile, stored as +573 and nine more digits.
export function phoneToE164(input) {
  const digits = String(input ?? '').replace(/\D/g, '')
  const national = digits.startsWith('57') ? digits.slice(2) : digits
  if (!/^3\d{9}$/.test(national)) return null
  return `+57${national}`
}

export function buildProfile(userId, role, input, existing) {
  const fullName = String(input.fullName ?? '').trim()
  if (fullName.length < 2 || fullName.length > 120) {
    return { error: 'El nombre debe tener entre 2 y 120 caracteres.' }
  }
  const phone = phoneToE164(input.phone)
  if (!phone) return { error: 'El celular debe ser un número colombiano, por ejemplo 3001234567.' }
  if (input.adult !== true) return { error: 'Debes confirmar que eres mayor de edad.' }
  if (!existing && input.terms !== true) return { error: 'Confirma que estás probando la demo técnica.' }

  const base = { full_name: fullName, city: PILOT_CITY }

  if (role === 'contractor') {
    const companyName = String(input.companyName ?? '').trim()
    if (companyName.length < 2) return { error: 'La empresa debe tener al menos 2 caracteres.' }
    const row = {
      ...base,
      company_name: companyName,
      trade_id: null,
      years_experience: null,
      availability: null,
      available_from: null,
      work_radius_km: null,
      latitude: null,
      longitude: null,
    }
    if (!existing) {
      return {
        phone,
        row: {
          ...row,
          id: userId,
          role,
          is_adult: true,
          terms_version: TERMS_VERSION,
        },
      }
    }
    return { phone, row }
  }

  if (role !== 'worker') return { error: 'El rol no es válido.' }

  const tradeId = Number(input.tradeId)
  const years = Number(input.yearsExperience)
  const radius = Number(input.workRadiusKm)
  const latitude = roundZone(input.latitude)
  const longitude = roundZone(input.longitude)
  if (!Number.isInteger(tradeId) || tradeId < 1) return { error: 'Elige un oficio.' }
  if (!Number.isInteger(years) || years < 0 || years > 60) {
    return { error: 'Los años de experiencia van de 0 a 60.' }
  }
  if (!AVAILABILITY.includes(input.availability)) return { error: 'Elige tu disponibilidad.' }
  if (!Number.isInteger(radius) || radius < 2 || radius > 50) {
    return { error: 'El radio de trabajo va de 2 a 50 km.' }
  }
  if (latitude == null || latitude < -90 || latitude > 90) return { error: 'La latitud de la zona no es válida.' }
  if (longitude == null || longitude < -180 || longitude > 180) {
    return { error: 'La longitud de la zona no es válida.' }
  }

  const availableFrom = String(input.availableFrom ?? '').trim()
  const row = {
    ...base,
    company_name: null,
    trade_id: tradeId,
    years_experience: years,
    availability: input.availability,
    available_from: availableFrom || null,
    work_radius_km: radius,
    latitude,
    longitude,
  }
  if (!existing) {
    return {
      phone,
      row: {
        ...row,
        id: userId,
        role,
        is_adult: true,
        terms_version: TERMS_VERSION,
      },
    }
  }
  return { phone, row }
}
