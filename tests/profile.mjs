import assert from 'node:assert/strict'
import { PILOT_CITY, buildProfile, phoneToE164 } from '../src/lib/profile.mjs'

assert.equal(phoneToE164('3001234567'), '+573001234567')
assert.equal(phoneToE164('+57 300 123 4567'), '+573001234567')
assert.equal(phoneToE164('573001234567'), '+573001234567')
assert.equal(phoneToE164('300123456'), null)
assert.equal(phoneToE164('2001234567'), null)

const worker = buildProfile('user-1', 'worker', {
  fullName: ' Ana Gómez ',
  companyName: 'no debe guardarse',
  tradeId: 4,
  yearsExperience: 8,
  availability: 'available',
  availableFrom: '',
  workRadiusKm: 10,
  latitude: 4.8134,
  longitude: -75.6964,
  phone: '3001234567',
  adult: true,
  terms: true,
}, false)

assert.equal(worker.error, undefined)
assert.equal(worker.row.city, PILOT_CITY)
assert.equal(worker.row.city, 'Pereira')
assert.equal(worker.row.company_name, null)
assert.equal(worker.row.latitude, 4.813)
assert.equal(worker.row.longitude, -75.696)
assert.equal(worker.row.role, 'worker')
assert.equal(worker.row.terms_version, 'demo-v1')
assert.equal(worker.phone, '+573001234567')

const contractor = buildProfile('user-2', 'contractor', {
  fullName: 'Luis Pérez',
  companyName: ' Obras Pérez ',
  phone: '3010001122',
  adult: true,
  terms: true,
}, false)

assert.equal(contractor.row.city, 'Pereira')
assert.equal(contractor.row.company_name, 'Obras Pérez')
assert.equal(contractor.row.trade_id, null)
assert.equal(contractor.row.latitude, null)
assert.equal(contractor.row.availability, null)

const edit = buildProfile('user-2', 'contractor', {
  fullName: 'Luis Pérez',
  companyName: 'Obras Pérez',
  phone: '3010001122',
  adult: true,
}, true)
assert.equal(edit.row.role, undefined)
assert.equal(edit.row.id, undefined)

assert.equal(buildProfile('user-1', 'worker', {
  fullName: 'Ana',
  tradeId: 1,
  yearsExperience: 1,
  availability: 'available',
  workRadiusKm: 10,
  latitude: 4.813,
  longitude: -75.696,
  phone: '3001234567',
  adult: false,
  terms: true,
}, false).error, 'Debes confirmar que eres mayor de edad.')

console.log('profile checks passed')

const availabilityInput = {
  fullName: 'Ana Gómez', phone: '+573001234567', adult: true,
  tradeId: 4, yearsExperience: 8, availability: 'available', availableFrom: '',
  workRadiusKm: 15, latitude: 4.821234, longitude: -75.701234,
}
const availability = buildProfile('user-1', 'worker', availabilityInput, true)
assert.equal(availability.row.availability, 'available')
assert.equal(availability.row.latitude, 4.821)
assert.equal(availability.row.longitude, -75.701)
assert.equal(availability.row.work_radius_km, 15)
for (const key of ['id', 'role', 'phone', 'is_adult', 'terms_version', 'contractor_approved_at']) {
  assert.equal(availability.row[key], undefined, `availability update must not write ${key}`)
}
assert.ok(buildProfile('user-1', 'worker', { ...availabilityInput, workRadiusKm: 51 }, true).error)
assert.ok(buildProfile('user-1', 'worker', { ...availabilityInput, latitude: 91 }, true).error)
console.log('availability update checks passed')
