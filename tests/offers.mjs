import assert from 'node:assert/strict'
import { buildOffer, todayInColombia, marketplaceError } from '../src/lib/offers.mjs'

const input = {
  title: ' Oficial para obra ', description: ' Necesitamos un oficial para construir una vivienda. ',
  tradeId: '4', rateType: 'daily', rateAmount: '90000',
  startDate: '2026-10-14', endDate: '', latitude: '4.813', longitude: '-75.696',
}
const build = (changes = {}) => buildOffer('contractor-1', { ...input, ...changes }, '2026-10-13')
assert.equal(build().row.title, 'Oficial para obra')
assert.equal(build().row.city, 'Pereira')
assert.equal(build().row.rate_amount_cop, 90000)
assert.equal(build().row.end_date, null)
assert.equal(build().row.status, undefined)
assert.equal(build({ rateType: 'negotiable', rateAmount: 'ignored' }).row.rate_amount_cop, null)
for (const changes of [
  { title: 'Corto' }, { description: '' }, { tradeId: '' }, { rateType: 'hourly' },
  { rateAmount: '19999' }, { rateAmount: '90000.5' }, { rateAmount: '2000001' },
  { startDate: '2026-10-12' }, { startDate: '2026-02-30' }, { endDate: '2026-10-13' },
  { latitude: '' }, { latitude: 'NaN' }, { latitude: '91' }, { longitude: '-181' },
]) assert.ok(build(changes).error, JSON.stringify(changes))
assert.equal(todayInColombia(new Date('2026-10-14T02:00:00Z')), '2026-10-13')
assert.equal(todayInColombia(new Date('2026-10-14T05:00:00Z')), '2026-10-14')
assert.match(marketplaceError({ message: 'duplicate_application' }), /Ya te postulaste/)
assert.match(marketplaceError({ code: '42501', message: 'sensitive detail' }), /permiso/)
assert.ok(!marketplaceError({ message: 'sensitive detail' }).includes('sensitive detail'))
console.log('offer checks passed')
