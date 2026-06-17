import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { useAuth } from '../hooks/useAuth'
import {
  getDog, getVaccineRecords, getWormingRecords, getHealthTests,
  getReminders, getActivityNotes, addActivityNote,
  addVaccineRecord, deleteVaccineRecord, updateVaccineRecord, addHealthTest, completeReminder,
  addWormingRecord, deleteWormingRecord,
  getScanCount, deleteDog, updateDog, transferDogOwnership, getDogDocuments, logAudit, syncLifeStage,
  getAuditLogs, type AuditEntry
} from '../lib/db'
import {
  formatDate, getDogAge, LIFE_STAGE_EMOJI, LIFE_STAGE_LABELS,
  getVaccineStatus, isOverdue, getTodaysMilestone, type Milestone
} from '../lib/utils'
import type { Dog, VaccineRecord, WormingRecord, HealthTest, Reminder, ActivityNote, ToastMessage } from '../types'
import PhotoUpload from '../components/ui/PhotoUpload'
import AIScan from '../components/ui/AIScan'
import { sendTransferEmail } from '../lib/email'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

type Tab = 'overview' | 'vaccines' | 'worming' | 'health' | 'reminders' | 'passport' | 'timeline' | 'scan' | 'documents'

export default function DogDetailPage({ toast }: Props) {
  const { dogId } = useParams<{ dogId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('overview')
  const [dog, setDog] = useState<Dog | null>(null)
  const [vaccines, setVaccines] = useState<VaccineRecord[]>([])
  const [wormings, setWormings] = useState<WormingRecord[]>([])
  const [healthTests, setHealthTests] = useState<HealthTest[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [notes, setNotes] = useState<ActivityNote[]>([])
  const [lifeStageEvents, setLifeStageEvents] = useState<AuditEntry[]>([])
  const [qrUrl, setQrUrl] = useState('')
  const [scanCount, setScanCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [notePhoto, setNotePhoto] = useState<{ base64: string; mediaType: string; preview: string } | null>(null)
  const [uploadingNotePhoto, setUploadingNotePhoto] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [documents, setDocuments] = useState<any[]>([])

  useEffect(() => {
    if (!dogId) return
    async function load() {
      try {
        const d = await getDog(dogId!)
        if (!d) { navigate('/app/dogs'); return }
        setDog(d)
        // Re-sync lifeStage in case it's drifted out of date (dogs were
        // previously assigned a fixed lifeStage at creation time with
        // nothing updating it afterwards as they aged).
        syncLifeStage(d).then(updatedStage => {
          if (updatedStage !== d.lifeStage) {
            setDog(prev => prev ? { ...prev, lifeStage: updatedStage } : prev)
          }
        }).catch(() => {
          // non-critical — if this fails, the page still works, just
          // with a possibly-stale lifeStage badge until next visit
        })
        const [v, w, h, r, n, sc, docs, auditLogs] = await Promise.all([
          getVaccineRecords(dogId!).catch(() => [] as VaccineRecord[]),
          getWormingRecords(dogId!).catch(() => [] as WormingRecord[]),
          getHealthTests(dogId!).catch(() => [] as HealthTest[]),
          getReminders(dogId!).catch(() => [] as Reminder[]),
          getActivityNotes(dogId!).catch(() => [] as ActivityNote[]),
          getScanCount(dogId!).catch(() => 0),
          getDogDocuments(dogId!).catch(() => []),
          getAuditLogs(d.tenantId, dogId!).catch(() => [] as AuditEntry[]),
        ])
        setVaccines(v)
        setWormings(w)
        setHealthTests(h)
        setReminders(r)
        setNotes(n)
        setScanCount(sc)
        if (docs) setDocuments(docs)
        setLifeStageEvents(auditLogs.filter(e => e.action === 'life_stage_changed'))
        const publicUrl = `${window.location.origin}/p/${d.passportId}`
        const url = await QRCode.toDataURL(publicUrl, {
          width: 200, margin: 2, errorCorrectionLevel: 'H',
          color: { dark: '#085041', light: '#FFFFFF' }
        })
        setQrUrl(url)
      } catch (err) {
        console.error('Load error:', err)
        toast('Failed to load dog', 'error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [dogId])

  async function handleAddNote() {
    if (!newNote.trim() || !dogId) return
    setSavingNote(true)
    try {
      let photoUrl: string | undefined
      if (notePhoto && user?.uid) {
        setUploadingNotePhoto(true)
        try {
          const res = await fetch('/api/upload-note-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64: notePhoto.base64,
              mediaType: notePhoto.mediaType,
              dogId,
              userId: user.uid,
            }),
          })
          if (res.ok) {
            const data = await res.json()
            photoUrl = data.fileUrl
          } else {
            toast('Photo upload failed — note saved without photo', 'info')
          }
        } catch {
          toast('Photo upload failed — note saved without photo', 'info')
        } finally {
          setUploadingNotePhoto(false)
        }
      }
      await addActivityNote(dogId, newNote.trim(), photoUrl)
      const n = await getActivityNotes(dogId)
      setNotes(n)
      setNewNote('')
      setNotePhoto(null)
      toast('Note added')
    } catch {
      toast('Failed to add note', 'error')
    } finally {
      setSavingNote(false)
    }
  }

  async function handleDelete() {
    if (!dogId || !dog) return
    if (!confirm(`Delete ${dog.name}? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await deleteDog(dogId)
      await logAudit({
        tenantId: user?.uid || '',
        dogId,
        dogName: dog.name,
        action: 'dog_deleted',
        details: `Dog "${dog.name}" (${dog.breed}) permanently deleted`,
        performedBy: user?.uid || '',
        performedByEmail: user?.email || '',
      })
      toast(`${dog.name} deleted`)
      navigate('/app/dogs')
    } catch {
      toast('Failed to delete', 'error')
      setDeleting(false)
    }
  }

  async function handleScanResult(result: any, fileUrl?: string) {
    if (!dogId || !dog) return

    let vaccineCount = 0
    let healthSaved = false

    // Save vaccines with fileUrl from scanned document
    if (result.vaccines && result.vaccines.length > 0) {
      for (const v of result.vaccines) {
        if (v.name) {
          await addVaccineRecord({
            dogId,
            name: v.name,
            dateGiven: v.dateGiven || '',
            nextDue: v.nextDue || '',
            vetClinic: v.vetClinic || '',
            uncertain: v.uncertain || false,
            documentUrl: fileUrl || null,
          } as any).catch(() => {})
          vaccineCount++
          await logAudit({
            tenantId: user?.uid || '',
            dogId,
            dogName: dog.name,
            action: 'vaccine_added',
            details: `Vaccine "${v.name}" added via iDogs Scan (given: ${v.dateGiven || '—'})`,
            performedBy: user?.uid || '',
            performedByEmail: user?.email || '',
          })
        }
      }
      const updated = await getVaccineRecords(dogId)
      setVaccines(updated)
    }

    // Save health test
    if (result.healthTest?.testType && result.healthTest?.result) {
      await addHealthTest({
        dogId,
        testType: result.healthTest.testType,
        result: result.healthTest.result,
        dateTested: result.healthTest.dateTested || '',
        lab: result.healthTest.lab || '',
        certNumber: result.healthTest.certNumber || '',
      }).catch(() => {})
      const updatedHealth = await getHealthTests(dogId)
      setHealthTests(updatedHealth)
      healthSaved = true
      // Update health test record with documentUrl
      if (fileUrl) {
        const latestHealth = updatedHealth[updatedHealth.length - 1]
        if (latestHealth) {
          await updateDoc(doc(db, 'healthTests', latestHealth.id), { documentUrl: fileUrl }).catch(() => {})
          // refresh
          const refreshed = await getHealthTests(dogId)
          setHealthTests(refreshed)
        }
      }
      await logAudit({
        tenantId: user?.uid || '',
        dogId,
        dogName: dog.name,
        action: 'health_test_added',
        details: `Health test "${result.healthTest.testType?.toUpperCase()}" added via iDogs Scan — result: ${result.healthTest.result}`,
        performedBy: user?.uid || '',
        performedByEmail: user?.email || '',
      })
    }

    // Update dog fields from scan
    const updates: Partial<Dog> = {}
    if (result.microchip && !dog.microchip) updates.microchip = result.microchip
    if (result.ankc && !dog.ankc) updates.ankc = result.ankc
    if (result.breed && !dog.breed) updates.breed = result.breed
    if (result.colour && !dog.colour) updates.colour = result.colour
    if (result.sex && !dog.sex) updates.sex = result.sex
    if (result.dateOfBirth && !dog.dateOfBirth) updates.dateOfBirth = result.dateOfBirth
    // Save microchip cert URL if scanned
    if (fileUrl && result.microchip) (updates as any).microchipCertUrl = fileUrl
    if (Object.keys(updates).length > 0) {
      await updateDog(dogId, updates)
      setDog(prev => prev ? { ...prev, ...updates } : prev)
    }

    // Toast summary
    const parts = []
    if (vaccineCount > 0) parts.push(`${vaccineCount} vaccine(s)`)
    if (healthSaved) parts.push('health test')
    if (Object.keys(updates).length > 0) parts.push('dog info updated')
    toast(`Saved: ${parts.length > 0 ? parts.join(', ') : 'no new records found'}`)

    // Navigate to relevant tab
    if (healthSaved && vaccineCount === 0) setTab('health')
    else if (vaccineCount > 0) setTab('vaccines')
  }

  async function handleTransfer(buyerName: string, buyerEmail: string) {
    if (!dogId || !dog) return
    const passportUrl = `${window.location.origin}/p/${dog.passportId}`
    await transferDogOwnership(dogId, {
      buyerName,
      buyerEmail,
      transferredAt: new Date().toISOString(),
      microchipCertUrl: (dog as any).microchipCertUrl || null,
    })
    await sendTransferEmail({
      buyerEmail,
      buyerName,
      dogName: dog.name,
      breed: dog.breed,
      breederName: user?.displayName || 'Your breeder',
      passportUrl,
    })
    await logAudit({
      tenantId: user?.uid || '',
      dogId: dogId!,
      dogName: dog.name,
      action: 'dog_transferred',
      details: `Ownership transferred to ${buyerName} (${buyerEmail})`,
      performedBy: user?.uid || '',
      performedByEmail: user?.email || '',
    })
    setDog(prev => prev ? { ...prev, status: 'transferred', buyerName, buyerEmail } as any : prev)
    setShowTransfer(false)
    toast(`${dog.name} transferred to ${buyerName} ✓`, 'success')
  }

  if (loading) return <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
  if (!dog) return null

  const publicUrl = `${window.location.origin}/p/${dog.passportId}`
  const latestVaccine = vaccines[0]
  const vaccStatus = getVaccineStatus(latestVaccine?.nextDue)
  const overdueReminders = reminders.filter(r => r.status === 'overdue' || (r.status === 'pending' && isOverdue(r.dueDate)))
  const isTransferred = (dog as any).status === 'transferred' && (dog as any).buyerEmail
  const todaysMilestone = getTodaysMilestone(dog.dateOfBirth, dog.createdAt)

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'scan', label: '📸 iDogs Scan' },
    { id: 'vaccines', label: `Vaccines (${vaccines.length})` },
    { id: 'worming', label: `Worming (${wormings.length})` },
    { id: 'health', label: 'Health tests' },
    { id: 'reminders', label: `Reminders (${reminders.filter(r => r.status !== 'completed').length})` },
    { id: 'passport', label: 'QR Passport' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'documents', label: `📄 Documents (${documents.length})` },
  ]

  return (
    <div style={{ padding: 32 }}>
      <Link to="/app/dogs" style={{ fontSize: 13, color: 'var(--light)', textDecoration: 'none' }}>← My dogs</Link>

      {todaysMilestone && (
        <div style={{
          marginTop: 16, padding: '14px 20px', borderRadius: 12,
          background: 'var(--gold-light)', border: '1px solid rgba(200,151,31,0.2)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 22 }}>{todaysMilestone.kind === 'birthday' ? '🎉' : '🏠'}</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--gold)' }}>
            {dog.name}'s {todaysMilestone.label}
          </span>
        </div>
      )}

      {/* Dog header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginTop: 16, marginBottom: 28 }}>
        <PhotoUpload
          dogId={dog.id}
          currentPhoto={dog.profilePhoto}
          onUpload={url => setDog(prev => prev ? { ...prev, profilePhoto: url } : prev)}
          toast={toast}
        />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--dark)' }}>{dog.name}</h1>
            {isTransferred ? (
              <span className="badge badge-gray">Transferred</span>
            ) : (
              <span className="badge badge-green" style={{ fontSize: 11 }}>QR ✓</span>
            )}
            {overdueReminders.length > 0 && <span className="badge badge-red">{overdueReminders.length} overdue</span>}
          </div>
          <div style={{ fontSize: 14, color: 'var(--mid)', marginTop: 2 }}>
            {dog.breed} · {dog.sex === 'female' ? '♀ Female' : '♂ Male'} · {getDogAge(dog.dateOfBirth)}
            {dog.colour && ` · ${dog.colour}`}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <span className="badge badge-gray">{LIFE_STAGE_EMOJI[dog.lifeStage]} {LIFE_STAGE_LABELS[dog.lifeStage]}</span>
            {dog.microchip && <span className="badge badge-gray">Chip: {dog.microchip}</span>}
            {dog.ankc && <span className="badge badge-gray">Dogs Australia Reg: {dog.ankc}</span>}
            <span className={`badge ${vaccStatus === 'current' ? 'badge-green' : vaccStatus === 'overdue' ? 'badge-red' : 'badge-gold'}`}>
              Vaccines: {vaccStatus === 'current' ? 'Current' : vaccStatus === 'overdue' ? 'Overdue' : vaccStatus === 'due_soon' ? 'Due soon' : 'Unknown'}
            </span>
          </div>
          {isTransferred && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--mid)', background: 'var(--sand)', padding: '6px 10px', borderRadius: 8, display: 'inline-block' }}>
              Transferred to <strong>{(dog as any).buyerName}</strong> · {(dog as any).buyerEmail}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">View passport ↗</a>
          {!isTransferred && (
            <button
              onClick={() => setShowTransfer(true)}
              className="btn btn-sm"
              style={{ background: 'var(--gold-light)', color: 'var(--gold)', border: '1px solid #E8C46A' }}
            >
              🔄 Transfer
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="btn btn-sm"
            style={{ background: 'var(--redL, #FCEBEB)', color: 'var(--error)', border: '1px solid #F09595' }}
          >
            {deleting ? <span className="spinner" /> : '🗑 Delete'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 14px', border: 'none',
            borderBottom: tab === t.id ? '2px solid var(--green)' : '2px solid transparent',
            background: 'transparent',
            color: tab === t.id ? 'var(--green)' : 'var(--mid)',
            fontSize: 13, fontWeight: tab === t.id ? 500 : 400,
            cursor: 'pointer', marginBottom: -1, whiteSpace: 'nowrap',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab dog={dog} vaccines={vaccines} wormings={wormings} healthTests={healthTests} scanCount={scanCount} />}
      {tab === 'scan' && (
        <div style={{ maxWidth: 480 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)', marginBottom: 8 }}>iDogs Document Scan</h2>
          <p style={{ fontSize: 14, color: 'var(--mid)', marginBottom: 20 }}>Photograph a Pedigree Certificate, Health Certificate, Hip and Elbow Dysplasia Report, or Vaccination Record. AI reads it and adds the records automatically.</p>
          <AIScan onResult={handleScanResult} toast={toast} dogId={dog.id} tenantId={user?.uid} />
        </div>
      )}
      {tab === 'vaccines' && <VaccinesTab dogId={dog.id} dogName={dog.name} tenantId={user?.uid || ''} userEmail={user?.email || ''} vaccines={vaccines} setVaccines={setVaccines} toast={toast} documents={documents} onViewDoc={() => setTab('documents')} />}
      {tab === 'worming' && <WormingTab dogId={dog.id} dogName={dog.name} tenantId={user?.uid || ''} userEmail={user?.email || ''} wormings={wormings} setWormings={setWormings} toast={toast} />}
      {tab === 'health' && <HealthTab dogId={dog.id} dogName={dog.name} tenantId={user?.uid || ''} userEmail={user?.email || ''} healthTests={healthTests} setHealthTests={setHealthTests} toast={toast} />}
      {tab === 'reminders' && <RemindersTab reminders={reminders} setReminders={setReminders} toast={toast} />}
      {tab === 'passport' && <PassportTab dog={dog} qrUrl={qrUrl} publicUrl={publicUrl} scanCount={scanCount} toast={toast} />}
      {tab === 'documents' && <DocumentsTab documents={documents} dogName={dog.name} />}
      {tab === 'timeline' && <TimelineTab dog={dog} notes={notes} newNote={newNote} setNewNote={setNewNote} onAddNote={handleAddNote} saving={savingNote} vaccines={vaccines} wormings={wormings} healthTests={healthTests} lifeStageEvents={lifeStageEvents} notePhoto={notePhoto} setNotePhoto={setNotePhoto} uploadingNotePhoto={uploadingNotePhoto} />}

      {/* Transfer Ownership Modal */}
      {showTransfer && dog && (
        <TransferModal
          dogName={dog.name}
          dogBreed={dog.breed}
          onClose={() => setShowTransfer(false)}
          onTransfer={handleTransfer}
        />
      )}
    </div>
  )
}

// ── TRANSFER MODAL ────────────────────────────────────────────

function TransferModal({
  dogName,
  dogBreed,
  onClose,
  onTransfer,
}: {
  dogName: string
  dogBreed: string
  onClose: () => void
  onTransfer: (name: string, email: string) => Promise<void>
}) {
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!buyerName.trim() || !buyerEmail.trim()) { setError('Please fill in buyer name and email.'); return }
    if (!confirm) { setError('Please confirm the transfer.'); return }
    setLoading(true)
    setError('')
    try {
      await onTransfer(buyerName.trim(), buyerEmail.trim().toLowerCase())
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(26, 25, 23, 0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 20, width: '100%', maxWidth: 460,
          boxShadow: '0 24px 64px rgba(0,0,0,0.18)', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600, color: 'var(--dark)' }}>Transfer Ownership</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1rem', color: 'var(--mid)', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Dog info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--green-light)', borderRadius: 10, padding: '0.875rem 1rem' }}>
            <span style={{ fontSize: '1.5rem' }}>🐾</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--dark)' }}>{dogName}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--mid)' }}>{dogBreed}</div>
            </div>
          </div>

          {/* Warning */}
          <div style={{ fontSize: '0.85rem', color: '#b45309', background: '#fef9ee', border: '1px solid #f6d860', borderRadius: 8, padding: '0.75rem 1rem' }}>
            ⚠️ Once transferred, the new owner will have full control of this dog's profile. You will see it in read-only mode.
          </div>

          {/* Buyer name */}
          <div className="form-group">
            <label className="form-label">Buyer's Full Name</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Jane Smith"
              value={buyerName}
              onChange={e => setBuyerName(e.target.value)}
            />
          </div>

          {/* Buyer email */}
          <div className="form-group">
            <label className="form-label">Buyer's Email Address</label>
            <input
              className="form-input"
              type="email"
              placeholder="e.g. jane@example.com"
              value={buyerEmail}
              onChange={e => setBuyerEmail(e.target.value)}
            />
            <p className="form-hint">They'll receive an email with the passport link and signup instructions.</p>
          </div>

          {/* Confirm checkbox */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', fontSize: '0.875rem', color: 'var(--dark)', cursor: 'pointer', lineHeight: 1.4 }}>
            <input
              type="checkbox"
              checked={confirm}
              onChange={e => setConfirm(e.target.checked)}
              style={{ marginTop: 2, accentColor: 'var(--green)', width: 16, height: 16, flexShrink: 0 }}
            />
            <span>I confirm I want to transfer <strong>{dogName}</strong> to this buyer. This action cannot be undone.</span>
          </label>

          {error && <p className="form-error">{error}</p>}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '16px 24px', borderTop: '1px solid var(--border)', background: '#fafaf9' }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={loading}>Cancel</button>
          <button
            className="btn btn-sm"
            onClick={handleSubmit}
            disabled={loading || !confirm}
            style={{ background: !confirm || loading ? '#f5f5f4' : '#dc2626', color: !confirm || loading ? 'var(--light)' : '#fff', border: 'none' }}
          >
            {loading ? <><span className="spinner" style={{ borderTopColor: '#fff', width: 14, height: 14 }} /> Transferring…</> : 'Transfer Ownership'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── OVERVIEW TAB ──────────────────────────────────────────────

function OverviewTab({ dog, vaccines, wormings, healthTests, scanCount }: {
  dog: Dog; vaccines: VaccineRecord[]; wormings: WormingRecord[]; healthTests: HealthTest[]; scanCount: number
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      <InfoSection title="Details">
        <InfoRow label="Date of birth" value={formatDate(dog.dateOfBirth)} />
        <InfoRow label="Age" value={getDogAge(dog.dateOfBirth)} />
        <InfoRow label="Breed" value={dog.breed} />
        <InfoRow label="Sex" value={dog.sex === 'female' ? 'Female' : 'Male'} />
        <InfoRow label="Colour" value={dog.colour || '—'} />
        <InfoRow label="Microchip" value={dog.microchip || '—'} />
        {(dog as any).microchipCertUrl && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--light)' }}>Microchip cert</span>
            <a href={(dog as any).microchipCertUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)', fontWeight: 500, textDecoration: 'none' }}>📄 View cert</a>
          </div>
        )}
        <InfoRow label="Dogs Australia Registration" value={dog.ankc || '—'} />
        <InfoRow label="Passport ID" value={dog.passportId} mono />
      </InfoSection>
      <InfoSection title="Health summary">
        <InfoRow label="Vaccines recorded" value={String(vaccines.length)} />
        <InfoRow label="Latest vaccine" value={vaccines[0] ? `${vaccines[0].name} — ${formatDate(vaccines[0].dateGiven)}` : '—'} />
        <InfoRow label="Next vaccine due" value={vaccines[0]?.nextDue ? formatDate(vaccines[0].nextDue) : '—'} />
        <InfoRow label="Worming records" value={String(wormings.length)} />
        <InfoRow label="Health tests" value={String(healthTests.length)} />
        <InfoRow label="Passport scans" value={String(scanCount)} />
      </InfoSection>
      {dog.notes && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--mid)', marginBottom: 8 }}>Notes</div>
          <p style={{ fontSize: 14, color: 'var(--dark)', lineHeight: 1.6 }}>{dog.notes}</p>
        </div>
      )}
    </div>
  )
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 500, color: 'var(--mid)' }}>{title}</div>
      <div>{children}</div>
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
      <span style={{ color: 'var(--light)' }}>{label}</span>
      <span style={{ color: 'var(--dark)', fontFamily: mono ? 'monospace' : undefined, fontWeight: 500 }}>{value}</span>
    </div>
  )
}

// ── VACCINES TAB ──────────────────────────────────────────────

function VaccinesTab({ dogId, dogName, tenantId, userEmail, vaccines, setVaccines, toast, documents, onViewDoc }: {
  dogId: string; dogName: string; tenantId: string; userEmail: string;
  vaccines: VaccineRecord[];
  setVaccines: (v: VaccineRecord[]) => void;
  toast: (msg: string, type?: ToastMessage['type']) => void
  documents: any[]
  onViewDoc: () => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', dateGiven: '', nextDue: '', vetClinic: '' })
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', dateGiven: '', nextDue: '', vetClinic: '' })
  const [savingEdit, setSavingEdit] = useState(false)

  function startEdit(v: VaccineRecord) {
    setEditingId(v.id)
    setEditForm({
      name: v.name || '',
      dateGiven: v.dateGiven || '',
      nextDue: v.nextDue || '',
      vetClinic: v.vetClinic || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function handleSaveEdit() {
    if (!editingId || !editForm.name || !editForm.dateGiven) return
    setSavingEdit(true)
    try {
      await updateVaccineRecord(editingId, {
        name: editForm.name,
        dateGiven: editForm.dateGiven,
        nextDue: editForm.nextDue,
        vetClinic: editForm.vetClinic,
        uncertain: false,
      })
      await logAudit({
        tenantId: tenantId || '',
        dogId,
        dogName: dogName,
        action: 'vaccine_added',
        details: `Vaccine "${editForm.name}" edited (given: ${editForm.dateGiven || '—'}, due: ${editForm.nextDue || '—'})`,
        performedBy: tenantId || '',
        performedByEmail: userEmail || '',
      })
      const updated = await getVaccineRecords(dogId)
      setVaccines(updated)
      setEditingId(null)
      toast('Vaccine record updated')
    } catch {
      toast('Failed to update vaccine', 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleAdd() {
    if (!form.name || !form.dateGiven) return
    setSaving(true)
    try {
      await addVaccineRecord({ dogId, ...form, uncertain: false })
      await logAudit({
        tenantId: tenantId || '',
        dogId,
        dogName: dogName,
        action: 'vaccine_added',
        details: `Vaccine "${form.name}" added manually (given: ${form.dateGiven || '—'}, due: ${form.nextDue || '—'})`,
        performedBy: tenantId || '',
        performedByEmail: userEmail || '',
      })
      const updated = await getVaccineRecords(dogId)
      setVaccines(updated)
      setForm({ name: '', dateGiven: '', nextDue: '', vetClinic: '' })
      setShowForm(false)
      toast('Vaccine record added')
    } catch {
      toast('Failed to add vaccine', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this record?')) return
    const v = vaccines.find(x => x.id === id)
    await deleteVaccineRecord(id)
    await logAudit({
      tenantId: tenantId || '',
      dogId,
      dogName: dogName,
      action: 'vaccine_deleted',
      details: `Vaccine "${v?.name || id}" deleted`,
      performedBy: tenantId || '',
      performedByEmail: userEmail || '',
    })
    setVaccines(vaccines.filter(v => v.id !== id))
    toast('Deleted')
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>Vaccination records</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>+ Add vaccine</button>
      </div>
      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="form-group">
              <label className="form-label">Vaccine name *</label>
              <input className="form-input" placeholder="C8 Distemper combo" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Date given *</label>
              <input className="form-input" type="date" value={form.dateGiven} onChange={e => setForm(p => ({ ...p, dateGiven: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Next due date</label>
              <input className="form-input" type="date" value={form.nextDue} onChange={e => setForm(p => ({ ...p, nextDue: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Vet clinic</label>
              <input className="form-input" placeholder="Paws & Claws, Adelaide" value={form.vetClinic} onChange={e => setForm(p => ({ ...p, vetClinic: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>{saving ? <span className="spinner" /> : 'Save record'}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}
      {vaccines.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💉</div>
          <div className="empty-state-title">No vaccine records</div>
          <div className="empty-state-desc">Use iDogs Scan tab to photograph a vaccine card, or add manually.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {(() => {
            // Determine the most recent record per vaccine name (by dateGiven).
            // Only the latest record of each name is eligible to show as Overdue —
            // older records that have since been superseded by a newer dose are
            // shown as a plain history entry instead.
            const latestByName: Record<string, string> = {}
            for (const v of vaccines) {
              const key = v.name.trim().toLowerCase()
              const current = latestByName[key]
              if (!current) { latestByName[key] = v.id; continue }
              const currentRecord = vaccines.find(x => x.id === current)
              if (currentRecord && v.dateGiven > currentRecord.dateGiven) {
                latestByName[key] = v.id
              }
            }
            const isLatestOfItsName = (v: VaccineRecord) => latestByName[v.name.trim().toLowerCase()] === v.id

            return vaccines.map((v, i) => {
              if (editingId === v.id) {
                return (
                  <div key={v.id} className="card" style={{ margin: 12, padding: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div className="form-group">
                        <label className="form-label">Vaccine name *</label>
                        <input className="form-input" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Date given *</label>
                        <input className="form-input" type="date" value={editForm.dateGiven} onChange={e => setEditForm(p => ({ ...p, dateGiven: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Next due date</label>
                        <input className="form-input" type="date" value={editForm.nextDue} onChange={e => setEditForm(p => ({ ...p, nextDue: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Vet clinic</label>
                        <input className="form-input" value={editForm.vetClinic} onChange={e => setEditForm(p => ({ ...p, vetClinic: e.target.value }))} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary btn-sm" onClick={handleSaveEdit} disabled={savingEdit}>{savingEdit ? <span className="spinner" /> : 'Save changes'}</button>
                      <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                )
              }

              const showOverdueBadge = v.nextDue && isLatestOfItsName(v)

              return (
                <div key={v.id} style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
                  borderBottom: i < vaccines.length - 1 ? '1px solid var(--border)' : 'none',
                  background: v.uncertain ? '#FDF6E3' : 'transparent',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)' }}>
                      {v.name}
                      {v.uncertain && <span style={{ fontSize: 11, color: 'var(--gold)', marginLeft: 6, fontWeight: 600 }}>⚠ Date uncertain — please verify</span>}
                    </div>
                    <div style={{ fontSize: 12, color: v.uncertain ? 'var(--gold)' : 'var(--light)', fontWeight: v.uncertain ? 600 : 400 }}>
                      Given: {formatDate(v.dateGiven)}{v.nextDue ? ` · Due: ${formatDate(v.nextDue)}` : ''}{v.vetClinic ? ` · ${v.vetClinic}` : ''}
                    </div>
                  </div>
                  {showOverdueBadge ? (
                    <span className={`badge ${v.nextDue && isOverdue(v.nextDue) ? 'badge-red' : 'badge-green'}`}>{v.nextDue && isOverdue(v.nextDue) ? 'Overdue' : 'Current'}</span>
                  ) : v.nextDue ? (
                    <span className="badge badge-gray">Superseded</span>
                  ) : null}
                  {(v as any).documentUrl && (
                    <a
                      href={(v as any).documentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '4px 10px', fontSize: 12, textDecoration: 'none' }}
                    >
                      📄 View
                    </a>
                  )}
                  <button onClick={() => startEdit(v)} className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }}>✎ Edit</button>
                  <button onClick={() => handleDelete(v.id)} className="btn btn-ghost btn-sm" style={{ color: 'var(--error)', padding: '4px 8px' }}>✕</button>
                </div>
              )
            })
          })()}
        </div>
      )}
    </div>
  )
}

// ── WORMING TAB ───────────────────────────────────────────────

function WormingTab({ dogId, dogName, tenantId, userEmail, wormings, setWormings, toast }: {
  dogId: string;
  dogName: string;
  tenantId: string;
  userEmail: string;
  wormings: WormingRecord[];
  setWormings: (w: WormingRecord[]) => void;
  toast: (msg: string, type?: ToastMessage['type']) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ product: '', dateGiven: '', nextDue: '', weightKg: '' })
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!form.product || !form.dateGiven) {
      toast('Please fill in product and date given', 'error')
      return
    }
    setSaving(true)
    try {
      await addWormingRecord({
        dogId,
        product: form.product,
        dateGiven: form.dateGiven,
        nextDue: form.nextDue || undefined,
        weightKg: form.weightKg ? Number(form.weightKg) : undefined,
      })
      await logAudit({
        tenantId,
        dogId,
        dogName,
        action: 'worming_added',
        details: `Worming "${form.product}" added (given: ${form.dateGiven})`,
        performedBy: tenantId,
        performedByEmail: userEmail,
      })
      const updated = await getWormingRecords(dogId)
      setWormings(updated)
      setForm({ product: '', dateGiven: '', nextDue: '', weightKg: '' })
      setShowForm(false)
      toast('Worming record added ✓')
    } catch {
      toast('Failed to add worming record', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const w = wormings.find(x => x.id === id)
    await deleteWormingRecord(id)
    setWormings(wormings.filter(x => x.id !== id))
    await logAudit({
      tenantId,
      dogId,
      dogName,
      action: 'worming_deleted',
      details: `Worming "${w?.product || id}" deleted`,
      performedBy: tenantId,
      performedByEmail: userEmail,
    })
    toast('Worming record deleted')
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>Worming</h2>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add manually'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Product *</label>
              <input className="form-input" type="text" placeholder="e.g. Drontal, Milbemax" value={form.product} onChange={e => setForm(p => ({ ...p, product: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Date given *</label>
              <input className="form-input" type="date" value={form.dateGiven} onChange={e => setForm(p => ({ ...p, dateGiven: e.target.value }))} max={new Date().toISOString().split('T')[0]} />
            </div>
            <div className="form-group">
              <label className="form-label">Next due date</label>
              <input className="form-input" type="date" value={form.nextDue} onChange={e => setForm(p => ({ ...p, nextDue: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Weight (kg)</label>
              <input className="form-input" type="number" step="0.1" placeholder="e.g. 4.2" value={form.weightKg} onChange={e => setForm(p => ({ ...p, weightKg: e.target.value }))} />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save worming record'}
          </button>
        </div>
      )}

      {wormings.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💊</div>
          <div className="empty-state-title">No worming records</div>
          <div className="empty-state-desc">Add a worming treatment manually to start tracking.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {wormings.map((w, i) => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderBottom: i < wormings.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)' }}>{w.product}</div>
                <div style={{ fontSize: 12, color: 'var(--light)' }}>
                  Given: {formatDate(w.dateGiven)}{w.nextDue ? ` · Next due: ${formatDate(w.nextDue)}` : ''}{w.weightKg ? ` · ${w.weightKg}kg` : ''}
                </div>
              </div>
              {w.nextDue && <span className={`badge ${isOverdue(w.nextDue) ? 'badge-red' : 'badge-green'}`}>{isOverdue(w.nextDue) ? 'Overdue' : 'Current'}</span>}
              <button onClick={() => handleDelete(w.id)} className="btn btn-ghost btn-sm" style={{ color: 'var(--error)', padding: '4px 8px' }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── HEALTH TAB ────────────────────────────────────────────────

function HealthTab({ dogId, dogName, tenantId, userEmail, healthTests, setHealthTests, toast }: {
  dogId: string;
  dogName: string;
  tenantId: string;
  userEmail: string;
  healthTests: HealthTest[];
  setHealthTests: (h: HealthTest[]) => void;
  toast: (msg: string, type?: ToastMessage['type']) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ testType: 'hip', result: '', dateTested: '', lab: '', certNumber: '' })
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!form.testType || !form.result || !form.dateTested) {
      toast('Please fill in test type, result, and date', 'error')
      return
    }
    setSaving(true)
    try {
      await addHealthTest({
        dogId,
        testType: form.testType as HealthTest['testType'],
        result: form.result,
        dateTested: form.dateTested,
        lab: form.lab,
        certNumber: form.certNumber,
      })
      await logAudit({
        tenantId,
        dogId,
        dogName,
        action: 'health_test_added',
        details: `Health test "${form.testType.toUpperCase()}" added manually — result: ${form.result}`,
        performedBy: tenantId,
        performedByEmail: userEmail,
      })
      const updated = await getHealthTests(dogId)
      setHealthTests(updated)
      setForm({ testType: 'hip', result: '', dateTested: '', lab: '', certNumber: '' })
      setShowForm(false)
      toast('Health test added ✓')
    } catch {
      toast('Failed to add health test', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>Health testing</h2>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add manually'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="form-group">
              <label className="form-label">Test type *</label>
              <select className="form-select" value={form.testType} onChange={e => setForm(p => ({ ...p, testType: e.target.value }))}>
                <option value="hip">Hip</option>
                <option value="elbow">Elbow</option>
                <option value="eye">Eye</option>
                <option value="dna">DNA</option>
                <option value="cardiac">Cardiac</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Date tested *</label>
              <input className="form-input" type="date" value={form.dateTested} onChange={e => setForm(p => ({ ...p, dateTested: e.target.value }))} max={new Date().toISOString().split('T')[0]} />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Result *</label>
              <input className="form-input" type="text" placeholder="e.g. Excellent, Normal, Clear" value={form.result} onChange={e => setForm(p => ({ ...p, result: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Lab / clinic</label>
              <input className="form-input" type="text" placeholder="e.g. OFA, PennHIP" value={form.lab} onChange={e => setForm(p => ({ ...p, lab: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Certificate number</label>
              <input className="form-input" type="text" value={form.certNumber} onChange={e => setForm(p => ({ ...p, certNumber: e.target.value }))} />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save health test'}
          </button>
        </div>
      )}

      {healthTests.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔬</div>
          <div className="empty-state-title">No health tests recorded</div>
          <div className="empty-state-desc">Use iDogs Scan to photograph an OFA certificate or hip/elbow result, or add manually.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {healthTests.map((h, i) => (
            <div key={h.id} style={{ padding: '12px 16px', borderBottom: i < healthTests.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)' }}>{h.testType.toUpperCase()} — {h.result}</div>
                <div style={{ fontSize: 12, color: 'var(--light)' }}>Tested: {formatDate(h.dateTested)}{h.lab ? ` · ${h.lab}` : ''}</div>
                {h.certNumber && <div style={{ fontSize: 12, color: 'var(--light)' }}>Cert: {h.certNumber}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span className="badge badge-green">Verified</span>
                {(h as any).documentUrl && (
                  <a
                    href={(h as any).documentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '4px 10px', fontSize: 12, textDecoration: 'none' }}
                  >
                    📄 View
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── REMINDERS TAB ─────────────────────────────────────────────

function RemindersTab({ reminders, setReminders, toast }: {
  reminders: Reminder[];
  setReminders: (r: Reminder[]) => void;
  toast: (msg: string, type?: ToastMessage['type']) => void
}) {
  async function handleComplete(id: string) {
    await completeReminder(id)
    setReminders(reminders.map(r => r.id === id ? { ...r, status: 'completed' as const } : r))
    toast('Reminder completed ✓')
  }
  const active = reminders.filter(r => r.status !== 'completed')
  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)', marginBottom: 16 }}>Reminders</h2>
      {active.length === 0 ? (
        <div className="card"><div className="empty-state"><div className="empty-state-icon">✅</div><div className="empty-state-title">All clear</div></div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {active.map((r, i) => {
            const overdue = isOverdue(r.dueDate)
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < active.length - 1 ? '1px solid var(--border)' : 'none', background: overdue ? '#FFF8F8' : undefined }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: overdue ? 'var(--error)' : 'var(--warning)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)' }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: overdue ? 'var(--error)' : 'var(--light)' }}>{overdue ? 'Overdue · ' : 'Due · '}{formatDate(r.dueDate)}</div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => handleComplete(r.id)}>Done ✓</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── PASSPORT TAB ──────────────────────────────────────────────

function PassportTab({ dog, qrUrl, publicUrl, scanCount, toast }: {
  dog: Dog; qrUrl: string; publicUrl: string; scanCount: number;
  toast: (msg: string, type?: ToastMessage['type']) => void
}) {
  function copyUrl() { navigator.clipboard.writeText(publicUrl); toast('Passport link copied!') }
  function downloadQR() {
    const a = document.createElement('a')
    a.href = qrUrl; a.download = `${dog.name}_passport_qr.png`; a.click()
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>
      <div>
        <div style={{ background: 'linear-gradient(135deg, #085041, #1D9E75)', borderRadius: 16, padding: 20, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 10, fontWeight: 500 }}>🐾 iDogs Digital Passport</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{dog.name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 14 }}>{dog.breed} · {getDogAge(dog.dateOfBirth)}</div>
          {qrUrl && <div style={{ background: '#fff', borderRadius: 10, padding: 10, marginBottom: 10 }}><img src={qrUrl} alt="QR" style={{ width: '100%' }} /></div>}
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>Scan with any phone camera</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={downloadQR} style={{ width: '100%' }}>⬇ Download QR PNG</button>
          <button className="btn btn-secondary btn-sm" onClick={copyUrl} style={{ width: '100%' }}>Copy passport link</button>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ textAlign: 'center', width: '100%' }}>Preview passport ↗</a>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--mid)', marginBottom: 12 }}>Passport details</div>
          <InfoRow label="Passport ID" value={dog.passportId} mono />
          <InfoRow label="Public URL" value={publicUrl} />
          <InfoRow label="Total scans" value={String(scanCount)} />
          <InfoRow label="Status" value={dog.isDeceased ? 'Remembered' : 'Active'} />
        </div>
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--mid)', marginBottom: 8 }}>Privacy</div>
          <div style={{ fontSize: 13, color: 'var(--green)', background: 'var(--green-light)', padding: '8px 12px', borderRadius: 8 }}>
            ✓ Data stored in Australia · Australian Privacy Act 1988 compliant
          </div>
        </div>
      </div>
    </div>
  )
}

// ── DOCUMENTS TAB ────────────────────────────────────────────

function DocumentsTab({ documents, dogName }: { documents: any[]; dogName: string }) {
  function getDocIcon(type: string) {
    if (type === 'vaccine_card') return '💉'
    if (type === 'health_test') return '🔬'
    if (type === 'pedigree') return '📜'
    if (type === 'microchip_cert') return '🔖'
    if (type === 'vet_record') return '🏥'
    return '📄'
  }

  function getDocLabel(type: string) {
    if (type === 'vaccine_card') return 'Vaccine Card'
    if (type === 'health_test') return 'Health Test'
    if (type === 'pedigree') return 'Pedigree Certificate'
    if (type === 'microchip_cert') return 'Microchip Certificate'
    if (type === 'vet_record') return 'Vet Record'
    return 'Document'
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)', marginBottom: 16 }}>Documents</h2>
      {documents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <div className="empty-state-title">No documents yet</div>
          <div className="empty-state-desc">Scan a vaccine card, pedigree cert, or health test using the iDogs Scan tab.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {documents.map((doc, i) => (
            <div key={i} style={{
              background: 'var(--white)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: 'var(--green-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.4rem', flexShrink: 0,
              }}>
                {getDocIcon(doc.documentType)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--dark)', marginBottom: 2 }}>
                  {getDocLabel(doc.documentType)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--light)' }}>
                  {doc.fileType?.toUpperCase()} · {doc.uploadedAt?.toDate?.()?.toLocaleDateString('en-AU') || 'Recently uploaded'}
                </div>
                {doc.extractedData?.vaccines > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 2 }}>
                    💉 {doc.extractedData.vaccines} vaccine(s) extracted
                  </div>
                )}
                {doc.extractedData?.healthTest && (
                  <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 2 }}>
                    🔬 {doc.extractedData.healthTest} test extracted
                  </div>
                )}
              </div>
              <a
                href={doc.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm"
              >
                View ↗
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── TIMELINE TAB ──────────────────────────────────────────────

type StoryEvent = {
  date: string
  icon: string
  title: string
  detail?: string
  photoUrl?: string
  kind: 'birth' | 'vaccine' | 'worming' | 'health' | 'stage' | 'transfer' | 'note'
}

/**
 * Generates one event per past birthday and one per past join-anniversary,
 * from year 1 up to (but not including) the current year — used to
 * populate the story timeline with milestone history, separate from
 * getTodaysMilestone which only checks "is it today right now".
 */
function getPastMilestoneEvents(dateOfBirth: string, createdAt: string): StoryEvent[] {
  const events: StoryEvent[] = []
  const now = new Date()

  if (dateOfBirth) {
    const birth = new Date(dateOfBirth)
    for (let y = 1; y <= now.getFullYear() - birth.getFullYear(); y++) {
      const occurredOn = new Date(birth.getFullYear() + y, birth.getMonth(), birth.getDate())
      if (occurredOn > now) break
      events.push({ date: occurredOn.toISOString(), icon: '🎂', title: `${y === 1 ? '1st' : `${y}th`} birthday`, kind: 'stage' })
    }
  }

  if (createdAt) {
    const joined = new Date(createdAt)
    for (let y = 1; y <= now.getFullYear() - joined.getFullYear(); y++) {
      const occurredOn = new Date(joined.getFullYear() + y, joined.getMonth(), joined.getDate())
      if (occurredOn > now) break
      events.push({ date: occurredOn.toISOString(), icon: '🏠', title: `${y} year${y > 1 ? 's' : ''} on iDogs`, kind: 'stage' })
    }
  }

  return events
}

function buildStoryEvents(dog: Dog, vaccines: VaccineRecord[], wormings: WormingRecord[], healthTests: HealthTest[], lifeStageEvents: AuditEntry[], notes: ActivityNote[]): StoryEvent[] {
  const events: StoryEvent[] = []

  if (dog.dateOfBirth) {
    events.push({ date: dog.dateOfBirth, icon: '🐣', title: `${dog.name} was born`, kind: 'birth' })
  }

  vaccines.forEach(v => {
    if (v.dateGiven) {
      events.push({ date: v.dateGiven, icon: '💉', title: `Vaccinated — ${v.name}`, kind: 'vaccine' })
    }
  })

  wormings.forEach(w => {
    if (w.dateGiven) {
      events.push({ date: w.dateGiven, icon: '💊', title: `Worming — ${w.product}`, kind: 'worming' })
    }
  })

  healthTests.forEach(h => {
    if (h.dateTested) {
      events.push({ date: h.dateTested, icon: '🔬', title: `Health test — ${h.testType.toUpperCase()}`, detail: h.result, kind: 'health' })
    }
  })

  lifeStageEvents.forEach(e => {
    events.push({ date: e.createdAt, icon: '🌟', title: e.details, kind: 'stage' })
  })

  if ((dog as any).transferredAt) {
    events.push({ date: (dog as any).transferredAt, icon: '🏠', title: `Transferred to ${(dog as any).buyerName || 'new owner'}`, kind: 'transfer' })
  }

  notes.forEach(n => {
    events.push({ date: n.createdAt, icon: '📝', title: n.note, photoUrl: n.photoUrl, kind: 'note' })
  })

  events.push(...getPastMilestoneEvents(dog.dateOfBirth, dog.createdAt))

  return events.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

const STORY_EVENT_COLOR: Record<StoryEvent['kind'], string> = {
  birth: 'var(--gold)',
  vaccine: '#0F6E56',
  worming: '#1D9E75',
  health: '#085041',
  stage: 'var(--gold)',
  transfer: 'var(--mid)',
  note: 'var(--green)',
}

function TimelineTab({ dog, notes, newNote, setNewNote, onAddNote, saving, vaccines, wormings, healthTests, lifeStageEvents, notePhoto, setNotePhoto, uploadingNotePhoto }: {
  dog: Dog; notes: ActivityNote[]; newNote: string; setNewNote: (v: string) => void;
  onAddNote: () => void; saving: boolean;
  vaccines: VaccineRecord[]; wormings: WormingRecord[]; healthTests: HealthTest[]; lifeStageEvents: AuditEntry[];
  notePhoto: { base64: string; mediaType: string; preview: string } | null;
  setNotePhoto: (p: { base64: string; mediaType: string; preview: string } | null) => void;
  uploadingNotePhoto: boolean
}) {
  const events = buildStoryEvents(dog, vaccines, wormings, healthTests, lifeStageEvents, notes)

  function handlePhotoSelect(e: { target: { files: FileList | null } }) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setNotePhoto({ base64, mediaType: file.type, preview: result })
    }
    reader.readAsDataURL(file)
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>{dog.name}'s story</h2>
      <p style={{ fontSize: 13, color: 'var(--light)', marginBottom: 16 }}>Every milestone, automatically gathered in one place.</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <textarea className="form-textarea" placeholder="Add a note about today…" value={newNote} onChange={e => setNewNote(e.target.value)} style={{ minHeight: 72, marginBottom: 10 }} />

        {notePhoto ? (
          <div style={{ position: 'relative', display: 'inline-block', marginBottom: 10 }}>
            <img src={notePhoto.preview} alt="Selected" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
            <button
              type="button"
              onClick={() => setNotePhoto(null)}
              style={{
                position: 'absolute', top: -8, right: -8,
                width: 22, height: 22, borderRadius: '50%',
                background: 'var(--dark)', color: '#fff', border: 'none',
                fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >✕</button>
          </div>
        ) : (
          <label className="btn btn-secondary btn-sm" style={{ display: 'inline-flex', marginBottom: 10, cursor: 'pointer' }}>
            📷 Add a photo
            <input type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: 'none' }} />
          </label>
        )}

        <div>
          <button className="btn btn-primary btn-sm" onClick={onAddNote} disabled={saving || !newNote.trim()}>
            {saving ? <span className="spinner" /> : uploadingNotePhoto ? 'Uploading photo…' : 'Add note'}
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="empty-state"><div className="empty-state-icon">📝</div><div className="empty-state-title">No story yet</div><div className="empty-state-desc">Add a note, or scan a document, to begin {dog.name}'s story.</div></div>
      ) : (
        <div style={{ position: 'relative', paddingLeft: 28 }}>
          {/* Vertical timeline line */}
          <div style={{ position: 'absolute', left: 11, top: 6, bottom: 6, width: 2, background: 'var(--border)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {events.map((e, i) => (
              <div key={i} style={{ position: 'relative' }}>
                {/* Dot on the timeline */}
                <div style={{
                  position: 'absolute', left: -28, top: 2,
                  width: 22, height: 22, borderRadius: '50%',
                  background: STORY_EVENT_COLOR[e.kind], color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, border: '2px solid var(--white)',
                }}>
                  {e.icon}
                </div>
                <div className="card" style={{ padding: '12px 16px' }}>
                  {e.photoUrl && (
                    <img src={e.photoUrl} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }} />
                  )}
                  <div style={{ fontSize: 14, color: 'var(--dark)', lineHeight: 1.6, marginBottom: 4 }}>{e.title}</div>
                  {e.detail && <div style={{ fontSize: 13, color: 'var(--mid)', marginBottom: 4 }}>{e.detail}</div>}
                  <div style={{ fontSize: 12, color: 'var(--light)' }}>{formatDate(e.date)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
