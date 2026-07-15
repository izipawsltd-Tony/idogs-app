import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { formatDate, getDogAge, getVaccineStatus, LIFE_STAGE_EMOJI } from '../lib/utils'
import type { Dog, VaccineRecord, HealthTest } from '../types'

// ADR-002 §9 Decision 4 — exact public provenance values. Never a real
// person/organisation name; label stays "Source" (ADR-001 §Decision 6's
// neutral label for the QR Passport specifically). Legacy/unrecognised
// sourceType falls back to the same BREEDER_ISSUED default the API
// itself already applies server-side.
const PROVENANCE_VALUES: Record<string, string> = {
  BREEDER_ISSUED: 'Breeder-issued Dog ID',
  OWNER_CREATED: 'Owner-created Dog ID',
  IMPORTED: 'Imported record',
}

export default function PassportPublicPage() {
  const { passportId } = useParams<{ passportId: string }>()
  const [dog, setDog] = useState<Dog | null>(null)
  const [vaccines, setVaccines] = useState<VaccineRecord[]>([])
  const [healthTests, setHealthTests] = useState<HealthTest[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [activeTab, setActiveTab] = useState<'vaccines' | 'health' | 'info'>('vaccines')

  useEffect(() => {
    if (!passportId) return
    async function load() {
      try {
        const response = await fetch(`/api/passport?passportId=${encodeURIComponent(passportId!)}`)
        if (response.status === 404) { setNotFound(true); return }
        if (!response.ok) { setNotFound(true); return }

        const data = await response.json()
        setDog(data.dog as Dog)
        setVaccines(data.vaccines as VaccineRecord[])
        setHealthTests(data.healthTests as HealthTest[])
      } catch {
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [passportId])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#F5F0E8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🐾</div>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    </div>
  )

  if (notFound || !dog) return (
    <div style={{ minHeight: '100vh', background: '#F5F0E8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🐾</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: '#1A1917', marginBottom: 8 }}>Passport not found</div>
        <div style={{ fontSize: 14, color: '#9A9891', marginBottom: 20 }}>This QR code may be invalid or the dog has been removed.</div>
        <Link to="/" style={{ background: '#085041', color: '#fff', padding: '10px 20px', borderRadius: 10, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>Go to iDogs →</Link>
      </div>
    </div>
  )

  const vaccStatus = getVaccineStatus(vaccines[0]?.nextDue)
  const isTransferred = (dog as any).status === 'transferred'
  const isRemembered = (dog as any).isDeceased === true
  const provenanceValue = PROVENANCE_VALUES[(dog as any).sourceType] || PROVENANCE_VALUES.BREEDER_ISSUED

  return (
    <div style={{ minHeight: '100vh', background: '#F5F0E8' }}>

      {/* Hero header */}
      <div style={{ background: 'linear-gradient(160deg, #085041 0%, #1D9E75 100%)', padding: '32px 20px 48px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>

          {/* iDogs branding */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
            <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
              <span style={{ fontSize: 18 }}>🐾</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>iDogs</span>
            </Link>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>{dog.passportId}</span>
          </div>

          {/* Dog identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: dog.profilePhoto ? `url(${dog.profilePhoto}) center/cover` : 'rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 36, flexShrink: 0,
              border: '3px solid rgba(255,255,255,0.3)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            }}>
              {!dog.profilePhoto && (isRemembered ? '♥️' : LIFE_STAGE_EMOJI[dog.lifeStage])}
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em', marginBottom: 4 }}>{dog.name}</div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', marginBottom: 6 }}>
                {dog.breed} · {dog.sex === 'female' ? '♀ Female' : '♂ Male'} · {getDogAge(dog.dateOfBirth)}
              </div>
              {/* Status badges */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: vaccStatus === 'current' ? 'rgba(255,255,255,0.2)' : 'rgba(250,199,117,0.3)',
                  color: vaccStatus === 'current' ? '#9FE1CB' : '#FAC775',
                  border: `1px solid ${vaccStatus === 'current' ? 'rgba(159,225,203,0.3)' : 'rgba(250,199,117,0.3)'}`,
                }}>
                  {vaccStatus === 'current' ? '✓ Vaccines current' : vaccStatus === 'overdue' ? '⚠ Vaccines overdue' : '? Vaccines unknown'}
                </span>
                {healthTests.length > 0 && (
                  <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.2)' }}>
                    🔬 {healthTests.length} health test{healthTests.length > 1 ? 's' : ''}
                  </span>
                )}
                {isTransferred && (
                  <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.15)' }}>
                    🔄 Transferred
                  </span>
                )}
                {isRemembered && (
                  <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.2)' }}>
                    ♥️ Remembered
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div style={{ maxWidth: 480, margin: '-20px auto 0', padding: '0 16px 40px', position: 'relative' }}>
        <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 8px 32px rgba(8,80,65,0.12)' }}>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #E2DFD8' }}>
            {([
              { id: 'vaccines', label: `💉 Vaccines (${vaccines.length})` },
              { id: 'health', label: `🔬 Health (${healthTests.length})` },
              { id: 'info', label: '📋 Info' },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, padding: '14px 8px', border: 'none', fontSize: 12, fontWeight: 500,
                  background: 'transparent', cursor: 'pointer',
                  borderBottom: activeTab === tab.id ? '2px solid #085041' : '2px solid transparent',
                  color: activeTab === tab.id ? '#085041' : '#9A9891',
                  marginBottom: -1, transition: 'all 0.15s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Vaccines tab */}
          {activeTab === 'vaccines' && (
            <div>
              {vaccines.length === 0 ? (
                <div style={{ padding: '32px 20px', textAlign: 'center', color: '#9A9891', fontSize: 14 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>💉</div>
                  No vaccination records added yet.
                </div>
              ) : (
                vaccines.map((v, i) => {
                  const overdue = v.nextDue && new Date(v.nextDue) < new Date()
                  return (
                    <div key={v.id} style={{ padding: '14px 20px', borderBottom: i < vaccines.length - 1 ? '1px solid #F5F0E8' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1917', marginBottom: 2 }}>
                          {v.name}
                          {v.uncertain && <span style={{ fontSize: 11, color: '#C8971F', marginLeft: 6 }}>⚠ uncertain</span>}
                        </div>
                        <div style={{ fontSize: 12, color: '#9A9891' }}>Given: {formatDate(v.dateGiven)}</div>
                        {v.nextDue && <div style={{ fontSize: 12, color: overdue ? '#C0392B' : '#9A9891' }}>Next due: {formatDate(v.nextDue)}</div>}
                        {v.vetClinic && <div style={{ fontSize: 11, color: '#9A9891', marginTop: 2 }}>📍 {v.vetClinic}</div>}
                      </div>
                      <span style={{
                        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0,
                        background: overdue ? '#FDEDED' : '#E1F5EE',
                        color: overdue ? '#C0392B' : '#085041',
                      }}>
                        {overdue ? 'Overdue' : 'Current'}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* Health tab */}
          {activeTab === 'health' && (
            <div>
              {healthTests.length === 0 ? (
                <div style={{ padding: '32px 20px', textAlign: 'center', color: '#9A9891', fontSize: 14 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>🔬</div>
                  No health test records.
                </div>
              ) : (
                healthTests.map((h, i) => (
                  <div key={h.id} style={{ padding: '14px 20px', borderBottom: i < healthTests.length - 1 ? '1px solid #F5F0E8' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1917', marginBottom: 2 }}>{h.testType?.toUpperCase()}</div>
                      <div style={{ fontSize: 12, color: '#9A9891' }}>Tested: {formatDate(h.dateTested)}</div>
                      {h.lab && <div style={{ fontSize: 11, color: '#9A9891', marginTop: 2 }}>🏥 {h.lab}</div>}
                      {h.certNumber && <div style={{ fontSize: 11, color: '#9A9891' }}>Cert: {h.certNumber}</div>}
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, flexShrink: 0, background: '#E1F5EE', color: '#085041' }}>
                      {h.result}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Info tab */}
          {activeTab === 'info' && (
            <div>
              {[
                { label: 'Breed', value: dog.breed },
                { label: 'Date of birth', value: formatDate(dog.dateOfBirth) },
                { label: 'Age', value: getDogAge(dog.dateOfBirth) },
                { label: 'Sex', value: dog.sex === 'female' ? '♀ Female' : '♂ Male' },
                { label: 'Colour', value: dog.colour || '—' },
                { label: 'Passport ID', value: dog.passportId, mono: true },
                { label: 'Source', value: provenanceValue },
              ].map((row, i, arr) => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', borderBottom: i < arr.length - 1 ? '1px solid #F5F0E8' : 'none', fontSize: 14 }}>
                  <span style={{ color: '#9A9891' }}>{row.label}</span>
                  <span style={{ color: '#1A1917', fontWeight: 500, fontFamily: row.mono ? 'monospace' : undefined, fontSize: row.mono ? 12 : 14 }}>{row.value}</span>
                </div>
              ))}
              {isTransferred && (
                <div style={{ margin: 16, padding: '10px 14px', background: '#F5F0E8', borderRadius: 10, fontSize: 13, color: '#5C5A54' }}>
                  🔄 This dog has been transferred to a new owner.
                </div>
              )}
              {isRemembered && (
                <div style={{ margin: 16, padding: '10px 14px', background: '#F5F0E8', borderRadius: 10, fontSize: 13, color: '#5C5A54' }}>
                  ♥️ {dog.name}&apos;s story is remembered here, forever.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 24, padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: '#9A9891', marginBottom: 4 }}>
            Managed via <Link to="/" style={{ color: '#085041', textDecoration: 'none', fontWeight: 600 }}>iDogs</Link> · Every dog's story, forever
          </div>
          <div style={{ fontSize: 11, color: '#9A9891' }}>🔒 Your privacy and your dog's information are handled securely, in line with the Australian Privacy Act 1988</div>
        </div>
      </div>
    </div>
  )
}
