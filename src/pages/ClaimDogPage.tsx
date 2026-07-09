import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { claimTransferredDogs } from '../lib/db'
import type { ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

interface ClaimableDog {
  id: string
  name: string
  breed: string
  profilePhoto: string | null
  transferredAt: string
}

export default function ClaimDogPage({ toast }: Props) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [dogs, setDogs] = useState<ClaimableDog[]>([])
  // Distinct from "genuinely 0 pending dogs" — claimTransferredDogs() now
  // throws real errors instead of swallowing them into an empty array, so
  // a failed check (bad token, network, server error) shows an actual
  // message here instead of the misleading "No pending transfers" state.
  const [loadError, setLoadError] = useState('')
  const [claimError, setClaimError] = useState('')

  useEffect(() => {
    if (!user?.email) return
    let active = true
    setLoadError('')
    claimTransferredDogs(user.uid, user.email, 'check')
      .then(foundDogs => {
        if (!active) return
        setDogs(foundDogs || [])
        setLoading(false)
      })
      .catch(err => {
        if (!active) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load pending transfers.')
        setLoading(false)
      })
    return () => { active = false }
  }, [user])

  async function handleClaim() {
    if (!user?.email) return
    setClaiming(true)
    setClaimError('')
    try {
      const claimed = await claimTransferredDogs(user.uid, user.email, 'claim')
      if (claimed > 0) {
        toast(`Successfully claimed ${claimed} dog${claimed !== 1 ? 's' : ''}!`, 'success')
        navigate('/app/dogs')
      } else {
        toast('No dogs found to claim.', 'info')
        setDogs([])
      }
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Failed to claim dogs. Please try again.')
    } finally {
      setClaiming(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 60, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
  }

  if (loadError) {
    return (
      <div style={{ padding: 32, maxWidth: 600, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 20 }}>Claim Dogs</h1>
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">⚠️</div>
            <div className="empty-state-title">Couldn&apos;t load pending transfers</div>
            <div className="empty-state-desc">{loadError}</div>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>Try again</button>
          </div>
        </div>
      </div>
    )
  }

  if (dogs.length === 0) {
    return (
      <div style={{ padding: 32, maxWidth: 600, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 20 }}>Claim Dogs</h1>
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🐾</div>
            <div className="empty-state-title">No pending transfers</div>
            <div className="empty-state-desc">We couldn't find any dogs waiting to be claimed by {user?.email}.</div>
            <Link to="/app/dashboard" className="btn btn-primary" style={{ marginTop: 12 }}>Back to dashboard</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 32, maxWidth: 700, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 8 }}>Claim Transferred Dogs</h1>
      <p style={{ fontSize: 15, color: 'var(--mid)', marginBottom: 24, lineHeight: 1.5 }}>
        A breeder has transferred ownership of the following dog(s) to your email address (<strong>{user?.email}</strong>). Accept the transfer to add them to your account.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {dogs.map(dog => (
          <div key={dog.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
              background: dog.profilePhoto ? `url(${dog.profilePhoto}) center/cover` : 'var(--brand-50)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24
            }}>
              {!dog.profilePhoto && '🐶'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>
                {dog.name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--mid)' }}>
                {dog.breed}
              </div>
            </div>
            <span className="badge badge-gray">Pending Claim</span>
          </div>
        ))}
      </div>

      {claimError && (
        <p className="form-error" style={{ textAlign: 'right', marginBottom: 12 }}>{claimError}</p>
      )}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Link to="/app/dashboard" className="btn btn-secondary">Maybe later</Link>
        <button
          className="btn btn-primary"
          onClick={handleClaim}
          disabled={claiming}
          style={{ minWidth: 140 }}
        >
          {claiming ? <span className="spinner" /> : `Accept ${dogs.length} dog${dogs.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}
