import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { useAuth } from '../hooks/useAuth'
import {
  getDog, getVaccineRecords, getWormingRecords, getHealthTests,
  getReminders, getActivityNotes, addActivityNote,
  addVaccineRecord, deleteVaccineRecord, updateVaccineRecord, addHealthTest, updateHealthTest, deleteHealthTest, completeReminder,
  addWormingRecord, deleteWormingRecord,
  getScanCount, deleteDog, updateDog, transferDogOwnership, getDogDocuments, logAudit, syncLifeStage,
  getAuditLogs, type AuditEntry
} from '../lib/db'
import {
  formatDate, getDogAge, LIFE_STAGE_EMOJI, LIFE_STAGE_LABELS,
  getVaccineStatus, isOverdue, isDueSoon, getTodaysMilestone, ordinal, BREEDER_ID_CONFIG, type Milestone
} from '../lib/utils'
import type { Dog, VaccineRecord, WormingRecord, HealthTest, Reminder, ActivityNote, ToastMessage } from '../types'
import PhotoUpload from '../components/ui/PhotoUpload'
import AIScan from '../components/ui/AIScan'
import { sendTransferEmail } from '../lib/email'
import { doc, updateDoc, addDoc, collection, getDocs, query, where, orderBy, deleteDoc, deleteField } from 'firebase/firestore'
import { db } from '../lib/firebase'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

type Tab = 'overview' | 'vaccines' | 'worming' | 'health' | 'reminders' | 'passport' | 'timeline' | 'scan' | 'documents' | 'breeding'

