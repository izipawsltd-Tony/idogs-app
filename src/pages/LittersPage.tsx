import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getLitters, getDogs, createLitter, updateLitter, createDog, updateDog, deleteDog, transferDogOwnership } from '../lib/db'
import { deleteDoc, doc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { formatDate, isEligibleSireDog, isEligibleDamDog } from '../lib/utils'
import type { Litter, Dog, ToastMessage } from '../types'
import { useAuth } from '../hooks/useAuth'
import { sendTransferEmail } from '../lib/email'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

interface PuppyForm {
  name: string
  sex: 'male' | 'female'
  colour: string
  collarColour: string
  weightKg: string
  microchip: string
  notes: string
}

const COLLAR_COLOURS = ['Red','Blue','Green','Pink','Yellow','Purple','Orange','White','Black','Teal']
const COLLAR_EMOJI: Record<string, string> = {
  Red:'🔴', Blue:'🔵', Green:'🟢', Pink:'🩷', Yellow:'🟡',
  Purple:'🟣', Orange:'🟠', White:'⚪', Black:'⚫', Teal:'🩵'
}

const emptyPuppy: PuppyForm = { name: '', sex: 'female', colour: '', collarColour: '', weightKg: '', microchip: '', notes: '' }

export default function LittersPage({ toast }: Props) {
  const { user, profile, upgradeToBreeder } = useAuth()
  const [upgrading, setUpgrading] = useState(false)
  const [litters, setLitters] = useState<Litter[]>([])
  const [dogs, setDogs] = useState<Dog[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedLitter, setExpandedLitter] = useState<string | null>(null)

  // Edit litter state
  const [editingLitter, setEditingLitter] = useState<string | null>(null)
  const [editLitterForm, setEditLitterForm] = useState<Partial<Litter>>({})

  // Edit puppy state
  const [editingPuppy, setEditingPuppy] = useState<string | null>(null)
  const [editPuppyForm, setEditPuppyForm] = useState<PuppyForm>(emptyPuppy)

  // Transfer state
  const [transferPuppy, setTransferPuppy] = useState<Dog | null>(null)
  const [transferName, setTransferName] = useState('')
  const [transferEmail, setTransferEmail] = useState('')
  const [transferPhone, setTransferPhone] = useState('')
  const [transferConfirm, setTransferConfirm] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [transferError, setTransferError] = useState('')

  // Create litter form
  const [form, setForm] = useState({
    name: '', damId: '', sireId: '', sireName: '', sireAnkc: '',
    matingSuspectedDate: '', expectedDueDate: '', actualBirthDate: '', notes: '',
  })

  // Add puppy form
  const [showAddPuppy, setShowAddPuppy] = useState<string | null>(null)
  const [puppyForm, setPuppyForm] = useState<PuppyForm>(emptyPuppy)
  const [savingPuppy, setSavingPuppy] = useState(false)
  const [savingLitter, setSavingLitter] = useState(false)

  useEffect(() => {
    if (!user) return
    async function load(retries = 3) {
      try {
        const [l, d] = await Promise.all([getLitters(), getDogs()])
        setLitters(l)
        setDogs(d.filter(dog => !dog.isDeceased))
      } catch {
        if (retries > 0) setTimeout(() => load(retries - 1), 800)
        else toast('Failed to load — please refresh', 'error')
      } finally {
        setLoading(false)
      }
    }
    setTimeout(() => load(), 300)
  }, [user])

  function handleDamChange(damId: string) {
    const dam = dogs.find(d => d.id === damId)
    const year = form.actualBirthDate ? form.actualBirthDate.slice(0, 4) : new Date().getFullYear()
    setForm(prev => ({ ...prev, damId, name: dam ? `${dam.name} Litter ${year}` : prev.name }))
  }

  async function handleCreateLitter() {
    if (!form.damId) { toast('Please select a dam', 'error'); return }
    const dam = dogs.find(d => d.id === form.damId)
    if (!dam) { toast('Dam not found — please refresh', 'error'); return }
    setSavingLitter(true)
    try {
      await createLitter({
        name: form.name || `${dam.name} Litter`,
        damId: form.damId,
        sireId: form.sireId && form.sireId !== '__external__' ? form.sireId : null,
        sireName: form.sireId === '__external__' ? (form.sireName.trim() || null) : null,
        matingSuspectedDate: form.matingSuspectedDate,
        expectedDueDate: form.expectedDueDate,
        actualBirthDate: form.actualBirthDate,
        notes: form.notes,
        puppyIds: [],
      })
      const updated = await getLitters()
      setLitters(updated)
      setShowCreate(false)
      setForm({ name: '', damId: '', sireId: '', sireName: '', sireAnkc: '', matingSuspectedDate: '', expectedDueDate: '', actualBirthDate: '', notes: '' })
      toast('Litter created!')
    } catch (err) {
      toast('Failed to create litter', 'error')
    } finally {
      setSavingLitter(false)
    }
  }

  async function handleSaveLitter(litterId: string) {
    try {
      await updateLitter(litterId, editLitterForm)
      const updated = await getLitters()
      setLitters(updated)
      setEditingLitter(null)
      toast('Litter updated!')
    } catch {
      toast('Failed to update litter', 'error')
    }
  }

  async function handleDeleteLitter(litterId: string, litterName: string) {
    if (!confirm(`Delete litter "${litterName}"? This will NOT delete the puppies.`)) return
    try {
      await deleteDoc(doc(db, 'litters', litterId))
      setLitters(prev => prev.filter(l => l.id !== litterId))
      toast('Litter deleted')
    } catch {
      toast('Failed to delete litter', 'error')
    }
  }

  async function handleAddPuppy(litterId: string, litter: Litter) {
    setSavingPuppy(true)
    try {
      const dam = dogs.find(d => d.id === litter.damId)
      const trimmed = puppyForm.name.trim()
      const sexWord = puppyForm.sex === 'male' ? 'Boy' : 'Girl'
      const puppyIndex = (litter.puppyIds?.length || 0) + 1
      const fallbackName = puppyForm.collarColour
        ? `${puppyForm.collarColour} ${sexWord}`
        : `${dam?.name ? dam.name + ' ' : ''}Pup ${puppyIndex}`
      const finalName = trimmed || fallbackName
      const dogId = await createDog({
        name: finalName,
        breed: dam?.breed || '',
        sex: puppyForm.sex,
        dateOfBirth: litter.actualBirthDate || '',
        colour: puppyForm.colour,
        microchip: puppyForm.microchip,
        ankc: '',
        notes: [
          `From litter: ${litter.name}`,
          puppyForm.collarColour ? `Collar: ${puppyForm.collarColour}` : '',
          puppyForm.weightKg ? `Birth weight: ${puppyForm.weightKg}kg` : '',
          puppyForm.notes || '',
        ].filter(Boolean).join(' · '),
      })
      await updateLitter(litterId, { puppyIds: [...(litter.puppyIds || []), dogId] })
      const [updatedLitters, updatedDogs] = await Promise.all([getLitters(), getDogs()])
      setLitters(updatedLitters)
      setDogs(updatedDogs.filter(d => !d.isDeceased))
      setPuppyForm(emptyPuppy)
      setShowAddPuppy(null)
      toast(`${finalName} added — QR Passport created!`)
    } catch {
      toast('Failed to add puppy', 'error')
    } finally {
      setSavingPuppy(false)
    }
  }

  function startEditPuppy(puppy: Dog) {
    // Parse notes to extract collar/weight
    const notes = puppy.notes || ''
    const collarMatch = notes.match(/Collar: (\w+)/)
    const weightMatch = notes.match(/Birth weight: ([\d.]+)kg/)
    // Get notes without auto-generated parts
    const cleanNotes = notes
      .replace(/From litter: [^·]+·?\s*/g, '')
      .replace(/Collar: \w+·?\s*/g, '')
      .replace(/Birth weight: [\d.]+kg·?\s*/g, '')
      .trim()

    setEditPuppyForm({
      name: puppy.name,
      sex: puppy.sex,
      colour: puppy.colour || '',
      collarColour: collarMatch?.[1] || '',
      weightKg: weightMatch?.[1] || '',
      microchip: puppy.microchip || '',
      notes: cleanNotes,
    })
    setEditingPuppy(puppy.id)
  }

  async function handleSavePuppy(puppy: Dog, litter: Litter) {
    try {
      await updateDog(puppy.id, {
        name: editPuppyForm.name,
        sex: editPuppyForm.sex,
        colour: editPuppyForm.colour,
        microchip: editPuppyForm.microchip,
        notes: [
          `From litter: ${litter.name}`,
          editPuppyForm.collarColour ? `Collar: ${editPuppyForm.collarColour}` : '',
          editPuppyForm.weightKg ? `Birth weight: ${editPuppyForm.weightKg}kg` : '',
          editPuppyForm.notes || '',
        ].filter(Boolean).join(' · '),
      })
      const updatedDogs = await getDogs()
      setDogs(updatedDogs.filter(d => !d.isDeceased))
      setEditingPuppy(null)
      toast('Puppy updated!')
    } catch {
      toast('Failed to update puppy', 'error')
    }
  }

  async function handleDeletePuppy(puppyId: string, litter: Litter) {
    if (!confirm('Remove this puppy from the litter?')) return
    try {
      await updateLitter(litter.id, { puppyIds: litter.puppyIds.filter(id => id !== puppyId) })
      const [updatedLitters, updatedDogs] = await Promise.all([getLitters(), getDogs()])
      setLitters(updatedLitters)
      setDogs(updatedDogs.filter(d => !d.isDeceased))
      toast('Puppy removed from litter')
    } catch {
      toast('Failed to remove puppy', 'error')
    }
  }

  async function handleTransferPuppy() {
    if (!transferPuppy || !transferName.trim() || !transferEmail.trim()) {
      setTransferError('Please fill in buyer name and email.')
      return
    }
    if (!transferConfirm) { setTransferError('Please confirm the transfer.'); return }
    setTransferring(true)
    setTransferError('')
    try {
      const passportUrl = `${window.location.origin}/p/${transferPuppy.passportId}`
      // The Firestore write below is the actual transfer — once it succeeds,
      // the puppy is transferred. Email is a best-effort follow-up; a
      // transient failure there must not surface as "transfer failed" when
      // the dog document was already updated.
      await transferDogOwnership(transferPuppy.id, {
        buyerName: transferName.trim(),
        buyerEmail: transferEmail.trim().toLowerCase(),
        buyerPhone: transferPhone.trim() || undefined,
        transferredAt: new Date().toISOString(),
      })
      await sendTransferEmail({
        buyerEmail: transferEmail.trim(),
        buyerName: transferName.trim(),
        dogName: transferPuppy.name,
        breed: transferPuppy.breed,
        breederName: user?.displayName || 'Your breeder',
        passportUrl,
      }).catch(err => console.error('Transfer email failed (transfer itself already succeeded):', err))
      const updatedDogs = await getDogs()
      setDogs(updatedDogs.filter(d => !d.isDeceased))
      toast(`${transferPuppy.name} transferred to ${transferName} ✓`, 'success')
      setTransferPuppy(null)
      setTransferName('')
      setTransferEmail('')
      setTransferPhone('')
      setTransferConfirm(false)
    } catch {
      setTransferError('Something went wrong. Please try again.')
    } finally {
      setTransferring(false)
    }
  }

  const femalesOnly = dogs.filter(isEligibleDamDog)
  const malesOnly = dogs.filter(isEligibleSireDog)

  if (loading) return <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>

  // Pet Owner — show past litters read-only, or nothing if no litters
  if (profile?.role === 'owner') {
    if (litters.length === 0) {
      return (
        <div style={{ padding: 32 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 8 }}>Past Litters</h1>
          <div className="empty-state">
            <div className="empty-state-icon">🐣</div>
            <div className="empty-state-title">No past litters</div>
            <div className="empty-state-desc">No litter records found.</div>
          </div>
        </div>
      )
    }

    // Read-only view of past litters
    return (
      <div style={{ padding: 32 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>Past Litters</h1>
          <p style={{ fontSize: 14, color: 'var(--light)' }}>{litters.length} litter{litters.length !== 1 ? 's' : ''} recorded — read only</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {litters.map(litter => {
            const puppies = dogs.filter(d => litter.puppyIds?.includes(d.id))
            return (
              <div key={litter.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 28 }}>🐣</span>
                    <div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{litter.name}</div>
                      {litter.actualBirthDate && <div style={{ fontSize: 13, color: 'var(--light)' }}>Born {litter.actualBirthDate}</div>}
                    </div>
                  </div>
                  <span className="badge badge-gray">{puppies.length} puppies</span>
                </div>
                {puppies.length > 0 && (
                  <div style={{ padding: '12px 20px' }}>
                    {puppies.map(puppy => (
                      <div key={puppy.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--sand)' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--brand-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🐶</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)' }}>{puppy.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--light)' }}>{puppy.sex === 'female' ? '♀' : '♂'} · {puppy.colour}</div>
                        </div>
                        {((puppy as any).status === 'transferred' || (puppy as any).transferStatus === 'pendingClaim') && (
                          <span className="badge badge-gray" style={{ fontSize: 11 }}>Transferred</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 2 }}>Litters</h1>
          <p style={{ fontSize: 14, color: 'var(--light)' }}>{litters.length} litter{litters.length !== 1 ? 's' : ''} recorded</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>+ New litter</button>
      </div>

      {/* ── CREATE LITTER FORM ── */}
      {showCreate && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--dark)', marginBottom: 20 }}>New litter</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Dam (mother) *</label>
                <select className="form-select" value={form.damId} onChange={e => handleDamChange(e.target.value)}>
                  <option value="">Select dam…</option>
                  {femalesOnly.map(d => <option key={d.id} value={d.id}>{d.name} — {d.breed}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Litter name</label>
                <input className="form-input" placeholder="Luna Litter 2026" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Sire (father)</label>
                <select
                  className="form-select"
                  value={form.sireId}
                  onChange={e => {
                    const value = e.target.value
                    if (value === '__external__') {
                      setForm(p => ({ ...p, sireId: '__external__' }))
                    } else if (value === '') {
                      setForm(p => ({ ...p, sireId: '', sireName: '' }))
                    } else {
                      setForm(p => ({ ...p, sireId: value, sireName: '' }))
                    }
                  }}
                >
                  <option value="">Select sire… (optional)</option>
                  {malesOnly.map(d => <option key={d.id} value={d.id}>{d.name} — {d.breed}</option>)}
                  <option value="__external__">External sire (not in my dogs)</option>
                </select>
              </div>
              {form.sireId === '__external__' && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Sire name</label>
                  <input
                    className="form-input"
                    placeholder="e.g. Ch. Someone's Rex"
                    value={form.sireName}
                    onChange={e => setForm(p => ({ ...p, sireName: e.target.value }))}
                  />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Sire Dogs Australia Reg</label>
                <input className="form-input" placeholder="2100123456" value={form.sireAnkc} onChange={e => setForm(p => ({ ...p, sireAnkc: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Mating date</label>
                <input className="form-input" type="date" value={form.matingSuspectedDate} onChange={e => setForm(p => ({ ...p, matingSuspectedDate: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Expected due date</label>
                <input className="form-input" type="date" value={form.expectedDueDate} onChange={e => setForm(p => ({ ...p, expectedDueDate: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Actual birth date</label>
                <input className="form-input" type="date" value={form.actualBirthDate} onChange={e => setForm(p => ({ ...p, actualBirthDate: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" placeholder="Notes about this litter…" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} style={{ minHeight: 70 }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" onClick={handleCreateLitter} disabled={savingLitter}>
                {savingLitter ? <span className="spinner" /> : 'Create litter'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── LITTERS LIST ── */}
      {litters.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🐣</div>
            <div className="empty-state-title">No litters yet</div>
            <div className="empty-state-desc">Create your first litter to track puppies from birth to new homes.</div>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => setShowCreate(true)}>Create first litter</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {litters.map(litter => {
            const dam = dogs.find(d => d.id === litter.damId)
            const puppyDogs = dogs.filter(d => litter.puppyIds?.includes(d.id))
            const isExpanded = expandedLitter === litter.id
            const isEditingThisLitter = editingLitter === litter.id

            return (
              <div key={litter.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>

                {/* Litter header */}
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div
                    style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
                    onClick={() => setExpandedLitter(isExpanded ? null : litter.id)}
                  >
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--brand-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🐣</div>
                    <div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{litter.name}</div>
                      <div style={{ fontSize: 13, color: 'var(--light)', marginTop: 2 }}>
                        Dam: {dam?.name || '—'} · {litter.actualBirthDate ? `Born ${formatDate(litter.actualBirthDate)}` : litter.expectedDueDate ? `Due ${formatDate(litter.expectedDueDate)}` : 'Date TBC'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-green">{litter.puppyIds?.length || 0} puppies</span>
                    <button
                      className="btn btn-sm"
                      style={{ background: '#FDEDED', color: 'var(--danger)', border: '1px solid #F3B0B0' }}
                      onClick={() => handleDeleteLitter(litter.id, litter.name)}
                    >🗑️</button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setEditingLitter(litter.id)
                        setEditLitterForm({
                          name: litter.name,
                          matingSuspectedDate: litter.matingSuspectedDate || '',
                          expectedDueDate: litter.expectedDueDate || '',
                          actualBirthDate: litter.actualBirthDate || '',
                          notes: litter.notes || '',
                        })
                        setExpandedLitter(litter.id)
                      }}
                    >✏️ Edit</button>
                    <span
                      style={{ color: 'var(--light)', fontSize: 18, cursor: 'pointer' }}
                      onClick={() => setExpandedLitter(isExpanded ? null : litter.id)}
                    >{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>

                    {/* ── EDIT LITTER FORM ── */}
                    {isEditingThisLitter ? (
                      <div style={{ padding: '16px 20px', background: 'var(--sand)' }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dark)', marginBottom: 14 }}>Edit litter</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div className="form-group">
                            <label className="form-label">Litter name</label>
                            <input className="form-input" value={editLitterForm.name || ''} onChange={e => setEditLitterForm(p => ({ ...p, name: e.target.value }))} />
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                            <div className="form-group">
                              <label className="form-label">Mating date</label>
                              <input className="form-input" type="date" value={editLitterForm.matingSuspectedDate || ''} onChange={e => setEditLitterForm(p => ({ ...p, matingSuspectedDate: e.target.value }))} />
                            </div>
                            <div className="form-group">
                              <label className="form-label">Expected due</label>
                              <input className="form-input" type="date" value={editLitterForm.expectedDueDate || ''} onChange={e => setEditLitterForm(p => ({ ...p, expectedDueDate: e.target.value }))} />
                            </div>
                            <div className="form-group">
                              <label className="form-label">Actual birth</label>
                              <input className="form-input" type="date" value={editLitterForm.actualBirthDate || ''} onChange={e => setEditLitterForm(p => ({ ...p, actualBirthDate: e.target.value }))} />
                            </div>
                          </div>
                          <div className="form-group">
                            <label className="form-label">Notes</label>
                            <textarea className="form-textarea" value={editLitterForm.notes || ''} onChange={e => setEditLitterForm(p => ({ ...p, notes: e.target.value }))} style={{ minHeight: 60 }} />
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => handleSaveLitter(litter.id)}>Save changes</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setEditingLitter(null)}>Cancel</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Litter details */
                      <div style={{ padding: '14px 20px', background: 'var(--sand)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                        {dam && (
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--light)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Dam</div>
                            <Link to={`/app/dogs/${dam.id}`} style={{ fontSize: 13, color: 'var(--brand-600)', fontWeight: 500, textDecoration: 'none' }}>{dam.name}</Link>
                            <div style={{ fontSize: 12, color: 'var(--light)' }}>{dam.breed}</div>
                          </div>
                        )}
                        {litter.matingSuspectedDate && (
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--light)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Mating</div>
                            <div style={{ fontSize: 13, color: 'var(--dark)' }}>{formatDate(litter.matingSuspectedDate)}</div>
                          </div>
                        )}
                        {litter.expectedDueDate && (
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--light)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Due date</div>
                            <div style={{ fontSize: 13, color: 'var(--dark)' }}>{formatDate(litter.expectedDueDate)}</div>
                          </div>
                        )}
                        {litter.actualBirthDate && (
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--light)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Born</div>
                            <div style={{ fontSize: 13, color: 'var(--dark)' }}>{formatDate(litter.actualBirthDate)}</div>
                          </div>
                        )}
                        {litter.notes && (
                          <div style={{ gridColumn: '1/-1' }}>
                            <div style={{ fontSize: 11, color: 'var(--light)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Notes</div>
                            <div style={{ fontSize: 13, color: 'var(--mid)' }}>{litter.notes}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── PUPPIES ── */}
                    <div style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dark)' }}>Puppies ({puppyDogs.length})</div>
                        <button className="btn btn-primary btn-sm" onClick={() => setShowAddPuppy(showAddPuppy === litter.id ? null : litter.id)}>
                          + Add puppy
                        </button>
                      </div>

                      {/* Add puppy form */}
                      {showAddPuppy === litter.id && (
                        <div style={{ background: 'var(--sand)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
                          <PuppyFormFields form={puppyForm} onChange={setPuppyForm} />
                          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => handleAddPuppy(litter.id, litter)} disabled={savingPuppy}>
                              {savingPuppy ? <span className="spinner" /> : 'Add & create passport'}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setShowAddPuppy(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* Puppy list */}
                      {puppyDogs.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--light)', fontSize: 13 }}>No puppies added yet</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {puppyDogs.map(puppy => {
                            const isEditingThisPuppy = editingPuppy === puppy.id
                            const collarMatch = puppy.notes?.match(/Collar: (\w+)/)
                            const weightMatch = puppy.notes?.match(/Birth weight: ([\d.]+)kg/)

                            return (
                              <div key={puppy.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--white)' }}>
                                {/* Puppy row */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
                                  <div style={{
                                    width: 36, height: 36, borderRadius: '50%',
                                    background: puppy.profilePhoto ? `url(${puppy.profilePhoto}) center/cover` : 'var(--brand-50)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0,
                                  }}>
                                    {!puppy.profilePhoto && (collarMatch ? COLLAR_EMOJI[collarMatch[1]] || '🐶' : '🐶')}
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)' }}>{puppy.name}</div>
                                    <div style={{ fontSize: 12, color: 'var(--light)' }}>
                                      {puppy.sex === 'female' ? '♀' : '♂'}
                                      {puppy.colour ? ` · ${puppy.colour}` : ''}
                                      {collarMatch ? ` · ${COLLAR_EMOJI[collarMatch[1]] || ''} ${collarMatch[1]} collar` : ''}
                                      {weightMatch ? ` · ${weightMatch[1]}kg` : ''}
                                      {puppy.microchip ? ` · Chip: ${puppy.microchip}` : ''}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => isEditingThisPuppy ? setEditingPuppy(null) : startEditPuppy(puppy)}
                                    >
                                      {isEditingThisPuppy ? 'Cancel' : '✏️ Edit'}
                                    </button>
                                    <Link to={`/app/dogs/${puppy.id}`} className="btn btn-secondary btn-sm">View →</Link>
                                    {((puppy as any).status !== 'transferred' && (puppy as any).transferStatus !== 'pendingClaim') ? (
                                      <button
                                        className="btn btn-sm"
                                        style={{ background: 'var(--brand-50)', color: 'var(--brand-600)', border: '1px solid var(--brand-300)' }}
                                        onClick={() => {
                                          setTransferPuppy(puppy)
                                          setTransferName(puppy.reservedForName || '')
                                          setTransferEmail(puppy.reservedForEmail || '')
                                          setTransferPhone(puppy.reservedForPhone || '')
                                          setTransferError('')
                                        }}
                                      >🔄 Transfer</button>
                                    ) : (
                                      <span className="badge badge-gray" style={{ fontSize: 11 }}>Transferred</span>
                                    )}
                                    <button
                                      className="btn btn-sm"
                                      style={{ background: '#FDEDED', color: 'var(--danger)', border: '1px solid #F3B0B0' }}
                                      onClick={() => handleDeletePuppy(puppy.id, litter)}
                                    >✕</button>
                                  </div>
                                </div>

                                {/* Edit puppy form */}
                                {isEditingThisPuppy && (
                                  <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', background: 'var(--sand)' }}>
                                    <PuppyFormFields form={editPuppyForm} onChange={setEditPuppyForm} />
                                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                      <button className="btn btn-primary btn-sm" onClick={() => handleSavePuppy(puppy, litter)}>Save changes</button>
                                      <button className="btn btn-secondary btn-sm" onClick={() => setEditingPuppy(null)}>Cancel</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {/* Transfer Modal */}
      {transferPuppy && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(26,25,23,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
          onClick={() => setTransferPuppy(null)}
        >
          <div
            style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 460, boxShadow: '0 24px 64px rgba(0,0,0,0.18)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600, color: 'var(--dark)' }}>Transfer Ownership</div>
              <button onClick={() => setTransferPuppy(null)} style={{ background: 'none', border: 'none', fontSize: '1rem', color: 'var(--mid)', cursor: 'pointer', padding: '4px 8px' }}>✕</button>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--brand-50)', borderRadius: 10, padding: '0.875rem 1rem' }}>
                <span style={{ fontSize: '1.5rem' }}>🐾</span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--dark)' }}>{transferPuppy.name}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--mid)' }}>{transferPuppy.breed}</div>
                </div>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--warning)', background: '#FBF3E4', border: '1px solid #EBD9A8', borderRadius: 8, padding: '0.75rem 1rem' }}>
                ⚠️ Once transferred, the new owner will have full control of this puppy's profile.
              </div>
              <div className="form-group">
                <label className="form-label">Buyer's Full Name</label>
                <input className="form-input" type="text" placeholder="e.g. Jane Smith" value={transferName} onChange={e => setTransferName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Buyer's Email Address</label>
                <input className="form-input" type="email" placeholder="e.g. jane@example.com" value={transferEmail} onChange={e => setTransferEmail(e.target.value)} />
                <p className="form-hint">They'll receive an email with the passport link and signup instructions.</p>
              </div>
              <div className="form-group">
                <label className="form-label">Buyer phone (optional)</label>
                <input className="form-input" type="tel" placeholder="e.g. 0412 345 678 (optional)" value={transferPhone} onChange={e => setTransferPhone(e.target.value)} />
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', fontSize: '0.875rem', color: 'var(--dark)', cursor: 'pointer', lineHeight: 1.4 }}>
                <input type="checkbox" checked={transferConfirm} onChange={e => setTransferConfirm(e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--brand-600)', width: 16, height: 16, flexShrink: 0 }} />
                <span>I confirm I want to transfer <strong>{transferPuppy.name}</strong> to this buyer. This cannot be undone.</span>
              </label>
              {transferError && <p className="form-error">{transferError}</p>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--gray-100)' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setTransferPuppy(null)} disabled={transferring}>Cancel</button>
              <button
                className="btn btn-sm"
                onClick={handleTransferPuppy}
                disabled={transferring || !transferConfirm}
                style={{ background: !transferConfirm || transferring ? 'var(--gray-100)' : 'var(--danger)', color: !transferConfirm || transferring ? 'var(--light)' : '#fff', border: 'none' }}
              >
                {transferring ? <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} /> Transferring…</> : 'Transfer Ownership'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── REUSABLE PUPPY FORM FIELDS ──────────────────────────────────

function PuppyFormFields({ form, onChange }: { form: PuppyForm; onChange: (f: PuppyForm) => void }) {
  const set = (field: keyof PuppyForm, value: string) => onChange({ ...form, [field]: value })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div className="form-group">
        <label className="form-label">Puppy name <span style={{ fontWeight: 400, color: 'var(--light)' }}>(optional — auto-named by collar if blank)</span></label>
        <input className="form-input" placeholder="Leave blank — e.g. Blue Boy auto-set" value={form.name} onChange={e => set('name', e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Sex</label>
        <select className="form-select" value={form.sex} onChange={e => set('sex', e.target.value)}>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Coat colour</label>
        <input className="form-input" placeholder="Yellow, Black, Chocolate" value={form.colour} onChange={e => set('colour', e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Collar colour</label>
        <select className="form-select" value={form.collarColour} onChange={e => set('collarColour', e.target.value)}>
          <option value="">No collar yet</option>
          {['Red','Blue','Green','Pink','Yellow','Purple','Orange','White','Black','Teal'].map(c => (
            <option key={c} value={c}>{COLLAR_EMOJI[c]} {c}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Birth weight (kg)</label>
        <input className="form-input" type="number" step="0.01" placeholder="0.45" value={form.weightKg} onChange={e => set('weightKg', e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Microchip <span style={{ fontWeight: 400, color: 'var(--light)' }}>(6+ weeks)</span></label>
        <input className="form-input" placeholder="Optional — add later" value={form.microchip} onChange={e => set('microchip', e.target.value)} />
      </div>
      <div className="form-group" style={{ gridColumn: '1/-1' }}>
        <label className="form-label">Notes</label>
        <input className="form-input" placeholder="Any distinguishing features…" value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
    </div>
  )
}
