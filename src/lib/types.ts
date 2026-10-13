export type Role = 'worker' | 'contractor'
export type Trade = { id: number; name: string }

export type Profile = {
  id: string
  role: Role
  full_name: string
  company_name: string | null
  city: string
  trade_id: number | null
  years_experience: number | null
  availability: 'available' | 'busy' | 'unavailable' | null
  available_from: string | null
  work_radius_km: number | null
  latitude: number | null
  longitude: number | null
  contractor_approved_at: string | null
  is_demo: boolean
}

export type WorkerPublication = {
  id: string
  worker_id: string
  trade_id: number
  years_experience: number
  work_radius_km: number
  available_from: string | null
  city: string
  latitude: number
  longitude: number
  created_at: string
  profiles: Profile
}

export type Offer = {
  id: string
  contractor_id: string
  trade_id: number
  title: string
  description: string
  rate_type: 'daily' | 'fixed' | 'negotiable'
  rate_amount_cop: number | null
  start_date: string
  end_date: string | null
  city: string
  latitude: number
  longitude: number
  status: 'open' | 'filled' | 'cancelled'
}

export type Application = {
  id: string
  job_offer_id: string
  worker_id: string
  message: string | null
  status: 'submitted' | 'contacted' | 'selected' | 'rejected' | 'withdrawn'
  whatsapp_opened_at: string | null
}