async function viewDocument(
  user: { getIdToken: () => Promise<string> } | null | undefined,
  toast: (msg: string, type?: ToastMessage['type']) => void,
  path?: string | null,
  legacyUrl?: string | null,
) {
  if (!path) {
    if (legacyUrl) window.open(legacyUrl, '_blank', 'noopener,noreferrer')
    return
  }
  if (!user) {
    toast('Please sign in to view this document', 'error')
    return
  }

  // To bypass browser popup blockers, open the new tab synchronously 
  // before the async fetch, then update its URL once the signed URL is returned.
  const newWin = window.open('about:blank', '_blank')
  if (newWin) {
    newWin.document.write('<div style="font-family:sans-serif;padding:40px;text-align:center;color:#666;">Opening secure document...</div>')
  }

  try {
    const idToken = await user.getIdToken()
    const response = await fetch('/api/get-signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ filePath: path }),
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      if (import.meta.env.DEV) {
        console.error('get-signed-url failed:', response.status, err.error || 'Unknown error')
      }
      toast('Could not open document. Please contact breeder or try again.', 'error')
      if (newWin) newWin.close()
      return
    }
    const { url } = await response.json()
    if (newWin) {
      newWin.location.href = url
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  } catch {
    if (newWin) newWin.close()
    toast('Could not open document', 'error')
  }
}

// Maps AI Scan's free-text testType guess to the exact HealthTest.testType
// enum. Only these 6 values are ever written to Firestore — anything that
// doesn't map returns null so the caller can skip it (and tell the user)
// instead of silently saving a bad value.
function normaliseTestType(raw: unknown): HealthTest['testType'] | null {
  if (typeof raw !== 'string') return null
  const t = raw.toLowerCase().trim()
  if (!t) return null

  const DIRECT = ['hip', 'elbow', 'eye', 'dna', 'cardiac', 'other'] as const
  if ((DIRECT as readonly string[]).includes(t)) return t as HealthTest['testType']

  const HIP = ['hips', 'hip score', 'hip scoring']
  const ELBOW = ['elbows', 'elbow score', 'elbow scoring']
  const EYE = ['eyes', 'eye test', 'ophthalmology', 'ophthalmologist']
  const DNA = ['genetic', 'genetics', 'genetic test']
  const CARDIAC = ['heart', 'echo', 'echocardiogram', 'cardiac test']
  const PATELLA = ['patella', 'luxating patella', 'knees', 'knee test']

  if (HIP.includes(t)) return 'hip'
  if (ELBOW.includes(t)) return 'elbow'
  if (EYE.includes(t)) return 'eye'
  if (DNA.includes(t)) return 'dna'
  if (CARDIAC.includes(t)) return 'cardiac'
  if (PATELLA.includes(t)) return 'other'
  return null
}

export default function DogDetailPage({ toast }: Props) {
  const { dogId } = useParams<{ dogId: string }>()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const userState: string = (profile as any)?.state || 'SA'
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
  const [newNoteDate, setNewNoteDate] = useState(() => new Date().toISOString().split('T')[0])
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
          color: { dark: '#1A3A2A', light: '#FFFFFF' }
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
          const idToken = await user.getIdToken()
          const res = await fetch('/api/upload?type=note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({
              base64: notePhoto.base64,
              mediaType: notePhoto.mediaType,
              dogId,
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
      await addActivityNote(dogId, newNote.trim(), photoUrl, newNoteDate)
      const n = await getActivityNotes(dogId)
      setNotes(n)
      setNewNote('')
      setNewNoteDate(new Date().toISOString().split('T')[0])
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

  async function handleScanResult(result: any, filePath?: string) {
    if (!dogId || !dog) return

    let vaccineCount = 0
    let healthCount = 0
    const skippedTests: string[] = []

    // Save vaccines with filePath from scanned document
    if (result.vaccines && result.vaccines.length > 0) {
      for (const v of result.vaccines) {
        if (v.name) {
          // FIX: vaccines had no duplicate-rescan guard at all (unlike
          // health tests, which already check before saving) — re-scanning
          // the same vaccine card silently created an exact duplicate
          // record with no warning. Same logic as the health test guard:
          // same name + same dateGiven is the strongest signal this is
          // literally the same vaccination event being re-entered.
          const possibleDuplicateVaccine = vaccines.find(existing =>
            existing.name.trim().toLowerCase() === v.name.trim().toLowerCase() &&
            existing.dateGiven === (v.dateGiven || '')
          )
          if (possibleDuplicateVaccine) {
            const confirmed = window.confirm(
              `This looks like a duplicate of an existing "${v.name}" vaccine given on ${v.dateGiven || 'the same date'}.\n\nAdd it anyway? If you're trying to fix a wrong date, cancel this and use Edit on the existing record instead.`
            )
            if (!confirmed) continue
          }

          await addVaccineRecord({
            dogId,
            name: v.name,
            dateGiven: v.dateGiven || '',
            nextDue: v.nextDue || '',
            vetClinic: v.vetClinic || '',
            uncertain: v.uncertain || false,
            documentPath: filePath || null,
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

    // Save health tests — one record per detected test type, mirroring the
    // vaccines loop above. Backward-compat: if the scan response still has
    // the old singular `healthTest` (stale cache or a model response
    // predating the array schema), treat it as a one-item array so existing
    // scans keep working unchanged.
    const rawHealthTests: any[] = Array.isArray(result.healthTests)
      ? result.healthTests
      : result.healthTest
        ? [result.healthTest]
        : []

    for (const ht of rawHealthTests) {
      // Any testType the model returns must map to the real 6-value enum —
      // freeform variants ("hip scoring", "ophthalmologist", "luxating
      // patella", etc.) are normalised here; anything unrecognised is
      // skipped (never saved with a made-up type) and surfaced via toast.
      const normalisedType = normaliseTestType(ht?.testType)
      if (!normalisedType) {
        if (ht?.testType) skippedTests.push(String(ht.testType))
        continue
      }

      // FIX (bug: hipScore/elbowGrade rendering as "[object Object]"):
      // the AI scan occasionally returns `result` as a nested object
      // (e.g. { left: "Excellent", right: "Good" } for hip/elbow scores,
      // which often have separate left/right readings on the source
      // document) even though the documented schema says result is a
      // plain string. Coerce defensively here so a string is always what
      // gets saved and rendered, regardless of what shape the AI returns.
      const rawResult = ht?.result
      let safeResult = typeof rawResult === 'string'
        ? rawResult
        : rawResult && typeof rawResult === 'object'
          ? Object.entries(rawResult).map(([k, v]) => `${k}: ${v}`).join(', ')
          : ''

      // FIX (bug: "Health test result still showing ANKC"): some hip/elbow
      // certificates also print the dog's ANKC registration number on the
      // same page, and the AI occasionally wrote that number into the
      // result instead of (or alongside) the actual test outcome — the
      // scan.js prompt has been clarified to prevent this going forward,
      // but this guards the save step too. Checks whether the ANKC digits
      // appear anywhere inside the result, which also catches wrapped
      // forms like "ANKC 4100353152" or "ANKC: 4100353152".
      if (safeResult && dog.ankc) {
        const ankcDigits = dog.ankc.trim()
        if (ankcDigits && safeResult.includes(ankcDigits)) {
          safeResult = ''
        }
      }

      // FIX (bug: re-scanning the same document silently creates an exact
      // duplicate record with no warning): check for an existing health
      // test with the same type + date + cert number (when a cert number
      // is present, that's the strongest signal of "this is literally the
      // same certificate") before saving.
      const possibleDuplicate = healthTests.find(h =>
        h.testType === normalisedType &&
        h.dateTested === (ht.dateTested || '') &&
        (
          (ht.certNumber && h.certNumber === ht.certNumber) ||
          (!ht.certNumber && formatHealthResult(h.result) === safeResult)
        )
      )
      if (possibleDuplicate) {
        const confirmed = window.confirm(
          `This looks like a duplicate of an existing ${normalisedType.toUpperCase()} test from ${ht.dateTested || 'the same date'} (Cert: ${ht.certNumber || 'n/a'}).\n\nAdd it anyway? If you're trying to attach a document to the existing record, cancel this and delete the old record instead, or use Edit on the existing one.`
        )
        if (!confirmed) continue
      }

      const newHealthTestId = await addHealthTest({
        dogId,
        testType: normalisedType,
        result: safeResult,
        dateTested: ht.dateTested || '',
        lab: ht.lab || '',
        certNumber: ht.certNumber || '',
      }).catch(() => null)
      healthCount++
      // Update health test record with documentUrl. Using the ID returned
      // directly from addHealthTest (not "last item from getHealthTests",
      // which has no orderBy and no guaranteed insertion order) removes the
      // guesswork of which record a shared cert document belongs to.
      if (filePath && newHealthTestId) {
        await updateDoc(doc(db, 'healthTests', newHealthTestId), { documentPath: filePath }).catch(() => {})
      }
      await logAudit({
        tenantId: user?.uid || '',
        dogId,
        dogName: dog.name,
        action: 'health_test_added',
        details: `Health test "${normalisedType.toUpperCase()}" added via iDogs Scan — result: ${safeResult || '(not extracted)'}`,
        performedBy: user?.uid || '',
        performedByEmail: user?.email || '',
      })
    }
    if (healthCount > 0) {
      const updatedHealth = await getHealthTests(dogId)
      setHealthTests(updatedHealth)
    }

    // Update dog fields from scan
    const updates: Partial<Dog> = {}
    if (result.microchip && !dog.microchip) updates.microchip = result.microchip
    if (result.ankc && !dog.ankc) updates.ankc = result.ankc
    if (result.breed && !dog.breed) updates.breed = result.breed
    if (result.colour && !dog.colour) updates.colour = result.colour
    if (result.sex && !dog.sex) updates.sex = result.sex
    if (result.dateOfBirth && !dog.dateOfBirth) updates.dateOfBirth = result.dateOfBirth
    // Save microchip cert path if scanned
    if (filePath && result.microchip) (updates as any).microchipCertPath = filePath
    if (Object.keys(updates).length > 0) {
      await updateDog(dogId, updates)
      setDog(prev => prev ? { ...prev, ...updates } : prev)
    }

    // Toast summary
    const parts = []
    if (vaccineCount > 0) parts.push(`${vaccineCount} vaccine(s)`)
    if (healthCount > 0) parts.push(`${healthCount} health test(s)`)
    if (Object.keys(updates).length > 0) parts.push('dog info updated')
    toast(`Saved: ${parts.length > 0 ? parts.join(', ') : 'no new records found'}`)
    if (skippedTests.length > 0) {
      toast(`${skippedTests.length} test type(s) not recognised — not saved: ${skippedTests.join(', ')}`, 'info')
    }

    // Navigate to relevant tab
    if (healthCount > 0 && vaccineCount === 0) setTab('health')
    else if (vaccineCount > 0) setTab('vaccines')
  }

  const viewDoc = (path?: string | null, legacyUrl?: string | null) =>
    viewDocument(user, toast, path, legacyUrl)

  async function handleTransfer(buyerName: string, buyerEmail: string, buyerPhone?: string) {
    if (!dogId || !dog) return
    const passportUrl = `${window.location.origin}/p/${dog.passportId}`
    await transferDogOwnership(dogId, {
      buyerName,
      buyerEmail,
      buyerPhone,
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
    setDog(prev => prev ? { ...prev, status: 'transferred', buyerName, buyerEmail, buyerPhone } as any : prev)
    setShowTransfer(false)
    toast(`${dog.name} transferred to ${buyerName} ✓`, 'success')
  }

  if (loading) return <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
  if (!dog) return null

  const publicUrl = `${window.location.origin}/p/${dog.passportId}`

  // Only consider the latest record per vaccine group for the header status.
  // A record is "superseded" if a newer dose of the same type was given —
  // same logic as the VaccinesTab isLatestOfItsName function.
  const groupKeyHeader = (name: string) => {
    const n = name.trim().toLowerCase()
    return /\bc[3-5]\b/.test(n) ? '__core_combo__' : n
  }
  const latestByNameHeader: Record<string, VaccineRecord> = {}
  for (const v of vaccines) {
    const key = groupKeyHeader(v.name)
    const current = latestByNameHeader[key]
    if (!current || v.dateGiven > current.dateGiven) {
      latestByNameHeader[key] = v
    }
  }
  const activeVaccines = Object.values(latestByNameHeader)
  // Pick the worst status across all active (non-superseded) vaccines
  const vaccStatus = (() => {
    if (activeVaccines.length === 0) return 'unknown' as const
    if (activeVaccines.some(v => v.nextDue && isOverdue(v.nextDue))) return 'overdue' as const
    if (activeVaccines.some(v => v.nextDue && isDueSoon(v.nextDue))) return 'due_soon' as const
    if (activeVaccines.every(v => !v.nextDue)) return 'unknown' as const
    return 'current' as const
  })()
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
    ...(dog.sex === 'female' ? [{ id: 'breeding' as Tab, label: '🌸 Breeding' }] : []),
  ]

  return (
    <div style={{ padding: 32 }}>
      <Link to="/app/dogs" style={{ fontSize: 13, color: 'var(--light)', textDecoration: 'none' }}>← My dogs</Link>

      {todaysMilestone && (
        <div style={{
          marginTop: 16, padding: '14px 20px', borderRadius: 12,
          background: 'var(--brand-50)', border: '1px solid var(--brand-300)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 22 }}>{todaysMilestone.kind === 'birthday' ? '🎉' : '🏠'}</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--brand-600)' }}>
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
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--dark)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dog.name}</h1>
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
              style={{ background: 'var(--brand-50)', color: 'var(--brand-600)', border: '1px solid var(--brand-300)' }}
            >
              🔄 Transfer
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="btn btn-sm"
            style={{ background: 'var(--redL, #FDEDED)', color: 'var(--error)', border: '1px solid #F3B0B0' }}
          >
            {deleting ? <span className="spinner" /> : '🗑 Delete'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ position: 'relative', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '10px 14px', border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--brand-600)' : '2px solid transparent',
              background: 'transparent',
              color: tab === t.id ? 'var(--brand-600)' : 'var(--mid)',
              fontSize: 13, fontWeight: tab === t.id ? 500 : 400,
              cursor: 'pointer', marginBottom: -1, whiteSpace: 'nowrap', flexShrink: 0,
            }}>{t.label}</button>
          ))}
        </div>
        {/* Fade hints on both edges so narrow screens (especially iOS
            Safari, which hides scrollbars by default) show there are more
            tabs to scroll to — without this, tabs further down the list
            like Timeline can sit off-screen with no visual indication a
            user needs to swipe to reach them. */}
        <div style={{ position: 'absolute', top: 0, bottom: 1, left: 0, width: 16, background: 'linear-gradient(to right, var(--white), transparent)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 1, right: 0, width: 16, background: 'linear-gradient(to left, var(--white), transparent)', pointerEvents: 'none' }} />
      </div>

      {tab === 'overview' && <OverviewTab dog={dog} vaccines={vaccines} wormings={wormings} healthTests={healthTests} scanCount={scanCount} toast={toast} onUpdateBreederId={async (breederIdType, breederIdValue) => {
        await updateDog(dogId!, { breederIdType: breederIdType as NonNullable<Dog['breederIdType']>, breederIdValue })
        setDog(prev => prev ? { ...prev, breederIdType, breederIdValue } : prev)
      }} onUpdateSale={async (firestoreUpdates, localUpdates) => {
        await updateDog(dogId!, firestoreUpdates)
        setDog(prev => prev ? { ...prev, ...localUpdates } : prev)
      }} />}
      {tab === 'scan' && (
        <div style={{ maxWidth: 480 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)', marginBottom: 8 }}>iDogs Document Scan</h2>
          <p style={{ fontSize: 14, color: 'var(--mid)', marginBottom: 20 }}>Photograph a Pedigree Certificate, Health Certificate, Hip and Elbow Dysplasia Report, or Vaccination Record. AI reads it and adds the records automatically.</p>
          <AIScan onResult={handleScanResult} toast={toast} dogId={dog.id} tenantId={user?.uid} />
        </div>
      )}
      {tab === 'vaccines' && <VaccinesTab dogId={dog.id} dogName={dog.name} tenantId={user?.uid || ''} userEmail={user?.email || ''} vaccines={vaccines} setVaccines={setVaccines} toast={toast} documents={documents} onViewDoc={viewDoc} />}
      {tab === 'worming' && <WormingTab dogId={dog.id} dogName={dog.name} tenantId={user?.uid || ''} userEmail={user?.email || ''} wormings={wormings} setWormings={setWormings} toast={toast} />}
      {tab === 'health' && <HealthTab dogId={dog.id} dogName={dog.name} tenantId={user?.uid || ''} userEmail={user?.email || ''} healthTests={healthTests} setHealthTests={setHealthTests} toast={toast} />}
      {tab === 'reminders' && <RemindersTab reminders={reminders} setReminders={setReminders} toast={toast} />}
      {tab === 'passport' && <PassportTab dog={dog} qrUrl={qrUrl} publicUrl={publicUrl} scanCount={scanCount} toast={toast} />}
      {tab === 'documents' && <DocumentsTab documents={documents} dogName={dog.name} toast={toast} />}
      {tab === 'timeline' && <TimelineTab dog={dog} notes={notes} newNote={newNote} setNewNote={setNewNote} newNoteDate={newNoteDate} setNewNoteDate={setNewNoteDate} onAddNote={handleAddNote} saving={savingNote} vaccines={vaccines} wormings={wormings} healthTests={healthTests} lifeStageEvents={lifeStageEvents} notePhoto={notePhoto} setNotePhoto={setNotePhoto} uploadingNotePhoto={uploadingNotePhoto} toast={toast} />}

      {tab === 'breeding' && <BreedingTab dog={dog} dogId={dogId!} userState={userState} onUpdate={async (updates) => {
        await updateDog(dogId!, updates)
        setDog(prev => prev ? { ...prev, ...updates } : prev)
        toast('Breeding record updated')
      }} toast={toast} />}

      {/* Transfer Ownership Modal */}
      {showTransfer && dog && (
        <TransferModal
          dogName={dog.name}
          dogBreed={dog.breed}
          breederIdType={dog.breederIdType}
          breederIdValue={dog.breederIdValue}
          initialBuyerName={dog.reservedForName || ''}
          initialBuyerEmail={dog.reservedForEmail || ''}
          initialBuyerPhone={dog.reservedForPhone || ''}
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
  breederIdType,
  breederIdValue,
  initialBuyerName,
  initialBuyerEmail,
  initialBuyerPhone,
  onClose,
  onTransfer,
}: {
  dogName: string
  dogBreed: string
  breederIdType?: Dog['breederIdType']
  breederIdValue?: string
  initialBuyerName?: string
  initialBuyerEmail?: string
  initialBuyerPhone?: string
  onClose: () => void
  onTransfer: (name: string, email: string, phone?: string) => Promise<void>
}) {
  const [buyerName, setBuyerName] = useState(initialBuyerName || '')
  const [buyerEmail, setBuyerEmail] = useState(initialBuyerEmail || '')
  const [buyerPhone, setBuyerPhone] = useState(initialBuyerPhone || '')
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!buyerName.trim() || !buyerEmail.trim()) { setError('Please fill in buyer name and email.'); return }
    if (!confirm) { setError('Please confirm the transfer.'); return }
    setLoading(true)
    setError('')
    try {
      await onTransfer(buyerName.trim(), buyerEmail.trim().toLowerCase(), buyerPhone.trim() || undefined)
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--brand-50)', borderRadius: 10, padding: '0.875rem 1rem' }}>
            <span style={{ fontSize: '1.5rem' }}>🐾</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--dark)' }}>{dogName}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--mid)' }}>{dogBreed}</div>
              {/* Feature C: Breeder ID in Transfer modal */}
              {breederIdType && breederIdType !== 'NONE' && breederIdValue && (
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 11 }}>🏷️</span>
                  <span style={{ fontSize: 11, color: 'var(--brand-600)', fontWeight: 500 }}>
                    {BREEDER_ID_CONFIG[breederIdType]?.label}: {breederIdValue}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Warning */}
          <div style={{ fontSize: '0.85rem', color: 'var(--warning)', background: '#FBF3E4', border: '1px solid #EBD9A8', borderRadius: 8, padding: '0.75rem 1rem' }}>
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

          {/* Buyer phone */}
          <div className="form-group">
            <label className="form-label">Buyer phone (optional)</label>
            <input
              className="form-input"
              type="tel"
              placeholder="e.g. 0412 345 678 (optional)"
              value={buyerPhone}
              onChange={e => setBuyerPhone(e.target.value)}
            />
          </div>

          {/* Confirm checkbox */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', fontSize: '0.875rem', color: 'var(--dark)', cursor: 'pointer', lineHeight: 1.4 }}>
            <input
              type="checkbox"
              checked={confirm}
              onChange={e => setConfirm(e.target.checked)}
              style={{ marginTop: 2, accentColor: 'var(--brand-600)', width: 16, height: 16, flexShrink: 0 }}
            />
            <span>I confirm I want to transfer <strong>{dogName}</strong> to this buyer. This action cannot be undone.</span>
          </label>

          {error && <p className="form-error">{error}</p>}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--gray-100)' }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={loading}>Cancel</button>
          <button
            className="btn btn-sm"
            onClick={handleSubmit}
            disabled={loading || !confirm}
            style={{ background: !confirm || loading ? 'var(--gray-100)' : 'var(--danger)', color: !confirm || loading ? 'var(--light)' : '#fff', border: 'none' }}
          >
            {loading ? <><span className="spinner" style={{ borderTopColor: '#fff', width: 14, height: 14 }} /> Transferring…</> : 'Transfer Ownership'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── OVERVIEW TAB ──────────────────────────────────────────────

function OverviewTab({ dog, vaccines, wormings, healthTests, scanCount, toast, onUpdateBreederId, onUpdateSale }: {
  dog: Dog; vaccines: VaccineRecord[]; wormings: WormingRecord[]; healthTests: HealthTest[]; scanCount: number
  toast: (msg: string, type?: ToastMessage['type']) => void
  onUpdateBreederId: (breederIdType: Dog['breederIdType'], breederIdValue: string) => Promise<void>
  onUpdateSale: (firestoreUpdates: any, localUpdates: Partial<Dog>) => Promise<void>
}) {
  const { user } = useAuth()
  const [editingBreederId, setEditingBreederId] = useState(false)
  const [breederIdType, setBreederIdType] = useState<NonNullable<Dog['breederIdType']>>(dog.breederIdType || 'NONE')
  const [breederIdValue, setBreederIdValue] = useState(dog.breederIdValue || '')
  const [savingBreederId, setSavingBreederId] = useState(false)

  async function handleSaveBreederId() {
    setSavingBreederId(true)
    try {
      await onUpdateBreederId(breederIdType, breederIdType === 'NONE' ? '' : breederIdValue)
      setEditingBreederId(false)
      toast('Breeder ID updated')
    } catch {
      toast('Failed to update Breeder ID', 'error')
    } finally {
      setSavingBreederId(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      <InfoSection title="Details">
        <InfoRow label="Date of birth" value={formatDate(dog.dateOfBirth)} />
        <InfoRow label="Age" value={getDogAge(dog.dateOfBirth)} />
        <InfoRow label="Breed" value={dog.breed} />
        <InfoRow label="Sex" value={dog.sex === 'female' ? 'Female' : 'Male'} />
        <InfoRow label="Colour" value={dog.colour || '—'} />
        <InfoRow label="Microchip" value={dog.microchip || '—'} />
        {((dog as any).microchipCertPath || (dog as any).microchipCertUrl) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--light)' }}>Microchip cert</span>
            <button
              onClick={() => viewDocument(user, toast, (dog as any).microchipCertPath, (dog as any).microchipCertUrl)}
              style={{ color: 'var(--brand-600)', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13 }}
            >
              📄 View cert
            </button>
          </div>
        )}
        <InfoRow label="Dogs Australia Registration" value={dog.ankc || '—'} />
        {/* Pedigree Register */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--light)', flexShrink: 0 }}>Pedigree / Registration</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {(dog as any).pedigreeRegister === 'limited' ? (
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: '#FFF3E0', color: '#E65100', border: '1px solid #FFCC80' }}>
                🟠 Limited — not eligible to breed
              </span>
            ) : (dog as any).pedigreeRegister === 'no_pedigree' ? (
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: 'var(--sand)', color: 'var(--mid)' }}>
                No pedigree (purebred)
              </span>
            ) : (dog as any).pedigreeRegister === 'mixed' ? (
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: 'var(--sand)', color: 'var(--mid)' }}>
                Mixed breed
              </span>
            ) : (dog as any).pedigreeRegister === 'rescue' ? (
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: 'var(--sand)', color: 'var(--mid)' }}>
                Rescue / unknown
              </span>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: 'var(--brand-50)', color: 'var(--brand-600)', border: '1px solid rgba(8,80,65,0.15)' }}>
                🔵 Main Register — eligible to breed
              </span>
            )}
            <select
              className="form-select"
              value={(dog as any).pedigreeRegister || 'main'}
              onChange={async e => {
                await updateDog(dog.id, { pedigreeRegister: e.target.value } as any)
                toast('Pedigree status updated')
              }}
              style={{ height: 28, fontSize: 12, padding: '0 28px 0 8px', minWidth: 100 }}
            >
              <option value="main">🔵 Main</option>
              <option value="limited">🟠 Limited</option>
              <option value="no_pedigree">No pedigree</option>
              <option value="mixed">Mixed breed</option>
              <option value="rescue">Rescue</option>
            </select>
          </div>
        </div>
        {editingBreederId ? (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <label style={{ fontSize: 12, color: 'var(--light)', display: 'block', marginBottom: 4 }}>Breeder ID type</label>
            <select
              className="form-input"
              value={breederIdType}
              onChange={e => setBreederIdType(e.target.value as NonNullable<Dog['breederIdType']>)}
              style={{ marginBottom: 8 }}
            >
              {(Object.keys(BREEDER_ID_CONFIG) as Array<keyof typeof BREEDER_ID_CONFIG>).map(key => (
                <option key={key} value={key}>{BREEDER_ID_CONFIG[key].label}</option>
              ))}
            </select>
            {breederIdType !== 'NONE' && (
              <>
                <label style={{ fontSize: 12, color: 'var(--light)', display: 'block', marginBottom: 4 }}>ID value</label>
                <input
                  className="form-input"
                  value={breederIdValue}
                  onChange={e => setBreederIdValue(e.target.value)}
                  placeholder="e.g. B123456789"
                  style={{ marginBottom: 8 }}
                />
              </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={handleSaveBreederId} disabled={savingBreederId}>{savingBreederId ? <span className="spinner" /> : 'Save'}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setEditingBreederId(false); setBreederIdType(dog.breederIdType || 'NONE'); setBreederIdValue(dog.breederIdValue || '') }}>Cancel</button>
            </div>
          </div>
        ) : dog.breederIdType && dog.breederIdType !== 'NONE' && dog.breederIdValue ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--light)' }}>{BREEDER_ID_CONFIG[dog.breederIdType].label}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--dark)', fontWeight: 500 }}>{dog.breederIdValue}</span>
              {BREEDER_ID_CONFIG[dog.breederIdType].verifyUrl && (
                <a
                  href={BREEDER_ID_CONFIG[dog.breederIdType].verifyUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--brand-600)', fontWeight: 500, textDecoration: 'none', fontSize: 12 }}
                >
                  Verify ↗
                </a>
              )}
              <button onClick={() => setEditingBreederId(true)} className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: 12 }}>✎</button>
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--light)' }}>Breeder ID</span>
            <button onClick={() => setEditingBreederId(true)} className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 12, color: 'var(--brand-600)' }}>+ Add</button>
          </div>
        )}
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
      <SaleAvailabilityPanel dog={dog} onSave={onUpdateSale} toast={toast} />
    </div>
  )
}

