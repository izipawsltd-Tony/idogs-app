import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
  const [filterStage, setFilterStage] = useState<LifeStage | 'all' | 'transferred' | 'puppies'>('all')
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const stage = searchParams.get('stage')
    const valid = ['whelp', 'puppy', 'young_adult', 'adult', 'senior', 'remembered']
    if (stage === 'puppies') setFilterStage('puppies')
    else if (stage && valid.includes(stage)) setFilterStage(stage as LifeStage)
  }, [])

  useEffect(() => {
    getDogs()
      .then(result => { setDogs(result); setLoading(false) })
      .catch(() => { toast('Failed to load dogs', 'error'); setLoading(false) })
  }, [])

  const activeDogs = dogs.filter(d => d.status !== 'transferred')
  const transferredDogs = dogs.filter(d => d.status === 'transferred')

  const filtered = dogs.filter(d => {
    const matchSearch = !search || (d.name || '').toLowerCase().includes(search.toLowerCase()) || (d.breed || '').toLowerCase().includes(search.toLowerCase())
    const isTransferred = d.status === 'transferred'

    if (filterStage === 'transferred') {
      return isTransferred && matchSearch
    }
    // Mọi filter khác: ẩn dog đã transferred
    if (isTransferred) return false
    const actualStage = d.isDeceased ? 'remembered' : calculateLifeStage(d.dateOfBirth, d.breed)
    const matchStage =
      filterStage === 'all' ? true
      : filterStage === 'puppies' ? (actualStage === 'whelp' || actualStage === 'puppy')
      : actualStage === filterStage
    return matchSearch && matchStage
  })

  // Puppies mode groups the flat `filtered` list into Born (whelp) / Puppy
  // sections. actualStage is computed once per dog here (not re-derived per
  // group) since calculateLifeStage is breed-aware and not free.
  const puppyGroups = useMemo(() => {
    if (filterStage !== 'puppies') return null
    const sortByDobDesc = (a: Dog, b: Dog) => {
      if (!a.dateOfBirth && !b.dateOfBirth) return 0
      if (!a.dateOfBirth) return 1
      if (!b.dateOfBirth) return -1
      return b.dateOfBirth.localeCompare(a.dateOfBirth)
    }
    const withStage = filtered.map(dog => ({
      dog,
      actualStage: dog.isDeceased ? 'remembered' : calculateLifeStage(dog.dateOfBirth, dog.breed),
    }))
    const bornDogs = withStage.filter(w => w.actualStage === 'whelp').map(w => w.dog).sort(sortByDobDesc)
    const puppyDogs = withStage.filter(w => w.actualStage === 'puppy').map(w => w.dog).sort(sortByDobDesc)
    return { bornDogs, puppyDogs }
  }, [filtered, filterStage])

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
                borderColor: filterStage === stage ? 'var(--brand-600)' : 'var(--border)',
                background: filterStage === stage ? 'var(--brand-50)' : 'var(--white)',
                color: filterStage === stage ? 'var(--brand-600)' : 'var(--mid)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {stage === 'all' ? 'All' : `${LIFE_STAGE_EMOJI[stage]} ${LIFE_STAGE_LABELS[stage]}`}
            </button>
          ))}

          {/* Puppies (Born + Puppy grouped) filter */}
          <button
            key="puppies"
            onClick={() => setFilterStage('puppies')}
            style={{
              padding: '7px 14px',
              borderRadius: 20,
              border: '1.5px solid',
              borderColor: filterStage === 'puppies' ? 'var(--brand-600)' : 'var(--border)',
              background: filterStage === 'puppies' ? 'var(--brand-50)' : 'var(--white)',
              color: filterStage === 'puppies' ? 'var(--brand-600)' : 'var(--mid)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            🐾 Puppies
          </button>

          {/* Transferred filter */}
          {transferredDogs.length > 0 && (
            <button
              key="transferred"
              onClick={() => setFilterStage('transferred')}
              style={{
                padding: '7px 14px',
                borderRadius: 20,
                border: '1.5px solid',
                borderColor: filterStage === 'transferred' ? 'var(--brand-600)' : 'var(--border)',
                background: filterStage === 'transferred' ? 'var(--brand-50)' : 'var(--white)',
                color: filterStage === 'transferred' ? 'var(--brand-600)' : 'var(--mid)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              🔄 Transferred ({transferredDogs.length})
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>
      ) : filterStage === 'puppies' ? (
        !puppyGroups || (puppyGroups.bornDogs.length === 0 && puppyGroups.puppyDogs.length === 0) ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">🐾</div>
              <div className="empty-state-title">{search ? 'No dogs found' : 'No puppies right now'}</div>
              <div className="empty-state-desc">{search ? 'Try a different search term.' : 'Born and Puppy dogs will show up here.'}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {puppyGroups.bornDogs.length > 0 && (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--dark)' }}>🐣 Born ({puppyGroups.bornDogs.length})</div>
                  <div style={{ fontSize: 13, color: 'var(--light)' }}>Newborn</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                  {puppyGroups.bornDogs.map(dog => <DogCard key={dog.id} dog={dog} />)}
                </div>
              </div>
            )}
            {puppyGroups.puppyDogs.length > 0 && (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--dark)' }}>🐶 Puppy ({puppyGroups.puppyDogs.length})</div>
                  <div style={{ fontSize: 13, color: 'var(--light)' }}>Ready for sale</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                  {puppyGroups.puppyDogs.map(dog => <DogCard key={dog.id} dog={dog} />)}
                </div>
              </div>
            )}
          </div>
        )
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
  const isTransferred = dog.status === 'transferred'
  const actualStage = dog.isDeceased ? 'remembered' : calculateLifeStage(dog.dateOfBirth, dog.breed)
  return (
    <Link to={`/app/dogs/${dog.id}`} style={{ textDecoration: 'none' }}>
      <div className="card" style={{
        padding: 0, overflow: 'hidden', cursor: 'pointer',
        transition: 'border-color 0.15s, transform 0.15s',
        opacity: 1,
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand-600)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none' }}
      >
        {/* Photo banner */}
        {dog.profilePhoto ? (
          <div style={{ position: 'relative', height: 160, overflow: 'hidden' }}>
            <img
              src={dog.profilePhoto}
              alt={dog.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
            />
            {isTransferred && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mid)', background: 'rgba(255,255,255,0.9)', padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)' }}>Transferred</span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ height: 160, background: 'linear-gradient(135deg, var(--brand-50), var(--sand))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44 }}>
            {LIFE_STAGE_EMOJI[actualStage]}
          </div>
        )}

        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dog.name}</div>
              <div style={{ fontSize: 13, color: 'var(--light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dog.breed}</div>
            </div>
            <span style={{ fontSize: 13, color: 'var(--mid)' }}>{dog.sex === 'female' ? '♀' : '♂'}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, color: 'var(--light)' }}>{getDogAge(dog.dateOfBirth)}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {isTransferred ? (
                <span className="badge badge-gray" style={{ fontSize: 10 }}>→ {(dog as any).buyerName}</span>
              ) : (
                <span className="badge badge-green" style={{ fontSize: 10 }}>QR ✓</span>
              )}
              {/* Pedigree Register badge */}
              {(dog as any).pedigreeRegister === 'limited' && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: '#FFF3E0', color: '#E65100', border: '1px solid #FFCC80' }}>🟠 Limited</span>
              )}
              {(dog as any).pedigreeRegister === 'mixed' && (
                <span className="badge badge-gray" style={{ fontSize: 10 }}>Mixed</span>
              )}
              {(dog as any).pedigreeRegister === 'rescue' && (
                <span className="badge badge-gray" style={{ fontSize: 10 }}>Rescue</span>
              )}
              {(dog as any).pedigreeRegister === 'no_pedigree' && (
                <span className="badge badge-gray" style={{ fontSize: 10 }}>No papers</span>
              )}
              {/* Feature D: Breeder ID badge */}
              {(dog as any).breederIdType && (dog as any).breederIdType !== 'NONE' && (dog as any).breederIdValue && (
                <span className="badge badge-gold" style={{ fontSize: 10 }}>🏷️ {(dog as any).breederIdValue}</span>
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
