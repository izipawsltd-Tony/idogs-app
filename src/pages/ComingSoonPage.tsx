import React from 'react'
import { useNavigate } from 'react-router-dom'

interface Props {
  feature: string
}

export default function ComingSoonPage({ feature }: Props) {
  const navigate = useNavigate()
  return (
    <div style={{ padding: 32 }}>
      <div className="empty-state" style={{ marginTop: 80 }}>
        <div className="empty-state-icon">🚧</div>
        <div className="empty-state-title">{feature}</div>
        <div className="empty-state-desc">
          This feature is currently in development and will be available in a future update.
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => navigate('/app/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    </div>
  )
}