// ── SALE & AVAILABILITY PANEL ────────────────────────────────

function SaleAvailabilityPanel({ dog, onSave, toast }: {
  dog: Dog
  onSave: (firestoreUpdates: any, localUpdates: Partial<Dog>) => Promise<void>
  toast: (msg: string, type?: ToastMessage['type']) => void
}) {
  const initial = {
    availabilityStatus: dog.availabilityStatus || '',
    reservedForName: dog.reservedForName || '',
    reservedForEmail: dog.reservedForEmail || '',
    reservedForPhone: dog.reservedForPhone || '',
    reservedAt: dog.reservedAt || '',
    depositStatus: dog.depositStatus || 'none',
    depositAmount: dog.depositAmount != null ? String(dog.depositAmount) : '',
    depositReceivedAt: dog.depositReceivedAt || '',
  }
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)

  const hasChanges = (Object.keys(initial) as Array<keyof typeof initial>).some(k => form[k] !== initial[k])

  function handleAvailabilityChange(value: string) {
    setForm(prev => ({
      ...prev,
      availabilityStatus: value,
      reservedAt: value === 'reserved' && !prev.reservedAt ? new Date().toISOString().split('T')[0] : prev.reservedAt,
    }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const clean = (v: string) => (v.trim() === '' ? undefined : v.trim())
      const isReservedOrSold = form.availabilityStatus === 'reserved' || form.availabilityStatus === 'sold'
      const amt = Number(form.depositAmount)
      const depositAmount =
        form.depositAmount.trim() === '' || Number.isNaN(amt) || amt < 0 ? undefined : amt

      const localUpdates: Partial<Dog> = {
        availabilityStatus: clean(form.availabilityStatus) as Dog['availabilityStatus'],
        reservedForName: isReservedOrSold ? clean(form.reservedForName) : undefined,
        reservedForEmail: isReservedOrSold ? clean(form.reservedForEmail) : undefined,
        reservedForPhone: isReservedOrSold ? clean(form.reservedForPhone) : undefined,
        reservedAt: isReservedOrSold ? clean(form.reservedAt) : undefined,
        depositStatus: isReservedOrSold ? (form.depositStatus as Dog['depositStatus']) : 'none',
        depositAmount: isReservedOrSold ? depositAmount : undefined,
        depositReceivedAt: isReservedOrSold ? clean(form.depositReceivedAt) : undefined,
      }

      const orDelete = (v: unknown) => (v === undefined ? deleteField() : v)
      const firestoreUpdates: any = {
        availabilityStatus: orDelete(localUpdates.availabilityStatus),
        reservedForName: orDelete(localUpdates.reservedForName),
        reservedForEmail: orDelete(localUpdates.reservedForEmail),
        reservedForPhone: orDelete(localUpdates.reservedForPhone),
        reservedAt: orDelete(localUpdates.reservedAt),
        depositStatus: localUpdates.depositStatus,
        depositAmount: orDelete(localUpdates.depositAmount),
        depositReceivedAt: orDelete(localUpdates.depositReceivedAt),
      }

      await onSave(firestoreUpdates, localUpdates)
      toast('Sale & availability updated')
    } catch {
      toast('Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const status = form.availabilityStatus
  const showReservationAndDeposit = status === 'reserved' || status === 'sold'

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--mid)' }}>Sale & availability</div>
        {status === 'available' ? (
          <span className="badge badge-green">Available</span>
        ) : status === 'reserved' ? (
          <span className="badge" style={{ background: 'var(--gray-100)', color: 'var(--warning)' }}>Reserved</span>
        ) : status === 'sold' ? (
          <span className="badge badge-gray">Sold</span>
        ) : status === 'kept' ? (
          <span className="badge badge-gray">Retained by breeder</span>
        ) : (
          <span className="badge badge-gray">Not for sale</span>
        )}
      </div>

      <div className="form-group" style={{ maxWidth: 260, marginBottom: 16 }}>
        <label className="form-label">Availability</label>
        <select
          className="form-select"
          value={form.availabilityStatus}
          onChange={e => handleAvailabilityChange(e.target.value)}
        >
          <option value="">Not for sale</option>
          <option value="available">Available</option>
          <option value="reserved">Reserved</option>
          <option value="kept">Kept</option>
          <option value="sold">Sold</option>
        </select>
      </div>

      {showReservationAndDeposit && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Reserved for — name</label>
              <input className="form-input" value={form.reservedForName} onChange={e => setForm(prev => ({ ...prev, reservedForName: e.target.value }))} placeholder="e.g. Jane Smith" />
            </div>
            <div className="form-group">
              <label className="form-label">Reserved for — email</label>
              <input className="form-input" type="email" value={form.reservedForEmail} onChange={e => setForm(prev => ({ ...prev, reservedForEmail: e.target.value }))} placeholder="e.g. jane@example.com" />
            </div>
            <div className="form-group">
              <label className="form-label">Reserved for — phone</label>
              <input className="form-input" value={form.reservedForPhone} onChange={e => setForm(prev => ({ ...prev, reservedForPhone: e.target.value }))} placeholder="e.g. 0412 345 678" />
            </div>
            <div className="form-group">
              <label className="form-label">Reserved on</label>
              <input className="form-input" type="date" value={form.reservedAt} onChange={e => setForm(prev => ({ ...prev, reservedAt: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Deposit status</label>
              <select className="form-select" value={form.depositStatus} onChange={e => setForm(prev => ({ ...prev, depositStatus: e.target.value as 'none' | 'pending' | 'received' }))}>
                <option value="none">None</option>
                <option value="pending">Pending</option>
                <option value="received">Received</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Deposit amount (AUD)</label>
              <input className="form-input" type="number" min="0" value={form.depositAmount} onChange={e => setForm(prev => ({ ...prev, depositAmount: e.target.value }))} placeholder="e.g. 500" />
            </div>
            <div className="form-group">
              <label className="form-label">Deposit received on</label>
              <input className="form-input" type="date" value={form.depositReceivedAt} onChange={e => setForm(prev => ({ ...prev, depositReceivedAt: e.target.value }))} />
            </div>
          </div>
        </>
      )}

      <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!hasChanges || saving}>
        {saving ? <span className="spinner" style={{ borderTopColor: '#fff', width: 14, height: 14 }} /> : 'Save'}
      </button>
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
  onViewDoc: (path?: string | null, legacyUrl?: string | null) => void
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
            // Determine the most recent record per vaccine "family" (by
            // dateGiven). Core combo vaccines (C3/C4/C5 — e.g. "Protech
            // C3", "Nobivac C4") are grouped together regardless of
            // valency, since a later dose of any of these supersedes an
            // earlier one in practice (the breeder gave a newer core
            // shot, whatever its exact valency). Non-core vaccines (e.g.
            // Kennel Cough, Rabies) are still grouped strictly by exact
            // name, since those are genuinely separate vaccination
            // schedules that shouldn't be conflated.
            //
            // Only the latest record of each group is eligible to show
            // as Overdue — older records that have since been
            // superseded by a newer dose are shown as a plain history
            // entry instead. Comparing dateGiven directly (not entry
            // order) means this stays correct even if records were
            // added/corrected out of chronological order.
            const groupKey = (name: string) => {
              const n = name.trim().toLowerCase()
              return /\bc[3-5]\b/.test(n) ? '__core_combo__' : n
            }
            const latestByName: Record<string, string> = {}
            for (const v of vaccines) {
              const key = groupKey(v.name)
              const current = latestByName[key]
              if (!current) { latestByName[key] = v.id; continue }
              const currentRecord = vaccines.find(x => x.id === current)
              if (currentRecord && v.dateGiven > currentRecord.dateGiven) {
                latestByName[key] = v.id
              }
            }
            const isLatestOfItsName = (v: VaccineRecord) => latestByName[groupKey(v.name)] === v.id

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
                  background: v.uncertain ? '#FBF3E4' : 'transparent',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)' }}>
                      {v.name}
                      {v.uncertain && <span style={{ fontSize: 11, color: 'var(--warning)', marginLeft: 6, fontWeight: 600 }}>⚠ Unclear from scan — please verify</span>}
                    </div>
                    <div style={{ fontSize: 12, color: v.uncertain ? 'var(--warning)' : 'var(--light)', fontWeight: v.uncertain ? 600 : 400 }}>
                      Given: {formatDate(v.dateGiven)}{v.nextDue ? ` · Due: ${formatDate(v.nextDue)}` : ''}{v.vetClinic ? ` · ${v.vetClinic}` : ''}
                    </div>
                  </div>
                  {showOverdueBadge ? (
                    <span className={`badge ${v.nextDue && isOverdue(v.nextDue) ? 'badge-red' : 'badge-green'}`}>{v.nextDue && isOverdue(v.nextDue) ? 'Overdue' : 'Current'}</span>
                  ) : v.nextDue ? (
                    <span className="badge badge-gray">Superseded</span>
                  ) : null}
                  {((v as any).documentPath || (v as any).documentUrl) && (
                    <button
                      onClick={() => onViewDoc((v as any).documentPath, (v as any).documentUrl)}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                    >
                      📄 View
                    </button>
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

// Defensive formatter for HealthTest.result — protects against legacy
// records saved before the AI Scan fix above, where `result` could have
// been stored as a nested object (e.g. left/right hip scores) instead of
// a plain string, which rendered as "[object Object]" in the UI. Safe to
// call on already-correct string values too (returns them unchanged).
function formatHealthResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    return Object.entries(result as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join(', ')
  }
  return ''
}

function HealthTab({ dogId, dogName, tenantId, userEmail, healthTests, setHealthTests, toast }: {
  dogId: string;
  dogName: string;
  tenantId: string;
  userEmail: string;
  healthTests: HealthTest[];
  setHealthTests: (h: HealthTest[]) => void;
  toast: (msg: string, type?: ToastMessage['type']) => void
}) {
  const { user } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ testType: 'hip', result: '', dateTested: '', lab: '', certNumber: '' })
  const [saving, setSaving] = useState(false)

  // Edit/delete state for Health Test, mirroring the existing Vaccine
  // edit pattern in VaccineTab — health tests previously had no way to
  // correct a mistake after saving (e.g. fixing a typo'd result) without
  // deleting and re-adding manually.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ testType: 'hip' as HealthTest['testType'], result: '', dateTested: '', lab: '', certNumber: '' })
  const [savingEdit, setSavingEdit] = useState(false)

  function startEdit(h: HealthTest) {
    setEditingId(h.id)
    setEditForm({
      testType: h.testType,
      result: formatHealthResult(h.result),
      dateTested: h.dateTested || '',
      lab: h.lab || '',
      certNumber: h.certNumber || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function handleSaveEdit() {
    if (!editingId || !editForm.testType || !editForm.dateTested) return
    setSavingEdit(true)
    try {
      await updateHealthTest(editingId, {
        testType: editForm.testType,
        result: editForm.result,
        dateTested: editForm.dateTested,
        lab: editForm.lab,
        certNumber: editForm.certNumber,
      })
      await logAudit({
        tenantId,
        dogId,
        dogName,
        action: 'health_test_added',
        details: `Health test "${editForm.testType.toUpperCase()}" edited — result: ${editForm.result || '(not extracted)'}`,
        performedBy: tenantId,
        performedByEmail: userEmail,
      })
      const updated = await getHealthTests(dogId)
      setHealthTests(updated)
      setEditingId(null)
      toast('Health test updated')
    } catch {
      toast('Failed to update health test', 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteHealthTest(id)
      const updated = await getHealthTests(dogId)
      setHealthTests(updated)
      toast('Health test deleted')
    } catch {
      toast('Failed to delete health test', 'error')
    }
  }

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
          {healthTests.map((h, i) => {
            if (editingId === h.id) {
              return (
                <div key={h.id} className="card" style={{ margin: 12, padding: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div className="form-group">
                      <label className="form-label">Test type *</label>
                      <select className="form-input" value={editForm.testType} onChange={e => setEditForm(p => ({ ...p, testType: e.target.value as HealthTest['testType'] }))}>
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
                      <input className="form-input" type="date" value={editForm.dateTested} onChange={e => setEditForm(p => ({ ...p, dateTested: e.target.value }))} max={new Date().toISOString().split('T')[0]} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Result</label>
                      <input className="form-input" value={editForm.result} onChange={e => setEditForm(p => ({ ...p, result: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Lab</label>
                      <input className="form-input" value={editForm.lab} onChange={e => setEditForm(p => ({ ...p, lab: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Cert number</label>
                      <input className="form-input" value={editForm.certNumber} onChange={e => setEditForm(p => ({ ...p, certNumber: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveEdit} disabled={savingEdit}>{savingEdit ? <span className="spinner" /> : 'Save changes'}</button>
                    <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              )
            }

            return (
            <div key={h.id} style={{ padding: '12px 16px', borderBottom: i < healthTests.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)' }}>{h.testType.toUpperCase()} — {formatHealthResult(h.result)}</div>
                <div style={{ fontSize: 12, color: 'var(--light)' }}>Tested: {formatDate(h.dateTested)}{h.lab ? ` · ${h.lab}` : ''}</div>
                {h.certNumber && <div style={{ fontSize: 12, color: 'var(--light)' }}>Cert: {h.certNumber}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span className="badge badge-green">Verified</span>
                {((h as any).documentPath || (h as any).documentUrl) && (
                  <button
                    onClick={() => viewDocument(user, toast, (h as any).documentPath, (h as any).documentUrl)}
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '4px 10px', fontSize: 12 }}
                  >
                    📄 View
                  </button>
                )}
                <button onClick={() => startEdit(h)} className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }}>✎ Edit</button>
                <button onClick={() => handleDelete(h.id)} className="btn btn-ghost btn-sm" style={{ color: 'var(--error)', padding: '4px 8px' }}>✕</button>
              </div>
            </div>
            )
          })}
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
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < active.length - 1 ? '1px solid var(--border)' : 'none', background: overdue ? '#FDEDED' : undefined }}>
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
        <div style={{ background: 'linear-gradient(135deg, var(--brand-900), var(--brand-600))', borderRadius: 16, padding: 20, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 10, fontWeight: 500 }}>🐾 iDogs Digital Passport</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{dog.name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 14 }}>{dog.breed} · {getDogAge(dog.dateOfBirth)}</div>
          {qrUrl && <div style={{ background: '#fff', borderRadius: 10, padding: 10, marginBottom: 10 }}><img src={qrUrl} alt="QR" style={{ width: '100%' }} /></div>}
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>Scan with any phone camera</div>
          {/* Feature B: Breeder ID banner in QR Passport card */}
          {dog.breederIdType && dog.breederIdType !== 'NONE' && dog.breederIdValue && (
            <div style={{
              marginTop: 10, padding: '6px 10px', borderRadius: 8,
              background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 12 }}>🏷️</span>
              <div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                  {BREEDER_ID_CONFIG[dog.breederIdType]?.label}
                </div>
                <div style={{ fontSize: 11, color: '#fff', fontWeight: 600, letterSpacing: '.02em' }}>
                  {dog.breederIdValue}
                </div>
              </div>
            </div>
          )}
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
          <div style={{ fontSize: 13, color: 'var(--brand-600)', background: 'var(--brand-50)', padding: '8px 12px', borderRadius: 8 }}>
            ✓ Data stored in Australia · Australian Privacy Act 1988 compliant
          </div>
        </div>
      </div>
    </div>
  )
}

// ── DOCUMENTS TAB ────────────────────────────────────────────

function DocumentsTab({ documents, dogName, toast }: { documents: any[]; dogName: string; toast: (msg: string, type?: ToastMessage['type']) => void }) {
  const { user } = useAuth()
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
                background: 'var(--brand-50)',
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
                  <div style={{ fontSize: 12, color: 'var(--brand-600)', marginTop: 2 }}>
                    💉 {doc.extractedData.vaccines} vaccine(s) extracted
                  </div>
                )}
                {doc.extractedData?.healthTest && (
                  <div style={{ fontSize: 12, color: 'var(--brand-600)', marginTop: 2 }}>
                    🔬 {doc.extractedData.healthTest} test extracted
                  </div>
                )}
              </div>
              <button
                onClick={() => viewDocument(user, toast, (doc as any).filePath || (doc as any).storagePath, doc.fileUrl)}
                className="btn btn-secondary btn-sm"
              >
                View ↗
              </button>
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
      events.push({ date: occurredOn.toISOString(), icon: '🎂', title: `${ordinal(y)} birthday`, kind: 'stage' })
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
      events.push({ date: h.dateTested, icon: '🔬', title: `Health test — ${h.testType.toUpperCase()}`, detail: formatHealthResult(h.result), kind: 'health' })
    }
  })

  lifeStageEvents.forEach(e => {
    events.push({ date: e.createdAt, icon: '🌟', title: e.details, kind: 'stage' })
  })

  if ((dog as any).transferredAt) {
    events.push({ date: (dog as any).transferredAt, icon: '🏠', title: `Transferred to ${(dog as any).buyerName || 'new owner'}`, kind: 'transfer' })
  }

  notes.forEach(n => {
    // Use noteDate (the date the user says the event happened) for
    // Timeline ordering/display, not createdAt (the date the note record
    // was saved) — falls back to createdAt for notes added before this
    // field existed.
    events.push({ date: n.noteDate || n.createdAt, icon: '📝', title: n.note, photoUrl: n.photoUrl, kind: 'note' })
  })

  events.push(...getPastMilestoneEvents(dog.dateOfBirth, dog.createdAt))

  // FIX (crash: "(l.date || '').localeCompare is not a function"): the
  // root cause was getActivityNotes() returning a raw Firestore Timestamp
  // object for createdAt instead of a string (now fixed in db.ts), but
  // sorting defensively here too in case any other date source (vaccines,
  // worming, health tests, audit log entries) ever comes through
  // un-converted — a Timestamp object is truthy, so `date || ''` doesn't
  // catch it, and .localeCompare only exists on strings.
  const toDateString = (d: unknown): string => {
    if (typeof d === 'string') return d
    if (d && typeof d === 'object' && 'toDate' in d && typeof (d as any).toDate === 'function') {
      return (d as any).toDate().toISOString()
    }
    return ''
  }

  return events.sort((a, b) => toDateString(a.date).localeCompare(toDateString(b.date)))
}

const STORY_EVENT_COLOR: Record<StoryEvent['kind'], string> = {
  birth: 'var(--gold-500)',
  vaccine: 'var(--brand-600)',
  worming: 'var(--brand-300)',
  health: 'var(--brand-900)',
  stage: 'var(--gold-500)',
  transfer: 'var(--mid)',
  note: 'var(--brand-600)',
}

function TimelineTab({ dog, notes, newNote, setNewNote, newNoteDate, setNewNoteDate, onAddNote, saving, vaccines, wormings, healthTests, lifeStageEvents, notePhoto, setNotePhoto, uploadingNotePhoto, toast }: {
  dog: Dog; notes: ActivityNote[]; newNote: string; setNewNote: (v: string) => void;
  newNoteDate: string; setNewNoteDate: (v: string) => void;
  onAddNote: () => void; saving: boolean;
  vaccines: VaccineRecord[]; wormings: WormingRecord[]; healthTests: HealthTest[]; lifeStageEvents: AuditEntry[];
  notePhoto: { base64: string; mediaType: string; preview: string } | null;
  setNotePhoto: (p: { base64: string; mediaType: string; preview: string } | null) => void;
  uploadingNotePhoto: boolean;
  toast: (msg: string, type?: ToastMessage['type']) => void
}) {
  const events = buildStoryEvents(dog, vaccines, wormings, healthTests, lifeStageEvents, notes)

  // FIX (bug: iPhone photos ~3MB fail to upload): there was no
  // resize/compression step before base64-encoding. Base64 inflates size
  // by ~33%, so a 3MB photo becomes ~4MB as base64 — right at the edge of
  // Vercel's default ~4.5MB serverless function body limit once JSON
  // overhead (dogId, userId, mediaType) is added, and easily over it for
  // anything slightly larger. Resizing down to a max dimension and
  // re-encoding as JPEG at a reasonable quality keeps note photos small
  // without a visible quality loss at the sizes they're displayed.
  // FIX (same as PhotoUpload.tsx): iPhone .heic/.heif photos can't be
  // decoded by <img> in Chrome/Firefox/Edge — img.onload never fires, so
  // without this check the old fallback below would silently send raw
  // unusable HEIC bytes to the server instead of failing clearly.
  function isHeic(file: File): boolean {
    const type = file.type.toLowerCase()
    const name = file.name.toLowerCase()
    return type === 'image/heic' || type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif')
  }

  function resizeImage(file: File | Blob, maxDimension = 1600, quality = 0.82): Promise<{ base64: string; mediaType: string; preview: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          let { width, height } = img
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width)
              width = maxDimension
            } else {
              width = Math.round((width * maxDimension) / height)
              height = maxDimension
            }
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) { reject(new Error('Canvas not supported')); return }
          ctx.drawImage(img, 0, 0, width, height)
          const dataUrl = canvas.toDataURL('image/jpeg', quality)
          resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', preview: dataUrl })
        }
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = reader.result as string
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(file)
    })
  }

  async function handlePhotoSelect(e: { target: { files: FileList | null } }) {
    const file = e.target.files?.[0]
    if (!file) return

    if (isHeic(file)) {
      // Send raw HEIC to server \u2014 sharp handles conversion server-side
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        setNotePhoto({ base64: result.split(',')[1], mediaType: file.type || 'image/heic', preview: result })
      }
      reader.readAsDataURL(file)
      return
    }

    try {
      const resized = await resizeImage(file)
      setNotePhoto(resized)
    } catch {
      // Fall back to the original unresized file rather than silently
      // failing — better to attempt the original upload than block the
      // user entirely if canvas resizing fails for some reason. (HEIC is
      // already handled above by this point, so this fallback is only
      // for non-HEIC formats the canvas couldn't process.)
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        const base64 = result.split(',')[1]
        setNotePhoto({ base64, mediaType: file.type, preview: result })
      }
      reader.readAsDataURL(file)
    }
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>{dog.name}'s story</h2>
      <p style={{ fontSize: 13, color: 'var(--light)', marginBottom: 16 }}>Every milestone, automatically gathered in one place.</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: 'var(--light)', display: 'block', marginBottom: 4 }}>When did this happen?</label>
        <input
          className="form-input"
          type="date"
          value={newNoteDate}
          onChange={e => setNewNoteDate(e.target.value)}
          max={new Date().toISOString().split('T')[0]}
          style={{ marginBottom: 10, maxWidth: 200 }}
        />
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
        <div style={{ position: 'relative', paddingLeft: 36 }}>
          {/* Vertical timeline line */}
          <div style={{ position: 'absolute', left: 15, top: 6, bottom: 6, width: 2, background: 'var(--border)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {events.map((e, i) => (
              <div key={i} style={{ position: 'relative' }}>
                {/* Dot on the timeline */}
                <div style={{
                  position: 'absolute', left: -36, top: 0,
                  width: 32, height: 32, borderRadius: '50%',
                  background: STORY_EVENT_COLOR[e.kind], color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, border: '2px solid var(--white)',
                }}>
                  {e.icon}
                </div>
                <div className="card" style={{ padding: '12px 16px' }}>
                  {e.photoUrl && (
                    <img
                      src={e.photoUrl}
                      alt=""
                      style={{
                        width: '100%', maxHeight: 320, objectFit: 'contain',
                        background: 'var(--sand)', borderRadius: 8, marginBottom: 10,
                      }}
                    />
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

// ── BREEDING TAB ─────────────────────────────────────────────
// Dogs SA / Dogs Australia compliance rules for SA breeders:
// • Min age 12 months before first mating (Dogs SA Code of Ethics + SA Standards)
// • Max 2 litters in any 18-month period (Dogs Australia Reg 8.2 / Dogs SA)
// • Max 5 litters lifetime (SA breeder licensing scheme 2026)
// • Max breeding age 8 years (vet certificate required, Dogs SA)
// • Large breeds recommended min 18 months / heat 2-3 before first mating
// • Heat cycle: avg every 6 months (4-12 months depending on breed/size)

const LARGE_BREEDS_LIST = [
  'Labrador Retriever','Golden Retriever','German Shepherd','Rottweiler',
  'Bernese Mountain Dog','Great Dane','Irish Wolfhound','St Bernard',
  'Alaskan Malamute','Newfoundland','Leonberger','Dobermann',
  'Weimaraner','Vizsla','Rhodesian Ridgeback','Boxer','Dalmatian',
  'Standard Poodle','Afghan Hound','Greyhound','Bloodhound',
]
const GIANT_BREEDS_LIST = [
  'Great Dane','Irish Wolfhound','St Bernard','Alaskan Malamute',
  'Newfoundland','Leonberger','Mastiff','Bullmastiff','Tibetan Mastiff',
]
const SMALL_BREEDS_LIST = [
  'Chihuahua','Pomeranian','Maltese','Yorkshire Terrier','Toy Poodle',
  'Shih Tzu','Cavalier King Charles Spaniel','Pug','French Bulldog',
  'Boston Terrier','Papillon','Miniature Pinscher',
]

function getBreedSize(breed: string): 'small' | 'medium' | 'large' | 'giant' {
  if (GIANT_BREEDS_LIST.includes(breed)) return 'giant'
  if (LARGE_BREEDS_LIST.includes(breed)) return 'large'
  if (SMALL_BREEDS_LIST.includes(breed)) return 'small'
  return 'medium'
}
function getHeatIntervalMonths(breed: string): number {
  const s = getBreedSize(breed)
  if (s === 'giant') return 10
  if (s === 'large') return 7
  if (s === 'small') return 5
  return 6
}
function getFirstHeatMonths(breed: string): number {
  const s = getBreedSize(breed)
  if (s === 'giant') return 18
  if (s === 'large') return 10
  if (s === 'small') return 6
  return 8
}
function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}
function fmtDate(date: Date): string {
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}
function ageAtDate(dob: string, date: Date): string {
  const birth = new Date(dob)
  const mo = (date.getFullYear() - birth.getFullYear()) * 12 + (date.getMonth() - birth.getMonth())
  if (mo < 12) return `${mo} months`
  const y = Math.floor(mo / 12); const r = mo % 12
  return r > 0 ? `${y}yr ${r}mo` : `${y} years`
}


// ── BREEDING COMPLIANCE RULES BY STATE ───────────────────────
interface StateRules {
  stateName: string
  minBreedingMonths: number
  minBreedingMonthsLarge: number
  maxLifetimeLitters: number
  maxLittersIn18Months: number
  maxCsections: number | null
  csectionVetRequired: number | null
  maxAgeYears: number
  vetCertAfterAge: number
  requiresBIN: boolean
  notes: string
  sourceUrl: string
  sourceName: string
}

const STATE_RULES: Record<string, StateRules> = {
  SA:  { stateName: 'South Australia',          minBreedingMonths: 12, minBreedingMonthsLarge: 18, maxLifetimeLitters: 5, maxLittersIn18Months: 2,   maxCsections: null, csectionVetRequired: null, maxAgeYears: 8, vetCertAfterAge: 8, requiresBIN: false, notes: 'Dogs SA membership (DACO) required. No specific C-section limit under SA law.', sourceUrl: 'https://www.dogssa.com.au/about/policies/dogs-sa-code-of-ethics-for-members-part-xv-codes/', sourceName: 'Dogs SA Code of Ethics' },
  NSW: { stateName: 'New South Wales',           minBreedingMonths: 12, minBreedingMonthsLarge: 18, maxLifetimeLitters: 5, maxLittersIn18Months: 999, maxCsections: 3,    csectionVetRequired: 2,    maxAgeYears: 8, vetCertAfterAge: 8, requiresBIN: true,  notes: 'BIN mandatory from 1 Dec 2025. Max 5 litters OR 3 C-sections lifetime, whichever first. Vet cert required before 3rd C-section pregnancy.', sourceUrl: 'https://www.olg.nsw.gov.au/pets/nsw-pet-registry/breeders/changes-dog-breeding-laws', sourceName: 'NSW Prevention of Cruelty to Animals Act 1979 (amended 2024)' },
  VIC: { stateName: 'Victoria',                  minBreedingMonths: 12, minBreedingMonthsLarge: 18, maxLifetimeLitters: 5, maxLittersIn18Months: 2,   maxCsections: null, csectionVetRequired: null, maxAgeYears: 8, vetCertAfterAge: 8, requiresBIN: false, notes: 'Dogs Victoria AO status: up to 10 fertile females. PER source number required for all ads.', sourceUrl: 'https://dogsvictoria.org.au/media/6000/dv-code-of-practice-effective-150224.pdf', sourceName: 'Dogs Victoria Code of Practice' },
  QLD: { stateName: 'Queensland',                minBreedingMonths: 12, minBreedingMonthsLarge: 18, maxLifetimeLitters: 5, maxLittersIn18Months: 2,   maxCsections: null, csectionVetRequired: null, maxAgeYears: 8, vetCertAfterAge: 8, requiresBIN: false, notes: 'Register as breeder within 28 days of litter. Supply number required for all ads.', sourceUrl: 'https://www.business.qld.gov.au/industries/farms-fishing-forestry/agriculture/animal/industries/dogs', sourceName: 'Animal Care and Protection Act 2001 (QLD)' },
  WA:  { stateName: 'Western Australia',         minBreedingMonths: 12, minBreedingMonthsLarge: 18, maxLifetimeLitters: 5, maxLittersIn18Months: 999, maxCsections: null, csectionVetRequired: null, maxAgeYears: 7, vetCertAfterAge: 7, requiresBIN: false, notes: 'WA: max breeding age 7 years (stricter than other states). Dogs West (CAWA) membership required.', sourceUrl: 'https://www.dogswest.com', sourceName: 'CAWA H Regulations + Animal Welfare Act 2002 (WA)' },
  ACT: { stateName: 'Australian Capital Territory', minBreedingMonths: 12, minBreedingMonthsLarge: 18, maxLifetimeLitters: 5, maxLittersIn18Months: 2, maxCsections: null, csectionVetRequired: null, maxAgeYears: 8, vetCertAfterAge: 8, requiresBIN: false, notes: 'Dogs Australia rules apply via Dogs ACT.', sourceUrl: 'https://www.dogsact.org.au', sourceName: 'Dogs Australia + Animal Welfare Act 1992 (ACT)' },
  NT:  { stateName: 'Northern Territory',        minBreedingMonths: 12, minBreedingMonthsLarge: 18, maxLifetimeLitters: 5, maxLittersIn18Months: 2,   maxCsections: null, csectionVetRequired: null, maxAgeYears: 8, vetCertAfterAge: 8, requiresBIN: false, notes: 'Dogs Australia rules apply via Dogs NT.', sourceUrl: 'https://www.dogsnt.com.au', sourceName: 'Dogs Australia + Animal Welfare Act 1999 (NT)' },
  TAS: { stateName: 'Tasmania',                  minBreedingMonths: 12, minBreedingMonthsLarge: 18, maxLifetimeLitters: 5, maxLittersIn18Months: 2,   maxCsections: null, csectionVetRequired: null, maxAgeYears: 8, vetCertAfterAge: 8, requiresBIN: false, notes: 'Dogs Australia rules apply via Dogs Tasmania.', sourceUrl: 'https://www.dogstasmania.com.au', sourceName: 'Dogs Australia + Animal Welfare Act 1993 (TAS)' },
}

// Mating methods taxonomy
const MATING_METHODS = [
  { value: 'natural',           label: 'Natural mating (supervised)',   group: 'Natural' },
  { value: 'natural_unsup',     label: 'Natural mating (unsupervised)', group: 'Natural' },
  { value: 'vaginal_ai_fresh',  label: 'Vaginal AI — Fresh semen',      group: 'AI' },
  { value: 'vaginal_ai_chilled',label: 'Vaginal AI — Fresh-chilled',    group: 'AI' },
  { value: 'tci_fresh',         label: 'TCI — Fresh semen',             group: 'TCI' },
  { value: 'tci_chilled',       label: 'TCI — Fresh-chilled semen',     group: 'TCI' },
  { value: 'tci_frozen',        label: 'TCI — Frozen-thawed semen',     group: 'TCI' },
  { value: 'other',             label: 'Other',                         group: 'Other' },
]

const WHELPING_METHODS = [
  { value: 'natural',            label: 'Natural whelp' },
  { value: 'assisted',           label: 'Assisted whelp' },
  { value: 'csection_elective',  label: 'C-section (elective)' },
  { value: 'csection_emergency', label: 'C-section (emergency)' },
]

interface HeatCycle {
  id?: string
  heatNumber: number
  heatStartDate: string
  heatEndDate?: string
  // Mating
  matingDate?: string
  matingMethod?: string
  semenType?: string
  sireName?: string
  sireReg?: string
  sireId?: string
  sirePedigreeRegister?: string
  vetClinic?: string
  progesteroneTested?: boolean
  // Pregnancy
  pregnancyConfirmed?: boolean
  ultrasoundDate?: string
  whelpingEstimate?: string
  whelpingActual?: string
  whelpingMethod?: string
  // Litter outcome
  puppiesBorn?: number
  puppiesAlive?: number
  notes?: string
  createdAt?: string
}

function calcWhelpingEstimate(matingDate: string): string {
  if (!matingDate) return ''
  const d = new Date(matingDate)
  d.setDate(d.getDate() + 63)
  return d.toISOString().split('T')[0]
}

function BreedingTab({ dog, dogId, userState, onUpdate, toast }: {
  dog: Dog
  dogId: string
  userState: string
  onUpdate: (updates: Partial<Dog>) => Promise<void>
  toast: (msg: string, type?: ToastMessage['type']) => void
}) {
  const [selectedState, setSelectedState] = useState(userState)
  const [heatCycles, setHeatCycles] = useState<HeatCycle[]>([])
  const [loadingCycles, setLoadingCycles] = useState(true)
  const [showAddHeat, setShowAddHeat] = useState(false)
  const [editingCycle, setEditingCycle] = useState<HeatCycle | null>(null)
  const [saving, setSaving] = useState(false)
  const [allDogs, setAllDogs] = useState<Dog[]>([])

  // Litter record state
  const [litterCount, setLitterCount] = useState<number>((dog as any).litterCount ?? 0)
  const [last18mLitters, setLast18mLitters] = useState<number>((dog as any).last18mLitters ?? 0)
  const [cSectionCount, setCSectionCount] = useState<number>((dog as any).cSectionCount ?? 0)
  const [lastLitterDate, setLastLitterDate] = useState((dog as any).lastLitterDate || '')
  const [editingLitters, setEditingLitters] = useState(false)

  // Heat predictor state
  const [firstHeatDate, setFirstHeatDate] = useState((dog as any).firstHeatDate || '')
  const [editingHeat, setEditingHeat] = useState(false)

  const rules = STATE_RULES[selectedState] || STATE_RULES['SA']
  const breedSize = getBreedSize(dog.breed)
  const heatInterval = getHeatIntervalMonths(dog.breed)
  const firstHeatMo = getFirstHeatMonths(dog.breed)
  const dob = dog.dateOfBirth ? new Date(dog.dateOfBirth) : null
  const today = new Date()
  const ageMo = dob ? (today.getFullYear() - dob.getFullYear()) * 12 + (today.getMonth() - dob.getMonth()) : 0
  const ageYrs = ageMo / 12

  // Load heat cycles and all dogs from Firestore
  useEffect(() => {
    if (!dogId) return
    async function load() {
      try {
        const [cyclesSnap, dogsData] = await Promise.all([
          getDocs(query(collection(db, 'heatCycles'), where('dogId', '==', dogId))),
          getDocs(query(collection(db, 'dogs'), where('tenantId', '==', dog.tenantId))),
        ])
        const cycles = cyclesSnap.docs.map(d => ({ id: d.id, ...d.data() } as HeatCycle))
        cycles.sort((a, b) => a.heatNumber - b.heatNumber)
        setHeatCycles(cycles)
        setAllDogs(dogsData.docs.map(d => ({ id: d.id, ...d.data() } as Dog)))
      } catch (e) {
        console.error('Failed to load heat cycles:', e)
      } finally {
        setLoadingCycles(false)
      }
    }
    load()
  }, [dogId])

  // Predicted heats from DOB
  const predictedHeats: { n: number; date: Date; label: string }[] = []
  if (dob) {
    const anchor = firstHeatDate ? new Date(firstHeatDate) : addMonths(dob, firstHeatMo)
    for (let i = 0; i < 6; i++) {
      predictedHeats.push({
        n: i + 1,
        date: addMonths(anchor, heatInterval * i),
        label: i === 0 ? (firstHeatDate ? 'Heat 1 (actual)' : 'Heat 1 (estimated)') : `Heat ${i + 1} (estimated)`,
      })
    }
  }

  function heatCompliance(ageAtHeatMo: number) {
    const minAge = (breedSize === 'large' || breedSize === 'giant') ? rules.minBreedingMonthsLarge : rules.minBreedingMonths
    if (ageAtHeatMo < rules.minBreedingMonths) return { status: 'blocked', msg: `❌ Under ${rules.minBreedingMonths}mo`, color: 'var(--error)' }
    if (ageAtHeatMo < minAge) return { status: 'caution', msg: `⚠️ Under ${minAge}mo (${breedSize})`, color: 'var(--warning)' }
    if (ageAtHeatMo >= rules.vetCertAfterAge * 12) return { status: 'warn', msg: `⚠️ Vet cert required`, color: 'var(--warning)' }
    return { status: 'ok', msg: '✓ Eligible', color: 'var(--brand-600)' }
  }

  // Compliance summary
  const isPuppyOrWhelp = dog.lifeStage === 'whelp' || dog.lifeStage === 'puppy'
  const isUnder12 = !isPuppyOrWhelp && ageMo < rules.minBreedingMonths
  const minForBreed = (breedSize === 'large' || breedSize === 'giant') ? rules.minBreedingMonthsLarge : rules.minBreedingMonths
  const isOver = ageYrs >= rules.maxAgeYears
  const littersOk = litterCount < rules.maxLifetimeLitters
  const last18Ok = rules.maxLittersIn18Months === 999 || last18mLitters < rules.maxLittersIn18Months
  const csectionOk = rules.maxCsections === null || cSectionCount < rules.maxCsections
  const csectionVetNeeded = rules.csectionVetRequired !== null && cSectionCount >= rules.csectionVetRequired
  const isLimitedRegister = (dog as any).pedigreeRegister === 'limited'
  const isNoPedigree = ['no_pedigree', 'mixed', 'rescue'].includes((dog as any).pedigreeRegister || '')
  const overallOk = !isPuppyOrWhelp && !isUnder12 && !isOver && littersOk && last18Ok && csectionOk && !isLimitedRegister && !isNoPedigree
  const overallMsg = isPuppyOrWhelp ? `Not yet of breeding age (${dog.lifeStage === 'whelp' ? 'Whelp' : 'Puppy'})`
    : isNoPedigree ? `ℹ️ No Dogs Australia pedigree — cannot register litters with Dogs Australia`
    : isLimitedRegister ? '❌ Limited Register — not eligible to breed under Dogs Australia rules'
    : isUnder12 ? `❌ Not eligible — under ${rules.minBreedingMonths} months`
    : isOver ? `⚠️ Over ${rules.maxAgeYears} years — vet certificate required`
    : !littersOk ? `❌ Lifetime litter limit reached (${rules.maxLifetimeLitters} max)`
    : !csectionOk ? `❌ C-section limit reached (${rules.maxCsections} max)`
    : !last18Ok ? `❌ ${rules.maxLittersIn18Months} litters already in last 18 months`
    : csectionVetNeeded ? `⚠️ Vet certificate required before next C-section pregnancy`
    : ageMo < minForBreed ? `⚠️ Eligible but ${breedSize} breed — recommended wait until ${minForBreed} months`
    : '✓ Currently eligible to breed'

  async function saveLitters() {
    setSaving(true)
    try {
      await onUpdate({ litterCount, last18mLitters, lastLitterDate, cSectionCount } as any)
      setEditingLitters(false)
    } finally { setSaving(false) }
  }

  async function saveFirstHeat() {
    setSaving(true)
    try { await onUpdate({ firstHeatDate } as any); setEditingHeat(false) }
    finally { setSaving(false) }
  }

  async function saveHeatCycle(cycle: HeatCycle) {
    setSaving(true)
    try {
      const data = { ...cycle, dogId, tenantId: dog.tenantId, updatedAt: new Date().toISOString() }
      if (cycle.id) {
        await updateDoc(doc(db, 'heatCycles', cycle.id), data)
        setHeatCycles(prev => prev.map(c => c.id === cycle.id ? { ...data, id: cycle.id } : c))
      } else {
        data.createdAt = new Date().toISOString()
        const ref = await addDoc(collection(db, 'heatCycles'), data)
        setHeatCycles(prev => [...prev, { ...data, id: ref.id }].sort((a, b) => a.heatNumber - b.heatNumber))
        // Update firstHeatDate if this is heat 1
        if (cycle.heatNumber === 1 && cycle.heatStartDate && !firstHeatDate) {
          await onUpdate({ firstHeatDate: cycle.heatStartDate } as any)
          setFirstHeatDate(cycle.heatStartDate)
        }
      }
      // Auto-update litter count if whelping recorded
      if (cycle.whelpingActual && cycle.whelpingMethod) {
        const isCS = cycle.whelpingMethod?.startsWith('csection')
        const newLitterCount = heatCycles.filter(c => c.whelpingActual && c.id !== cycle.id).length + 1
        const newCS = heatCycles.filter(c => c.whelpingMethod?.startsWith('csection') && c.id !== cycle.id).length + (isCS ? 1 : 0)
        await onUpdate({ litterCount: newLitterCount, cSectionCount: newCS, lastLitterDate: cycle.whelpingActual } as any)
        setLitterCount(newLitterCount)
        setCSectionCount(newCS)
        setLastLitterDate(cycle.whelpingActual)
      }
      setEditingCycle(null)
      setShowAddHeat(false)
      toast('Heat cycle saved', 'success')
    } catch (e) {
      console.error(e)
      toast('Failed to save', 'error')
    } finally { setSaving(false) }
  }

  async function deleteHeatCycle(id: string) {
    if (!confirm('Delete this heat cycle record?')) return
    try {
      await deleteDoc(doc(db, 'heatCycles', id))
      setHeatCycles(prev => prev.filter(c => c.id !== id))
      toast('Deleted', 'success')
    } catch { toast('Failed to delete', 'error') }
  }

  const rulesTable = [
    { rule: 'Pedigree / Registration', value: (dog as any).pedigreeRegister === 'limited' ? '🟠 Limited Register — not eligible to breed' : (dog as any).pedigreeRegister === 'no_pedigree' ? 'No pedigree (purebred without papers)' : (dog as any).pedigreeRegister === 'mixed' ? 'Mixed breed' : (dog as any).pedigreeRegister === 'rescue' ? 'Rescue / unknown' : '🔵 Main Register — eligible to breed', source: 'Dogs Australia Regulations Part 6', st: isLimitedRegister ? 'fail' : isNoPedigree ? 'info' : 'ok' },
    { rule: 'Minimum breeding age',              value: `${rules.minBreedingMonths} months`,      st: isPuppyOrWhelp ? 'info' : (!isUnder12 ? 'ok' : 'fail') },
    { rule: `Recommended min age (${breedSize})`,value: `${minForBreed} months`,                 st: isPuppyOrWhelp ? 'info' : (ageMo >= minForBreed ? 'ok' : 'warn') },
    { rule: 'Max litters in 18-month period',    value: rules.maxLittersIn18Months === 999 ? 'No specific rule' : `${rules.maxLittersIn18Months} litters`, st: isPuppyOrWhelp ? 'info' : (last18Ok ? 'ok' : 'fail') },
    { rule: 'Max litters in lifetime',           value: `${rules.maxLifetimeLitters} litters`,    st: isPuppyOrWhelp ? 'info' : (littersOk ? 'ok' : 'fail') },
    ...(rules.maxCsections !== null ? [
      { rule: 'Max C-section litters',           value: `${rules.maxCsections} C-sections`,       st: isPuppyOrWhelp ? 'info' : (csectionOk ? 'ok' : 'fail') },
      { rule: 'Vet cert before C-section',       value: `After ${rules.csectionVetRequired} C-sections`, st: isPuppyOrWhelp ? 'info' : (!csectionVetNeeded ? 'ok' : 'warn') },
    ] : [{ rule: 'C-section limit', value: 'No specific state rule', st: 'info' }]),
    { rule: 'Maximum breeding age',              value: `${rules.maxAgeYears} years`,              st: isPuppyOrWhelp ? 'info' : (!isOver ? 'ok' : 'warn') },
    { rule: 'Minimum puppy sale age',            value: '8 weeks',                                st: 'info' },
    { rule: 'Skip first heat',                   value: 'Do not breed on first heat',             st: 'info' },
    ...(rules.requiresBIN ? [{ rule: 'Breeder ID Number (BIN)', value: 'Mandatory (NSW)', st: 'info' }] : []),
  ]

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>Breeding Compliance</h2>
          <span className="badge badge-green">Dogs Australia / State Law</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--light)' }}>Rules for:</span>
          <select className="form-select" value={selectedState} onChange={e => setSelectedState(e.target.value)} style={{ height: 34, fontSize: 13, paddingRight: 32, minWidth: 180 }}>
            {Object.entries(STATE_RULES).map(([code, r]) => <option key={code} value={code}>{r.stateName}</option>)}
          </select>
        </div>
      </div>

      {/* Source note */}
      <div style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 16, padding: '8px 12px', background: 'var(--sand)', borderRadius: 8 }}>
        📋 <a href={rules.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand-600)' }}>{rules.sourceName}</a>
        {selectedState !== userState && <span style={{ marginLeft: 8, color: 'var(--warning)', fontWeight: 500 }}>⚠️ Profile state: {STATE_RULES[userState]?.stateName}</span>}
      </div>

      {/* Overall status */}
      {isNoPedigree ? (
        <div style={{ padding: '16px 20px', borderRadius: 12, marginBottom: 20, background: 'var(--sand)', border: '1.5px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, marginBottom: 8, color: 'var(--mid)' }}>
            ℹ️ {(dog as any).pedigreeRegister === 'mixed' ? 'Mixed breed' : (dog as any).pedigreeRegister === 'rescue' ? 'Rescue / unknown background' : 'No pedigree (purebred without papers)'}
          </div>
          <p style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.6, marginBottom: 8 }}>
            This dog does not have Dogs Australia pedigree papers. Litters cannot be registered with Dogs Australia, and offspring will not be eligible for Main Register pedigree certificates.
          </p>
          <p style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.6 }}>
            iDogs still tracks <strong>health records, vaccines, worming, reminders and documents</strong> for this dog. Use the Heat Cycle Records below to record mating and whelping history.
          </p>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--light)' }}>
            To obtain Dogs Australia pedigree papers, contact your state body:
            {' '}<a href={rules.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand-600)' }}>{rules.sourceName}</a>
          </div>
        </div>
      ) : (
      <div style={{
        padding: '16px 20px', borderRadius: 12, marginBottom: 20,
        background: isPuppyOrWhelp ? 'var(--sand)' : (overallOk ? 'var(--brand-50)' : isUnder12 || !littersOk || !csectionOk || !last18Ok ? '#FDEDED' : '#FBF3E4'),
        border: `1.5px solid ${isPuppyOrWhelp ? 'var(--border)' : (overallOk ? 'var(--brand-300)' : isUnder12 || !littersOk || !csectionOk || !last18Ok ? '#F3B0B0' : '#EBD9A8')}`,
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, marginBottom: 10, color: isPuppyOrWhelp ? 'var(--mid)' : (overallOk ? 'var(--brand-600)' : !littersOk || !csectionOk || !last18Ok || isUnder12 ? 'var(--error)' : 'var(--warning)') }}>
          {overallMsg}
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {[
            { l: 'Register', v: (dog as any).pedigreeRegister === 'limited' ? '🟠 Limited' : (dog as any).pedigreeRegister === 'none' ? 'None' : '🔵 Main', ok: !isLimitedRegister },
            { l: 'Age', v: `${Math.floor(ageMo / 12)}yr ${ageMo % 12}mo`, ok: isPuppyOrWhelp ? true : (!isUnder12 && !isOver) },
            { l: 'Breed size', v: breedSize.charAt(0).toUpperCase() + breedSize.slice(1), ok: true },
            { l: 'Total litters', v: `${litterCount} / ${rules.maxLifetimeLitters}`, ok: isPuppyOrWhelp ? true : littersOk },
            ...(rules.maxLittersIn18Months !== 999 ? [{ l: 'Last 18 months', v: `${last18mLitters} / ${rules.maxLittersIn18Months}`, ok: isPuppyOrWhelp ? true : last18Ok }] : []),
            ...(rules.maxCsections !== null ? [{ l: 'C-sections', v: `${cSectionCount} / ${rules.maxCsections}`, ok: isPuppyOrWhelp ? true : csectionOk }] : []),
          ].map(x => (
            <div key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 12, color: 'var(--light)' }}>{x.l}:</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: x.ok ? 'var(--dark)' : 'var(--error)' }}>{x.v}</span>
            </div>
          ))}
        </div>
        {rules.notes && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--mid)', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 8 }}>ℹ️ {rules.notes}</div>}
      </div>
      )}

      {/* Rules table — only for pedigree dogs */}
      {!isNoPedigree && (
      <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 500, color: 'var(--mid)', display: 'flex', justifyContent: 'space-between' }}>
          <span>{rules.stateName} Breeding Rules</span>
          <a href={rules.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--brand-600)', textDecoration: 'none' }}>Source ↗</a>
        </div>
        {rulesTable.map((row, i, arr) => (
          <div key={row.rule} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--dark)' }}>{row.rule}</div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--dark)', marginBottom: 3 }}>{row.value}</div>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: row.st === 'ok' ? 'var(--brand-50)' : row.st === 'fail' ? '#FDEDED' : row.st === 'warn' ? '#FBF3E4' : 'var(--sand)', color: row.st === 'ok' ? 'var(--brand-600)' : row.st === 'fail' ? 'var(--error)' : row.st === 'warn' ? 'var(--warning)' : 'var(--mid)' }}>
                {row.st === 'ok' ? '✓ Compliant' : row.st === 'fail' ? '✕ Non-compliant' : row.st === 'warn' ? '⚠ Review' : (isPuppyOrWhelp && (row.rule.toLowerCase().includes('age') || row.rule.toLowerCase().includes('litter') || row.rule.toLowerCase().includes('c-section') || row.rule.toLowerCase().includes('breeding')) ? 'Not breeding age' : 'ℹ Info')}
              </span>
            </div>
          </div>
        ))}
      </div>
      )} {/* end !isNoPedigree rules table */}

      {/* Litter & C-section record */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--mid)' }}>Litter & Birth Record</div>
          <button onClick={() => setEditingLitters(!editingLitters)} className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>{editingLitters ? 'Cancel' : '✎ Edit'}</button>
        </div>
        {editingLitters ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Total litters (lifetime)</label>
                <input className="form-input" type="number" min={0} max={10} value={litterCount} onChange={e => setLitterCount(parseInt(e.target.value) || 0)} />
                <span className="form-hint">Max {rules.maxLifetimeLitters} under {selectedState}</span>
              </div>
              {rules.maxLittersIn18Months !== 999 && (
                <div className="form-group">
                  <label className="form-label">Litters in last 18 months</label>
                  <input className="form-input" type="number" min={0} max={5} value={last18mLitters} onChange={e => setLast18mLitters(parseInt(e.target.value) || 0)} />
                  <span className="form-hint">Max {rules.maxLittersIn18Months}</span>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">C-section litters</label>
                <input className="form-input" type="number" min={0} max={10} value={cSectionCount} onChange={e => setCSectionCount(parseInt(e.target.value) || 0)} />
                <span className="form-hint">{rules.maxCsections !== null ? `Max ${rules.maxCsections} under ${selectedState}` : 'No state limit'}</span>
              </div>
              <div className="form-group">
                <label className="form-label">Last litter date</label>
                <input className="form-input" type="date" value={lastLitterDate} onChange={e => setLastLitterDate(e.target.value)} max={today.toISOString().split('T')[0]} />
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={saveLitters} disabled={saving}>{saving ? <span className="spinner" /> : 'Save'}</button>
          </div>
        ) : (
          <div>
            {[
              { l: 'Total litters', v: `${litterCount} / ${rules.maxLifetimeLitters}`, ok: littersOk },
              ...(rules.maxLittersIn18Months !== 999 ? [{ l: 'Last 18 months', v: `${last18mLitters} / ${rules.maxLittersIn18Months}`, ok: last18Ok }] : []),
              { l: 'C-section litters', v: rules.maxCsections !== null ? `${cSectionCount} / ${rules.maxCsections}` : `${cSectionCount} (no state limit)`, ok: csectionOk },
              { l: 'Last litter date', v: lastLitterDate ? fmtDate(new Date(lastLitterDate)) : '—', ok: true },
              { l: 'Next eligible', v: !littersOk ? `Limit reached` : !csectionOk ? `C-section limit reached` : !last18Ok && lastLitterDate ? `After ${fmtDate(addMonths(new Date(lastLitterDate), 18))}` : '✓ No restriction', ok: littersOk && csectionOk && last18Ok },
            ].map((row, i, arr) => (
              <div key={row.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 13 }}>
                <span style={{ color: 'var(--light)' }}>{row.l}</span>
                <span style={{ fontWeight: 500, color: row.ok ? 'var(--dark)' : 'var(--error)' }}>{row.v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── HEAT CYCLE RECORDS ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--mid)' }}>🌸 Heat Cycle Records</div>
          <button onClick={() => { setEditingCycle({ heatNumber: heatCycles.length + 1, heatStartDate: '' }); setShowAddHeat(true) }} className="btn btn-primary btn-sm">
            + Add Heat Cycle
          </button>
        </div>

        {loadingCycles ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><div className="spinner" /></div>
        ) : heatCycles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 13, color: 'var(--light)' }}>
            No heat cycles recorded yet. Add the first heat cycle to track mating, whelping and litter history.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {heatCycles.map(cycle => {
              const ageAtHeat = dob && cycle.heatStartDate ? (new Date(cycle.heatStartDate).getFullYear() - dob.getFullYear()) * 12 + (new Date(cycle.heatStartDate).getMonth() - dob.getMonth()) : 0
              const comp = dob && cycle.heatStartDate ? heatCompliance(ageAtHeat) : null
              return (
                <div key={cycle.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  {/* Heat header */}
                  <div style={{ padding: '10px 14px', background: 'var(--sand)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--dark)' }}>Heat {cycle.heatNumber}</span>
                      {cycle.heatStartDate && <span style={{ fontSize: 12, color: 'var(--mid)' }}>{fmtDate(new Date(cycle.heatStartDate))}</span>}
                      {comp && <span style={{ fontSize: 11, fontWeight: 600, color: comp.color }}>{comp.msg}</span>}
                      {cycle.whelpingActual && <span className="badge badge-green" style={{ fontSize: 10 }}>✓ Whelped {fmtDate(new Date(cycle.whelpingActual))}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => { setEditingCycle(cycle); setShowAddHeat(true) }} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>✎ Edit</button>
                      <button onClick={() => cycle.id && deleteHeatCycle(cycle.id)} className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--error)' }}>✕</button>
                    </div>
                  </div>
                  {/* Heat details */}
                  <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                    {[
                      { l: 'Mating date', v: cycle.matingDate ? fmtDate(new Date(cycle.matingDate)) : '—' },
                      { l: 'Mating method', v: cycle.matingMethod ? MATING_METHODS.find(m => m.value === cycle.matingMethod)?.label || cycle.matingMethod : '—' },
                      { l: 'Sire', v: cycle.sireName || '—' },
                      { l: 'Whelping estimate', v: cycle.whelpingEstimate ? fmtDate(new Date(cycle.whelpingEstimate)) : '—' },
                      { l: 'Whelping actual', v: cycle.whelpingActual ? fmtDate(new Date(cycle.whelpingActual)) : '—' },
                      { l: 'Whelping method', v: cycle.whelpingMethod ? WHELPING_METHODS.find(m => m.value === cycle.whelpingMethod)?.label || cycle.whelpingMethod : '—' },
                      { l: 'Puppies born', v: cycle.puppiesBorn !== undefined ? `${cycle.puppiesBorn} (${cycle.puppiesAlive ?? '?'} alive)` : '—' },
                    ].map(row => (
                      <div key={row.l}>
                        <div style={{ fontSize: 11, color: 'var(--light)', marginBottom: 1 }}>{row.l}</div>
                        <div style={{ fontSize: 13, color: 'var(--dark)', fontWeight: 500 }}>{row.v}</div>
                      </div>
                    ))}
                  </div>
                  {cycle.notes && <div style={{ padding: '0 14px 10px', fontSize: 12, color: 'var(--mid)', fontStyle: 'italic' }}>📝 {cycle.notes}</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Heat Cycle Predictor */}
      {dob && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--mid)' }}>Heat Cycle Predictor (estimate only)</div>
            <button onClick={() => setEditingHeat(!editingHeat)} className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>
              {editingHeat ? 'Cancel' : firstHeatDate ? '✎ Edit anchor date' : '+ Add first heat date'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--light)', marginBottom: 14 }}>
            {firstHeatDate ? 'Anchored to actual first heat' : 'Estimated from DOB'} · {breedSize} breed · ~{heatInterval}-month cycle
          </div>
          {editingHeat && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14, padding: '12px', background: 'var(--sand)', borderRadius: 8 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Date of first heat</label>
                <input className="form-input" type="date" value={firstHeatDate} onChange={e => setFirstHeatDate(e.target.value)} max={today.toISOString().split('T')[0]} />
              </div>
              <button className="btn btn-primary btn-sm" onClick={saveFirstHeat} disabled={saving} style={{ marginBottom: 1 }}>{saving ? <span className="spinner" /> : 'Save'}</button>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {predictedHeats.map((heat, i) => {
              const isPast = heat.date < today
              const isSoon = !isPast && heat.date < addMonths(today, 2)
              const ageAtHeatMo = dob ? (heat.date.getFullYear() - dob.getFullYear()) * 12 + (heat.date.getMonth() - dob.getMonth()) : 0
              const c = heatCompliance(ageAtHeatMo)
              const recorded = heatCycles.find(h => h.heatNumber === heat.n)
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, background: isSoon ? '#FBF3E4' : isPast ? 'var(--sand)' : 'var(--white)', border: `1px solid ${isSoon ? '#EBD9A8' : 'var(--border)'}`, opacity: isPast ? 0.65 : 1 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: c.status === 'ok' ? 'var(--brand-50)' : c.status === 'blocked' ? '#FDEDED' : '#FBF3E4', color: c.status === 'ok' ? 'var(--brand-600)' : c.status === 'blocked' ? 'var(--error)' : 'var(--warning)' }}>{heat.n}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--dark)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {heat.label}
                      {isSoon && <span style={{ fontSize: 10, background: 'var(--warning)', color: '#fff', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>Upcoming</span>}
                      {recorded && <span style={{ fontSize: 10, background: 'var(--brand-600)', color: '#fff', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>✓ Recorded</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--light)' }}>{fmtDate(heat.date)} · Age: {ageAtDate(dog.dateOfBirth, heat.date)}</div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: c.color, textAlign: 'right', maxWidth: 180 }}>{c.msg}</div>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--sand)', borderRadius: 8, fontSize: 12, color: 'var(--mid)' }}>
            💡 Use "Add Heat Cycle" above to record actual dates. The predictor will auto-anchor to recorded heat 1 date.
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div style={{ fontSize: 12, color: 'var(--light)', lineHeight: 1.7, padding: '12px 16px', background: 'var(--sand)', borderRadius: 8 }}>
        ⚠️ <strong>Disclaimer:</strong> Based on state legislation and Dogs Australia regulations as at June 2026. Always verify with your state canine body before breeding. Heat predictions are estimates only.
      </div>

      {/* Add/Edit Heat Cycle Modal */}
      {showAddHeat && editingCycle && (
        <HeatCycleModal
          cycle={editingCycle}
          allDogs={allDogs}
          onClose={() => { setShowAddHeat(false); setEditingCycle(null) }}
          onSave={saveHeatCycle}
          saving={saving}
        />
      )}
    </div>
  )
}

// ── HEAT CYCLE MODAL ─────────────────────────────────────────

function HeatCycleModal({ cycle, allDogs, onClose, onSave, saving }: {
  cycle: HeatCycle
  allDogs: Dog[]
  onClose: () => void
  onSave: (c: HeatCycle) => Promise<void>
  saving: boolean
}) {
  const [form, setForm] = useState<HeatCycle>({ ...cycle })
  const [sireMode, setSireMode] = useState<'list' | 'manual'>(cycle.sireName ? 'manual' : 'list')

  // Male dogs in the system (exclude current dog)
  const maleDogs = allDogs.filter(d => d.sex === 'male' && (d as any).status !== 'transferred')

  function set(field: keyof HeatCycle, value: any) {
    setForm(prev => {
      const next = { ...prev, [field]: value }
      if (field === 'matingDate' && value) {
        next.whelpingEstimate = calcWhelpingEstimate(value)
      }
      return next
    })
  }

  function selectSireFromList(dogId: string) {
    const d = allDogs.find(x => x.id === dogId)
    if (!d) return
    set('sireName', d.name)
    set('sireReg', (d as any).ankc || '')
    set('sireId', dogId)
    set('sirePedigreeRegister', (d as any).pedigreeRegister || 'main')
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 580, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}>
            {cycle.id ? `Edit Heat ${cycle.heatNumber}` : `Add Heat Cycle`}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--light)' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* HEAT */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-600)', marginBottom: 10 }}>🌸 Heat</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Heat number</label>
                <input className="form-input" type="number" min={1} value={form.heatNumber} onChange={e => set('heatNumber', parseInt(e.target.value) || 1)} />
              </div>
              <div />
              <div className="form-group">
                <label className="form-label">Heat start date *</label>
                <input className="form-input" type="date" value={form.heatStartDate} onChange={e => set('heatStartDate', e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Heat end date</label>
                <input className="form-input" type="date" value={form.heatEndDate || ''} onChange={e => set('heatEndDate', e.target.value)} />
              </div>
            </div>
          </section>

          {/* MATING */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-600)', marginBottom: 10 }}>🐕 Mating</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Mating date</label>
                <input className="form-input" type="date" value={form.matingDate || ''} onChange={e => set('matingDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Mating method</label>
                <select className="form-select" value={form.matingMethod || ''} onChange={e => set('matingMethod', e.target.value)}>
                  <option value="">Select…</option>
                  {['Natural', 'AI', 'TCI', 'Other'].map(group => (
                    <optgroup key={group} label={group}>
                      {MATING_METHODS.filter(m => m.group === group).map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              {/* Sire selector */}
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Sire</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => setSireMode('list')}
                    style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, border: `1.5px solid ${sireMode === 'list' ? 'var(--brand-600)' : 'var(--border)'}`, background: sireMode === 'list' ? 'var(--brand-50)' : 'var(--white)', color: sireMode === 'list' ? 'var(--brand-600)' : 'var(--mid)', cursor: 'pointer' }}
                  >From my dogs</button>
                  <button
                    type="button"
                    onClick={() => setSireMode('manual')}
                    style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, border: `1.5px solid ${sireMode === 'manual' ? 'var(--brand-600)' : 'var(--border)'}`, background: sireMode === 'manual' ? 'var(--brand-50)' : 'var(--white)', color: sireMode === 'manual' ? 'var(--brand-600)' : 'var(--mid)', cursor: 'pointer' }}
                  >Enter manually</button>
                </div>
                {sireMode === 'list' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <select
                        className="form-select"
                        onChange={e => selectSireFromList(e.target.value)}
                        defaultValue=""
                      >
                        <option value="">Select sire from my dogs…</option>
                        {maleDogs.length === 0
                          ? <option disabled>No male dogs in your account</option>
                          : maleDogs.map(d => (
                            <option key={d.id} value={d.id}>
                              {d.name} — {d.breed} {(d as any).pedigreeRegister === 'limited' ? '⚠️ Limited Reg' : ''} {(d as any).ankc ? `(${(d as any).ankc})` : ''}
                            </option>
                          ))
                        }
                      </select>
                      {(form as any).sirePedigreeRegister === 'limited' && (
                        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--error)', background: '#FDEDED', border: '1px solid #F3B0B0', borderRadius: 6, padding: '6px 10px' }}>
                          ⚠️ <strong>Limited Register sire</strong> — progeny cannot be registered on the Main Register under Dogs Australia rules.
                        </div>
                      )}
                      <span className="form-hint">Or switch to "Enter manually" for external sires</span>
                    </div>
                    <div>
                      {form.sireName && (
                        <div style={{ padding: '8px 12px', background: 'var(--brand-50)', borderRadius: 8, fontSize: 13 }}>
                          <div style={{ fontWeight: 600, color: 'var(--brand-600)' }}>{form.sireName}</div>
                          {form.sireReg && <div style={{ color: 'var(--mid)', fontSize: 12 }}>Reg: {form.sireReg}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-group">
                      <label className="form-label">Sire name</label>
                      <input className="form-input" placeholder="e.g. CH STARRUN GOLD" value={form.sireName || ''} onChange={e => set('sireName', e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Sire registration</label>
                      <input className="form-input" placeholder="e.g. 5100012345" value={form.sireReg || ''} onChange={e => set('sireReg', e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Vet / clinic (if AI/TCI)</label>
                <input className="form-input" placeholder="e.g. Adelaide Vet Reproduction" value={form.vetClinic || ''} onChange={e => set('vetClinic', e.target.value)} />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 22 }}>
                <input type="checkbox" id="progesterone" checked={form.progesteroneTested || false} onChange={e => set('progesteroneTested', e.target.checked)} style={{ width: 16, height: 16 }} />
                <label htmlFor="progesterone" style={{ fontSize: 13, color: 'var(--dark)', cursor: 'pointer' }}>Progesterone test done</label>
              </div>
            </div>
          </section>

          {/* PREGNANCY */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-600)', marginBottom: 10 }}>🤰 Pregnancy</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
                <input type="checkbox" id="pregnant" checked={form.pregnancyConfirmed || false} onChange={e => set('pregnancyConfirmed', e.target.checked)} style={{ width: 16, height: 16 }} />
                <label htmlFor="pregnant" style={{ fontSize: 13, color: 'var(--dark)', cursor: 'pointer' }}>Pregnancy confirmed (ultrasound)</label>
              </div>
              <div className="form-group">
                <label className="form-label">Ultrasound date</label>
                <input className="form-input" type="date" value={form.ultrasoundDate || ''} onChange={e => set('ultrasoundDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Whelping estimate (auto)</label>
                <input className="form-input" type="date" value={form.whelpingEstimate || ''} onChange={e => set('whelpingEstimate', e.target.value)} style={{ background: 'var(--sand)' }} />
                <span className="form-hint">Auto-calculated: mating date + 63 days</span>
              </div>
              <div />
            </div>
          </section>

          {/* WHELPING */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brand-600)', marginBottom: 10 }}>🐣 Whelping</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Actual whelping date</label>
                <input className="form-input" type="date" value={form.whelpingActual || ''} onChange={e => set('whelpingActual', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Whelping method</label>
                <select className="form-select" value={form.whelpingMethod || ''} onChange={e => set('whelpingMethod', e.target.value)}>
                  <option value="">Select…</option>
                  {WHELPING_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Puppies born</label>
                <input className="form-input" type="number" min={0} max={20} value={form.puppiesBorn ?? ''} onChange={e => set('puppiesBorn', parseInt(e.target.value) || 0)} />
              </div>
              <div className="form-group">
                <label className="form-label">Puppies alive</label>
                <input className="form-input" type="number" min={0} max={20} value={form.puppiesAlive ?? ''} onChange={e => set('puppiesAlive', parseInt(e.target.value) || 0)} />
              </div>
            </div>
          </section>

          {/* NOTES */}
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" placeholder="e.g. Good pregnancy, no complications" value={form.notes || ''} onChange={e => set('notes', e.target.value)} style={{ minHeight: 72 }} />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button onClick={onClose} className="btn btn-secondary" disabled={saving}>Cancel</button>
            <button onClick={() => onSave(form)} className="btn btn-primary" disabled={!form.heatStartDate || saving}>
              {saving ? <span className="spinner" /> : cycle.id ? 'Save changes' : 'Add heat cycle'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
