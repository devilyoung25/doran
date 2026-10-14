export function mapPadding(width, height, insets = {}) {
  const wide = width >= 1024
  return {
    topLeft: [wide ? (insets.left ?? 0) + 30 : 30, Math.min(110, height * 0.2)],
    bottomRight: [wide ? (insets.right ?? 0) + 30 : 30,
      !wide && (insets.left || insets.right) ? height * 0.55 + 12 : 30],
  }
}

export function formatPlace(properties = {}) {
  const field = (name) => typeof properties[name] === 'string' ? properties[name].trim() : ''
  const street = field('street') || (properties.type === 'street' ? field('name') : '')
  return {
    address: street ? [street, field('housenumber')].filter(Boolean).join(' ') : 'Dirección sin identificar',
    neighbourhood: field('district') || field('locality') || 'Barrio sin identificar',
    city: field('city') || field('county'),
  }
}

const places = new Map()
let queue = Promise.resolve()

// shortcut: public Photon service for this small demo; use a contracted provider if traffic grows.
export function resolvePlace(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return Promise.reject(new Error('Invalid location'))
  }
  const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`
  if (places.has(key)) return places.get(key)
  const lookup = queue.then(async () => {
    const response = await fetch(`https://photon.komoot.io/reverse?lat=${latitude}&lon=${longitude}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error('Address lookup failed')
    const data = await response.json()
    const properties = data.features?.[0]?.properties
    if (!properties) throw new Error('Address not found')
    return formatPlace(properties)
  })
  places.set(key, lookup)
  queue = lookup.catch(() => {}).then(() => new Promise((resolve) => setTimeout(resolve, 1000)))
  lookup.catch(() => places.delete(key))
  return lookup
}
