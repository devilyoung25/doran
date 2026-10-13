import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { PILOT_ZONE } from '../lib/profile.mjs'

export type MapPoint = { id: string; latitude: number; longitude: number; label: string }

export function DiscoveryMap({ points, selectedId, onSelect, onPick, onMapClick, sidebarInsets }: {
  points: MapPoint[]
  selectedId?: string
  onSelect?: (id: string) => void
  onPick?: (latitude: number, longitude: number) => void
  onMapClick?: (latitude: number, longitude: number) => void
  sidebarInsets?: { left: number; right: number }
}) {
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef<L.LayerGroup | null>(null)
  const pick = useRef(onPick)
  const click = useRef(onMapClick)
  const fitted = useRef('')
  const [tileError, setTileError] = useState(false)
  pick.current = onPick
  click.current = onMapClick

  useEffect(() => {
    if (!element.current) return
    const instance = L.map(element.current, { scrollWheelZoom: false }).setView([PILOT_ZONE.latitude, PILOT_ZONE.longitude], 12)
    map.current = instance
    markers.current = L.layerGroup().addTo(instance)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(instance)
    tiles.on('tileerror', () => setTileError(true))
    tiles.on('tileload', () => setTileError(false))
    instance.on('click', (event: L.LeafletMouseEvent) => {
      const handler = pick.current ?? click.current
      handler?.(Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6)))
    })
    const resize = new ResizeObserver(() => instance.invalidateSize())
    resize.observe(element.current)
    return () => {
      resize.disconnect()
      instance.remove()
      map.current = null
      markers.current = null
      fitted.current = ''
    }
  }, [])

  useEffect(() => {
    if (!map.current || !markers.current) return
    markers.current.clearLayers()
    const positions: L.LatLngTuple[] = []
    for (const point of points) {
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
        || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) continue
      const position: L.LatLngTuple = [point.latitude, point.longitude]
      positions.push(position)
      const icon = L.divIcon({
        className: point.id === selectedId ? 'map-pin selected' : 'map-pin',
        html: '<span aria-hidden="true"></span>', iconSize: [26, 26], iconAnchor: [13, 13],
      })
      const marker = L.marker(position, { icon, title: point.label, keyboard: true }).addTo(markers.current)
      const label = document.createElement('span')
      label.textContent = point.label
      marker.bindTooltip(label)
      marker.getElement()?.setAttribute('aria-label', point.label)
      marker.on('click', () => onSelect?.(point.id))
    }
    map.current.invalidateSize()
    const size = map.current.getSize()
    const wide = size.x >= 1024
    const left = wide ? sidebarInsets?.left ?? 0 : 0
    const right = wide ? sidebarInsets?.right ?? 0 : 0
    const bottom = !wide && sidebarInsets && (sidebarInsets.left || sidebarInsets.right) ? size.y * 0.55 + 12 : 0
    const key = JSON.stringify([positions, left, right, bottom])
    if (!pick.current && positions.length && key !== fitted.current) {
      map.current.fitBounds(L.latLngBounds(positions), { paddingTopLeft: [left + 30, 30], paddingBottomRight: [right + 30, bottom + 30], maxZoom: 14 })
    }
    fitted.current = key
  }, [points, selectedId, onSelect, sidebarInsets])

  return (
    <div className="map-section">
      <div ref={element} className={onPick ? 'discovery-map picking' : 'discovery-map'} role="region" aria-label={onPick ? 'Mapa para elegir ubicación' : 'Mapa de resultados'} />
      {onPick && <p className="note">Toca el mapa para elegir la ubicación.</p>}
      {tileError && <p className="note" role="status">No se pudo cargar parte del mapa. El listado y las coordenadas siguen disponibles.</p>}
    </div>
  )
}
