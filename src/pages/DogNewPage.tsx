import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { createDog, addVaccineRecord, addHealthTest, getDogs } from '../lib/db'
import { AU_TOP_BREEDS } from '../lib/utils'
import type { DogFormData, ToastMessage } from '../types'
import AIScan from '../components/ui/AIScan'
import { useAuth } from '../hooks/useAuth'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

type Step = 'scan' | 'form'

const FREE_DOG_LIMIT = 2
const FREE_PLANS = ['free', 'trial']

export default function DogNewPage({ toast }: Props) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [step, setStep] = useState<Step>('scan')
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState(false)
  const [activeDogCount, setActiveDogCount] = useState(0)
  const [scannedDocs, setScannedDocs] = useState<any[]>([])
  const [form, setForm] = useState<DogFormData>({
    name: '', breed: '', sex: 'female',
    dateOfBirth: '', colour: '', microchip: '', ankc: '', notes: '',
  })

  // Check free tier limit on mount
  useEffect(() => {
    async function checkLimit() {
      try {
        const dogs = await getDogs()
        const active = dogs.filter((d: any) => d.status !== 'transferred')
        setActiveDogCount(active.length)
        const isFreePlan = FREE_PLANS.includes(profile?.plan ?? 'free')
        if (isFreePlan && active.length >= FREE_DOG_LIMIT) {
          setBlocked(true)
        }
      } catch {
        // allow through if check fails
      } finally {
        setLoading(false)
      }
    }
    checkLimit()
  }, [profile])

  function set(field: keyof DogFormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function handleScanResult(result: any) {
    setScannedDocs(prev => [...prev, result])
    setForm(prev => ({
      ...prev,
      name: result.dogName || prev.name,
      breed: result.breed && AU_TOP_BREEDS.includes(result.breed) ? result.breed : prev.breed,
      dateOfBirth: result.dateOfBirth || prev.dateOfBirth,
      microchip: result.microchip || prev.microchip,
      ankc: result.ankc || prev.ankc,
      colour: result.colour ? result.colour.charAt(0).toUpperCase() + result.colour.slice(1).toLowerCase() : prev.colour,
      sex: result.sex ? result.sex.toLowerCase() as 'male' | 'female' : prev.sex,
    }))
    const vaccineCount = result.vaccines?.length || 0
    const hasHealth = result.healthTest?.result ? 1 : 0
    toast(`Scanned! ${vaccineCount} vaccine(s)${hasHealth ? ' + 1 health test' : ''} will be saved.`)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.name || !form.breed || !form.dateOfBirth) {
      toast('Please fill in name, breed and date of birth', 'error')
      return
    }
    setLoading(true)
    try {
      const dogId = await createDog(form)
      for (const doc of scannedDocs) {
        if (doc.vaccines) {
          for (const v of doc.vaccines) {
            if (v.name) {
              await addVaccineRecord({
                dogId,
                name: v.name,
                dateGiven: v.dateGiven || '',
                nextDue: v.nextDue || '',
                vetClinic: v.vetClinic || '',
                uncertain: v.uncertain || false,
              }).catch(() => {})
            }
          }
        }
        if (doc.healthTest?.result && doc.healthTest?.testType) {
          await addHealthTest({
            dogId,
            testType: doc.healthTest.testType,
            result: doc.healthTest.result,
            dateTested: doc.healthTest.dateTested || '',
            lab: doc.healthTest.lab || '',
            certNumber: doc.healthTest.certNumber || '',
          }).catch(() => {})
        }
      }
      const totalVaccines = scannedDocs.reduce((sum, d) => sum + (d.vaccines?.length || 0), 0)
      toast(`${form.name} added with ${totalVaccines} vaccine record(s)!`)
      navigate(`/app/dogs/${dogId}`)
    } catch {
      toast('Failed to create dog profile', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div style={{ padding: 32, display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <div className="spinner" />
      </div>
    )
  }

  // Free tier blocked
  if (blocked) {
    return (
      <div style={{ padding: 32, maxWidth: 480 }}>
        <Link to="/app/dogs" style={{ fontSize: 13, color: 'var(--light)', textDecoration: 'none' }}>← My dogs</Link>
        <div className="card" style={{ marginTop: 24, textAlign: 'center', padding: '48px 32px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🐾</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--dark)', marginBottom: 8 }}>
            Free plan limit reached
          </h2>
          <p style={{ fontSize: 14, color: 'var(--mid)', marginBottom: 6, lineHeight: 1.6 }}>
            You have {activeDogCount} dog{activeDogCount !== 1 ? 's' : ''} on your free plan.
            The free plan supports up to {FREE_DOG_LIMIT} dogs.
          </p>
          <p style={{ fontSize: 14, color: 'var(--mid)', marginBottom: 28, lineHeight: 1.6 }}>
            Upgrade to add more dogs, unlock AI scanning, documents, and ownership transfer.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/app/billing" className="btn btn-primary">
              Upgrade — from $5/mo
            </Link>
            <Link to="/app/dogs" className="btn btn-secondary">
              Back to my dogs
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 32, maxWidth: 640 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/app/dogs" style={{ fontSize: 13, color: 'var(--light)', textDecoration: 'none' }}>← My dogs</Link>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginTop: 8, marginBottom: 4 }}>Add a dog</h1>
        <p style={{ fontSize: 14, color: 'var(--light)' }}>Scan documents first to auto-fill the form, or fill in manually.</p>
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 28, background: 'var(--sand)', borderRadius: 'var(--radius-lg)', padding: 4 }}>
        <button
          onClick={() => setStep('scan')}
          style={{
            flex: 1, padding: '10px', border: 'none', borderRadius: 'var(--radius-md)',
            background: step === 'scan' ? 'var(--white)' : 'transparent',
            color: step === 'scan' ? 'var(--dark)' : 'var(--light)',
            fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', boxShadow: step === 'scan' ? 'var(--shadow-sm)' : 'none',
            transition: 'all .15s',
          }}
        >
          📸 Scan documents
          {scannedDocs.length > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--green)', color: 'white' }}>
              {scannedDocs.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setStep('form')}
          style={{
            flex: 1, padding: '10px', border: 'none', borderRadius: 'var(--radius-md)',
            background: step === 'form' ? 'var(--white)' : 'transparent',
            color: step === 'form' ? 'var(--dark)' : 'var(--light)',
            fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', boxShadow: step === 'form' ? 'var(--shadow-sm)' : 'none',
            transition: 'all .15s',
          }}
        >
          ✏️ Fill in details
        </button>
      </div>

      {/* STEP 1: SCAN */}
      {step === 'scan' && (
        <div>
          <AIScan onResult={handleScanResult} toast={toast} />
          {scannedDocs.length > 0 && (
            <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--green-light)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(8,80,65,.12)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)', marginBottom: 8 }}>
                ✓ {scannedDocs.length} document(s) scanned
              </div>
              {scannedDocs.map((doc, i) => (
                <div key={i} style={{ fontSize: 12, color: '#0F6E56', marginBottom: 4 }}>
                  • {doc.documentType === 'vaccine_card' ? `Vaccine card — ${doc.vaccines?.length || 0} vaccine(s)` :
                     doc.documentType === 'health_test' ? `Health test — ${doc.healthTest?.testType?.toUpperCase()} ${doc.healthTest?.result}` :
                     doc.documentType === 'pedigree' ? 'Pedigree certificate' : 'Document'}
                  {doc.dogName && ` (${doc.dogName})`}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
            <button onClick={() => setStep('form')} className="btn btn-primary" style={{ flex: 1 }}>
              {scannedDocs.length > 0 ? 'Continue to form →' : 'Skip scan, fill manually →'}
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: FORM */}
      {step === 'form' && (
        <div className="card">
          {scannedDocs.length > 0 && (
            <div style={{ padding: '10px 14px', background: 'var(--green-light)', borderRadius: 'var(--radius-md)', marginBottom: 20, fontSize: 13, color: 'var(--green)' }}>
              ✓ Fields auto-filled from scan. Review and edit if needed.
            </div>
          )}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Dog&apos;s name *</label>
                <input className="form-input" type="text" placeholder="Luna" value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Sex *</label>
                <select className="form-select" value={form.sex} onChange={e => set('sex', e.target.value)}>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Breed *</label>
              <select className="form-select" value={form.breed} onChange={e => set('breed', e.target.value)} required>
                <option value="">Select breed…</option>
                {AU_TOP_BREEDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Date of birth *</label>
                <input className="form-input" type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} required max={new Date().toISOString().split('T')[0]} />
              </div>
              <div className="form-group">
                <label className="form-label">Colour / markings</label>
                <input className="form-input" type="text" placeholder="Golden, cream chest" value={form.colour} onChange={e => set('colour', e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Microchip number</label>
                <input className="form-input" type="text" placeholder="956000012345678" value={form.microchip} onChange={e => set('microchip', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">ANKC registration</label>
                <input className="form-input" type="text" placeholder="3100012345" value={form.ankc} onChange={e => set('ankc', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" placeholder="Any notes about this dog…" value={form.notes} onChange={e => set('notes', e.target.value)} style={{ minHeight: 80 }} />
            </div>
            {scannedDocs.length > 0 && (
              <div style={{ padding: '12px 14px', background: 'var(--sand)', borderRadius: 'var(--radius-md)', fontSize: 13 }}>
                <div style={{ fontWeight: 500, color: 'var(--dark)', marginBottom: 6 }}>Will be saved automatically:</div>
                {scannedDocs.map((doc, i) => (
                  <div key={i} style={{ color: 'var(--mid)', fontSize: 12, marginBottom: 3 }}>
                    • {doc.vaccines?.length > 0 && `${doc.vaccines.length} vaccine record(s)`}
                    {doc.healthTest?.result && ` · ${doc.healthTest.testType?.toUpperCase()} health test`}
                    {doc.dogName && ` · Dog name: ${doc.dogName}`}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1, height: 46 }} disabled={loading}>
                {loading ? <span className="spinner" /> : `Add dog & create passport${scannedDocs.length > 0 ? ` (${scannedDocs.reduce((s, d) => s + (d.vaccines?.length || 0), 0)} records)` : ''}`}
              </button>
              <button type="button" onClick={() => setStep('scan')} className="btn btn-secondary" style={{ height: 46 }}>
                ← Scan more
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
