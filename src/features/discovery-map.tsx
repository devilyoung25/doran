import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { PILOT_ZONE } from '../lib/profile.mjs'
import { mapPadding } from '../lib/map.mjs'

export type MapPoint = { id: string; latitude: number; longitude: number; label: string; kind?: 'offer' | 'worker' | 'mine' }

export function DiscoveryMap({ points, selectedId, onSelect, onPick, onMapClick, sidebarInsets, initialCenter = PILOT_ZONE, locateOnMount = false }: {
  points: MapPoint[]
  selectedId?: string
  onSelect?: (id: string) => void
  onPick?: (latitude: number, longitude: number) => void
  onMapClick?: (latitude: number, longitude: number) => void
  sidebarInsets?: { left: number; right: number }
  initialCenter?: { latitude: number; longitude: number }
  locateOnMount?: boolean
}) {
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef<L.LayerGroup | null>(null)
  const pick = useRef(onPick)
  const click = useRef(onMapClick)
  const focused = useRef('')
  const touched = useRef(false)
  const insets = useRef(sidebarInsets)
  const currentPoints = useRef(points)
  const [locationNotice, setLocationNotice] = useState('')
  const [tileError, setTileError] = useState(false)
  pick.current = onPick
  click.current = onMapClick
  insets.current = sidebarInsets
  currentPoints.current = points

  function focus(instance: L.Map, position: L.LatLngTuple, maxZoom = 16) {
    const size = instance.getSize()
    const padding = mapPadding(size.x, size.y, insets.current)
    instance.flyToBounds(L.latLngBounds([position]), {
      maxZoom, paddingTopLeft: padding.topLeft as L.PointTuple,
      paddingBottomRight: padding.bottomRight as L.PointTuple, duration: 0.4,
    })
  }

  useEffect(() => {
    if (!element.current) return
    const instance = L.map(element.current, { scrollWheelZoom: true }).setView([initialCenter.latitude, initialCenter.longitude], 16)
    map.current = instance
    markers.current = L.layerGroup().addTo(instance)
    const cartoKey = import.meta.env.VITE_CARTO_API_KEY
    const tiles = L.tileLayer(cartoKey
      ? `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(cartoKey)}`
      : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        + (cartoKey ? ' &copy; <a href="https://carto.com/attribution/">CARTO</a>' : ''),
      maxZoom: 19,
    }).addTo(instance)
    tiles.on('tileerror', () => setTileError(true))
    tiles.on('tileload', () => setTileError(false))
    instance.on('click', (event: L.LeafletMouseEvent) => {
      touched.current = true
      const handler = pick.current ?? click.current
      handler?.(Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6)))
    })
    instance.on('dragstart', () => { touched.current = true })
    instance.on('zoomstart', () => { touched.current = true })
    let userLocation: L.CircleMarker | null = null
    instance.on('locationfound', (event: L.LocationEvent) => {
      setLocationNotice('')
      userLocation?.remove()
      userLocation = L.circleMarker(event.latlng, { radius: 7, color: '#fff', weight: 3, fillColor: '#315ba8', fillOpacity: 1 })
        .addTo(instance).bindTooltip('Tu ubicación actual')
      if (!touched.current) focus(instance, [event.latlng.lat, event.latlng.lng])
    })
    instance.on('locationerror', () => {
      setLocationNotice('No pudimos usar tu ubicación. Puedes elegir un punto o pulsar Mi ubicación para reintentar.')
      if (!touched.current) focus(instance, [initialCenter.latitude, initialCenter.longitude])
    })
    function locate() {
      touched.current = false
      setLocationNotice('Buscando tu ubicación…')
      instance.locate({ setView: false, enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
    }
    const controls = new L.Control({ position: 'topleft' })
    controls.onAdd = () => {
      const container = L.DomUtil.create('div', 'leaflet-bar map-view-controls')
      L.DomEvent.disableClickPropagation(container)
      L.DomEvent.disableScrollPropagation(container)
      for (const [label, icon, action] of [
        ['Mi ubicación', '⌖', locate],
        ['Ver todos los puntos', '▣', () => {
          const positions = currentPoints.current.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
            .map((point) => [point.latitude, point.longitude] as L.LatLngTuple)
          if (!positions.length) return
          touched.current = true
          const size = instance.getSize()
          const padding = mapPadding(size.x, size.y, insets.current)
          instance.flyToBounds(L.latLngBounds(positions), { maxZoom: 16,
            paddingTopLeft: padding.topLeft as L.PointTuple, paddingBottomRight: padding.bottomRight as L.PointTuple, duration: 0.4 })
        }],
      ] as const) {
        const button = L.DomUtil.create('button', '', container)
        button.type = 'button'
        button.textContent = icon
        button.title = label
        button.setAttribute('aria-label', label)
        L.DomEvent.on(button, 'click', action)
      }
      return container
    }
    controls.addTo(instance)
    if (locateOnMount) locate()
    else focus(instance, [initialCenter.latitude, initialCenter.longitude])
    const resize = new ResizeObserver(() => instance.invalidateSize())
    resize.observe(element.current)
    return () => {
      resize.disconnect()
      instance.remove()
      map.current = null
      markers.current = null
      focused.current = ''
    }
  }, [])

  useEffect(() => {
    if (!map.current || !markers.current) return
    markers.current.clearLayers()
    for (const point of points) {
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
        || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) continue
      const position: L.LatLngTuple = [point.latitude, point.longitude]
      const icon = L.divIcon({
        className: `map-pin ${point.kind ?? ''}${point.id === selectedId ? ' selected' : ''}`,
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
    const selected = points.find((point) => point.id === selectedId)
    const key = JSON.stringify([selectedId, selected?.latitude, selected?.longitude, sidebarInsets])
    if (selected && Number.isFinite(selected.latitude) && Number.isFinite(selected.longitude) && key !== focused.current) {
      touched.current = true
      focus(map.current, [selected.latitude, selected.longitude])
    }
    focused.current = key
  }, [points, selectedId, onSelect, sidebarInsets])

  return (
    <div className="map-section">
      <div ref={element} className={onPick ? 'discovery-map picking' : 'discovery-map'} role="region" aria-label={onPick ? 'Mapa para elegir ubicación' : 'Mapa de resultados'} />
      {onPick && <p className="note">Toca el mapa para elegir la ubicación.</p>}
      {locationNotice && <p className="note" role="status">{locationNotice}</p>}
      {tileError && <p className="note" role="status">No se pudo cargar parte del mapa. El listado sigue disponible.</p>}
    </div>
  )
}
