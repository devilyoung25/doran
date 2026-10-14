import assert from 'node:assert/strict'
import { formatPlace, mapPadding, resolvePlace } from '../src/lib/map.mjs'

assert.deepEqual(mapPadding(1440, 900, { left: 352, right: 432 }), {
  topLeft: [382, 110], bottomRight: [462, 30],
})
const mobilePadding = mapPadding(397, 700, { left: 0, right: 432 })
assert.equal(mobilePadding.topLeft[0], 30)
assert.ok(Math.abs(mobilePadding.bottomRight[1] - 397) < 0.001)
assert.ok(mobilePadding.topLeft[1] + mobilePadding.bottomRight[1] < 700)
assert.equal(mapPadding(397, 700).bottomRight[1], 30)
assert.deepEqual(formatPlace({ street: 'Carrera 9', housenumber: '21-22', district: 'Centro', city: 'Pereira' }), {
  address: 'Carrera 9 21-22', neighbourhood: 'Centro', city: 'Pereira',
})
assert.equal(formatPlace({ type: 'street', name: 'Calle 17', locality: 'Cuba' }).address, 'Calle 17')
assert.equal(formatPlace({ street: {}, district: 5 }).neighbourhood, 'Barrio sin identificar')
assert.equal(formatPlace({}).address, 'Dirección sin identificar')

let calls = 0
globalThis.fetch = async () => {
  calls += 1
  return { ok: true, json: async () => ({ features: [{ properties: { street: 'Carrera 9', district: 'Centro' } }] }) }
}
const first = resolvePlace(4.813, -75.696)
const second = resolvePlace(4.813, -75.696)
assert.equal(first, second)
assert.equal((await first).neighbourhood, 'Centro')
assert.equal(calls, 1)
await assert.rejects(resolvePlace(91, -75.696), /Invalid location/)
assert.equal(calls, 1)
globalThis.fetch = async () => ({ ok: false })
await assert.rejects(resolvePlace(4.8, -75.7), /Address lookup failed/)
globalThis.fetch = async () => ({ ok: true, json: async () => ({ features: [] }) })
await assert.rejects(resolvePlace(4.8, -75.7), /Address not found/)
console.log('map padding, address formatting, cache, validation and failure checks passed')
