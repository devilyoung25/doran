import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PILOT_CITY } from '../lib/profile.mjs'
import { marketplaceError } from '../lib/offers.mjs'
import type { Profile, Trade } from '../lib/types'

export function WorkerDiscovery({ trades, selectedId, onSelect, onWorkersChange }: {
  trades: Trade[]
  selectedId: string
  onSelect: (id: string) => void
  onWorkersChange: (workers: Profile[]) => void
}) {
  const [workers, setWorkers] = useState<Profile[]>([])
  const [tradeId, setTradeId] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setLoading(true)
    setError('')
    onWorkersChange([])
    // shortcut: latest 50 available workers, add pagination when the pilot grows.
    let query = supabase.from('profiles').select('*').eq('role', 'worker')
      .eq('city', PILOT_CITY).eq('availability', 'available').order('updated_at', { ascending: false }).limit(50)
    if (tradeId) query = query.eq('trade_id', Number(tradeId))
    query.then(({ data, error: failure }) => {
      if (cancelled) return
      if (failure) setError(marketplaceError(failure))
      else {
        const next = (data ?? []) as Profile[]
        setWorkers(next)
        onWorkersChange(next)
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [tradeId, refresh, onWorkersChange])

  return (
    <section className="worker-results" aria-label="Trabajadores disponibles">
        <h2>Trabajadores disponibles en {PILOT_CITY}</h2>
        <label>Oficio del trabajador<select value={tradeId} onChange={(event) => { setTradeId(event.target.value); onSelect('') }}>
          <option value="">Todos los oficios</option>
          {trades.map((trade) => <option key={trade.id} value={trade.id}>{trade.name}</option>)}
        </select></label>
        <button className="ghost" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Actualizar trabajadores</button>
        <p className="note">Disponibilidad declarada y zona aproximada. Para compartir el celular, el trabajador debe postularse a una de tus vacantes.</p>
        {error && <p className="error" role="alert">{error}</p>}
      {loading ? <p className="note">Cargando trabajadores…</p> : !error && <>
        {workers.length === 0 && <p className="note">No hay trabajadores disponibles para este oficio.</p>}
        {workers.map((worker) => <button className="result-card" key={worker.id} aria-pressed={selectedId === worker.id} onClick={() => onSelect(worker.id)}>
          <strong>{worker.full_name}</strong>
          <span>{trades.find((trade) => trade.id === worker.trade_id)?.name} · {worker.years_experience} años de experiencia</span>
          <span>Ver perfil →</span>
        </button>)}
      </>}
    </section>
  )
}
