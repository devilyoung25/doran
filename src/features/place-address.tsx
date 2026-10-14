import { useEffect, useState } from 'react'
import { formatPlace, resolvePlace } from '../lib/map.mjs'

export function PlaceAddress({ latitude, longitude }: { latitude: number; longitude: number }) {
  const [place, setPlace] = useState<ReturnType<typeof formatPlace> | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    setPlace(null)
    setFailed(false)
    const timer = setTimeout(() => {
      resolvePlace(latitude, longitude).then((result: ReturnType<typeof formatPlace>) => {
        if (!cancelled) setPlace(result)
      }).catch(() => { if (!cancelled) setFailed(true) })
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [latitude, longitude])
  return <span className="place-address">
    {place ? <><span>Dirección cercana: {place.address}</span><span>Barrio: {place.neighbourhood}{place.city && ` · ${place.city}`}</span></>
      : failed ? 'No pudimos identificar la dirección. La ubicación elegida sigue disponible en el mapa.' : 'Buscando dirección y barrio…'}
  </span>
}
