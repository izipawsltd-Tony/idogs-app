import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDogs } from '../lib/db'
import { getDogAge, LIFE_STAGE_EMOJI, LIFE_STAGE_LABELS, calculateLifeStage } from '../lib/utils'
import type { Dog, LifeStage, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

export default function DogListPage({ toast }: Props) {
  const [dogs, setDogs] = useState<Dog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStage, setFilterStage] = useState<LifeStage | 'all'>('all')
  const [showTransferred, setShowTransferred] = useState(false)

  useEffect(() => {
    getDogs().then(setDogs).catch(() => toast('Failed to load dogs', 'error')).finally(() => setLoading(false))
  }, [])

  const activeDogs = dogs.filter(d => (d as any).status !== 'transferred')
  const transferredDogs = dogs.filter(d => (d as any).status === 'transferred')

  const filtered = (showTransferred ? dogs : activeDogs).filter(d => {
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.breed.toLowerCase().includes(search.toLowerCase())
    const actualStage = d.isDeceased ? 'remembered' : calculateLifeStage(d.dateOfBirth, d.breed)
    const matchStage = filterStage === 'all' || actualStage === filterStage
    return matchSearch && matchStage
  })

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 2 }}>My dogs</h1>
          <p style={{ fontSize: 14, color: 'var(--light)' }}>{activeDogs.length} dog{activeDogs.length !== 1 ? 's' : ''} registered</p>
        </div>
        <Link to="/app/dogs/new" className="btn btn-primary">+ Add dog</Link>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="form-input"
          style={{ maxWidth: 260 }}
          type="text"
          placeholder="Search name or breed…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', 'whelp', 'puppy', 'young_adult', 'adult', 'senior'] as const).map(stage => (
            <button
              key={stage}
              onClick={() => setFilterStage(stage)}
              style={{
                padding: '7px 14px',
                borderRadius: 20,
                border: '1.5px solid',
                borderColor: filterStage === stage ? 'var(--green)' : 'var(--border)',
                background: filterStage === stage ? 'var(--green-light)' : 'var(--white)',
                color: filterStage === stage ? 'var(--green)' : 'var(--mid)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {stage === 'all' ? 'All' : `${LIFE_STAGE_EMOJI[stage]} ${LIFE_STAGE_LABELS[stage]}`}
            </button>
          ))}

          {/* Transferred toggle */}
          {transferredDogs.length > 0 && (
            <button
              onClick={() => setShowTransferred(p => !p)}
              style={{
                padding: '7px 14px',
                borderRadius: 20,
                border: '1.5px solid',
                borderColor: showTransferred ? 'var(--mid)' : 'var(--border)',
                background: showTransferred ? 'var(--sand)' : 'var(--white)',
                color: showTransferred ? 'var(--dark)' : 'var(--light)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              🔄 Transferred ({transferredDogs.length})
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🔍</div>
            <div className="empty-state-title">{search ? 'No dogs found' : 'No dogs yet'}</div>
            <div className="empty-state-desc">{search ? 'Try a different search term.' : 'Add your first dog to get started.'}</div>
            {!search && <Link to="/app/dogs/new" className="btn btn-primary" style={{ marginTop: 8 }}>Add dog</Link>}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {filtered.map(dog => <DogCard key={dog.id} dog={dog} />)}
        </div>
      )}
    </div>
  )
}

function DogCard({ dog }: { dog: Dog }) {
  const isTransferred = (dog as any).status === 'transferred'
  const actualStage = dog.isDeceased ? 'remembered' : calculateLifeStage(dog.dateOfBirth, dog.breed)
  return (
    <Link to={`/app/dogs/${dog.id}`} style={{ textDecoration: 'none' }}>
      <div className="card" style={{
        padding: 0, overflow: 'hidden', cursor: 'pointer',
        transition: 'border-color 0.15s, transform 0.15s',
        opacity: isTransferred ? 0.6 : 1,
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--green)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none' }}
      >
        {/* Photo banner */}
        <div style={{
          height: 100,
          background: dog.profilePhoto
            ? `url(${dog.profilePhoto}) center/cover`
            : 'linear-gradient(135deg, var(--green-light), var(--sand))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 44,
          position: 'relative',
        }}>
          {!dog.profilePhoto && LIFE_STAGE_EMOJI[actualStage]}
          {isTransferred && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(255,255,255,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mid)', background: 'rgba(255,255,255,0.9)', padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)' }}>
                Transferred
              </span>
            </div>
          )}
        </div>

        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--dark)' }}>{dog.name}</div>
              <div style={{ fontSize: 13, color: 'var(--light)' }}>{dog.breed}</div>
            </div>
            <span style={{ fontSize: 13, color: 'var(--mid)' }}>{dog.sex === 'female' ? '♀' : '♂'}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, color: 'var(--light)' }}>{getDogAge(dog.dateOfBirth)}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {isTransferred ? (
                <span className="badge badge-gray" style={{ fontSize: 10 }}>→ {(dog as any).buyerName}</span>
              ) : (
                <span className="badge badge-green" style={{ fontSize: 10 }}>QR ✓</span>
              )}
              <span className="badge badge-gray" style={{ fontSize: 10 }}>
                {LIFE_STAGE_EMOJI[actualStage]} {LIFE_STAGE_LABELS[actualStage]}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}
