import { PILOT_CITY } from '../lib/profile.mjs'
import type { Trade, WorkerPublication } from '../lib/types'

export function WorkerDiscovery({ trades, workers, loading, tradeId, onTradeChange, onRefresh, selectedId, onSelect }: {
  trades: Trade[]
  workers: WorkerPublication[]
  loading: boolean
  tradeId: string
  onTradeChange: (id: string) => void
  onRefresh: () => void
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <section className="worker-results" aria-label="Trabajadores disponibles">
      <h2>Publicaciones de trabajadores en {PILOT_CITY}</h2>
      <label>Oficio del trabajador<select value={tradeId} onChange={(event) => onTradeChange(event.target.value)}>
        <option value="">Todos los oficios</option>
        {trades.map((trade) => <option key={trade.id} value={trade.id}>{trade.name}</option>)}
      </select></label>
      <button className="ghost" disabled={loading} onClick={onRefresh}>Actualizar trabajadores</button>
      <p className="note">Cada punto es una publicación con zona aproximada. Un trabajador puede tener varias.</p>
      {loading ? <p className="note">Cargando publicaciones…</p> : <>
        {workers.length === 0 && <p className="note">No hay publicaciones para este oficio.</p>}
        {workers.map((worker) => <button className="result-card" key={worker.id} aria-pressed={selectedId === worker.id} onClick={() => onSelect(worker.id)}>
          <strong>{worker.profiles.full_name}</strong>
          <span>{trades.find((trade) => trade.id === worker.trade_id)?.name} · {worker.years_experience} años de experiencia</span>
          <span>Zona: {worker.latitude.toFixed(3)}, {worker.longitude.toFixed(3)}</span>
          <span>Ver publicación →</span>
        </button>)}
      </>}
    </section>
  )
}
