import { useState, useEffect, useRef, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { createDog, addVaccineRecord, addHealthTest, getDogs } from '../lib/db'
import { AU_TOP_BREEDS, BREEDER_ID_CONFIG, suggestBreederIdType, parseDobStrict } from '../lib/utils'
import type { DogFormData, ToastMessage } from '../types'
import AIScan from '../components/ui/AIScan'
import { useAuth } from '../hooks/useAuth'
import { useRequestGuard } from '../hooks/useRequestGuard'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

type Step = 'scan' | 'form'

const FREE_DOG_LIMIT = 2
const FREE_PLANS = ['free', 'trial']

export default function DogNewPage({ toast }: Props) {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const isOwner = profile?.role === 'owner'
  const [step, setStep] = useState<Step>('scan')
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState(false)
  // Codex round 14: a failed subscription-limit check must never be
  // treated as "under the limit" — that would let a free-plan account
  // create unlimited dogs whenever the getDogs() call happens to fail.
  const [limitCheckError, setLimitCheckError] = useState(false)
  const [activeDogCount, setActiveDogCount] = useState(0)
  const [scannedDocs, setScannedDocs] = useState<any[]>([])
  const [pendingFiles, setPendingFiles] = useState<Array<{ base64: string; mediaType: string; documentType: string }>>([])
  const [duplicateWarning, setDuplicateWarning] = useState<{ matchedBy: 'microchip' | 'name'; existingDogName: string } | null>(null)

  // Codex round 15: single-flight submission lock. A React state boolean
  // ALONE isn't a reliable guard here — two rapid clicks/Enter-key
  // presses (or a click racing a duplicate-key Enter submit) can both
  // fire their event handlers before React re-renders with the disabled
  // button, since state updates aren't applied synchronously mid-event.
  // submittingRef is checked and set SYNCHRONOUSLY as the very first line
  // of every entry point that leads to createDog() — handleSubmit() and
  // the "Add anyway" button — before any await, including the duplicate
  // check's own getDogs() call. `submitting` (state) exists only to drive
  // the UI (disabled buttons, spinner); the ref is what actually prevents
  // a second createDog() call. proceedWithCreate() is the single place
  // that calls createDog() and is the only place that releases the lock
  // on a terminal outcome — every other exit path (validation error,
  // duplicate-check load failure, showing the duplicate warning) releases
  // it explicitly before returning.
  //
  // Codex round 17: acquire/release are now TOKEN-specific. acquireSubmitLock()
  // must stay the absolute FIRST gate — before beginRequest() — because
  // beginRequest() bumps a shared monotonic generation counter (see
  // useRequestGuard): if a second, ultimately-rejected concurrent call
  // were allowed to call beginRequest() before losing the lock race, it
  // would invalidate the FIRST (legitimately proceeding) call's token as
  // a side effect, even though the first call is the one actually
  // running. So acquireSubmitLock() hands back its OWN, separate
  // lock-ownership token (a fresh Symbol) — independent of
  // beginRequest()'s staleness token — and only the winner goes on to
  // call beginRequest(). releaseSubmitLock() only actually releases if
  // the token passed in still owns the lock. Under the current control
  // flow this is defense-in-depth (only the operation that successfully
  // acquired the lock ever reaches a release call site for it, since a
  // second concurrent attempt fails acquireSubmitLock() immediately and
  // never reaches its own release), but it directly prevents a class of
  // bug where a stale operation's cleanup (e.g. a finally block running
  // after the account already switched) could otherwise release a lock a
  // newer operation now legitimately holds.
  const submittingRef = useRef(false)
  const lockOwnerTokenRef = useRef<symbol | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function acquireSubmitLock(): symbol | null {
    if (submittingRef.current) return null
    const token = Symbol('dog-new-submit-lock')
    submittingRef.current = true
    lockOwnerTokenRef.current = token
    setSubmitting(true)
    return token
  }
  function releaseSubmitLock(token: symbol) {
    if (lockOwnerTokenRef.current !== token) return
    submittingRef.current = false
    lockOwnerTokenRef.current = null
    setSubmitting(false)
  }

  // Codex round 16: binds every create/submit path to the UID that
  // INITIATED it, not whatever UID happens to be current when each await
  // resolves. Combined with submittingRef above: acquireSubmitLock() is
  // the single-flight gate (prevents a second concurrent attempt),
  // beginRequest() is the identity gate (detects whether the account
  // changed mid-operation). This page is also rendered behind
  // `<Outlet key={user?.uid}/>` (see AppLayout.tsx), so a genuine account
  // switch actually unmounts this whole instance and mounts a fresh one
  // for the new account — but that doesn't retroactively cancel an
  // ALREADY-IN-FLIGHT promise chain from the old instance, so every await
  // below still explicitly re-checks isCurrent() before proceeding to the
  // next step — not just before createDog(), but after every subsequent
  // await too (each file upload, each vaccine/health write, and again
  // immediately before the final toast/navigate).
  const { beginRequest } = useRequestGuard(user?.uid)

  // Codex round 17: survives across a retry of the SAME component
  // instance — if createDog() already succeeded in an earlier attempt
  // (the dog and its passport were created) but a LATER step (uploads,
  // vaccine/health writes) failed, a resubmit must resume by reusing this
  // dogId rather than calling createDog() again, which would create a
  // second, duplicate Dog/Passport for the same submission.
  const createdDogIdRef = useRef<string | null>(null)

  const [form, setForm] = useState<DogFormData>({
    name: '', breed: '', sex: 'female',
    dateOfBirth: '', colour: '', microchip: '', ankc: '', notes: '', pedigreeRegister: 'main',
    breederIdType: 'NONE', breederIdValue: '',
  })

  // Check free tier limit on mount. This is a safety/precondition check —
  // Codex round 14 requires it fail CLOSED: if we can't confirm the
  // account is under its plan limit, we must not let dog creation proceed.
  // Codex round 16: bound to the UID that initiated the check — if the
  // account switches while this is in flight, the result is discarded
  // (isCurrent() false) rather than applied to whatever account happens
  // to be signed in when it resolves. No authenticated UID at all blocks
  // creation outright, same as a failed check.
  function checkLimit() {
    if (!user) {
      setLimitCheckError(true)
      setLoading(false)
      return
    }
    const req = beginRequest()
    setLoading(true)
    setLimitCheckError(false)
    getDogs().then(dogs => {
      if (!req.isCurrent()) return
      const active = dogs.filter((d: any) => d.status !== 'transferred')
      setActiveDogCount(active.length)
      const isFreePlan = FREE_PLANS.includes(profile?.plan ?? 'free')
      setBlocked(isFreePlan && active.length >= FREE_DOG_LIMIT)
    }).catch(() => {
      if (req.isCurrent()) setLimitCheckError(true)
    }).finally(() => {
      if (req.isCurrent()) setLoading(false)
    })
  }

  useEffect(() => {
    checkLimit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  // Auto-suggest a sensible default Breeder ID type based on the
  // breeder's registered state (profile.state), once the profile has
  // loaded. Only applies while the field is still untouched (NONE +
  // empty value) so it never overwrites something the user already
  // started filling in or a value pulled in from a scan.
  useEffect(() => {
    if (!profile?.state) return
    setForm(prev => (prev.breederIdType === 'NONE' && !prev.breederIdValue)
      ? { ...prev, breederIdType: suggestBreederIdType(profile.state) }
      : prev)
  }, [profile?.state])

  function set(field: keyof DogFormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function matchBreed(scannedBreed: string): string {
    const normalized = scannedBreed.trim().toLowerCase()
    const exact = AU_TOP_BREEDS.find(b => b.toLowerCase() === normalized)
    if (exact) return exact
    // Try partial match (e.g. scanned "Labrador" matches "Labrador Retriever")
    const partial = AU_TOP_BREEDS.find(b => b.toLowerCase().includes(normalized) || normalized.includes(b.toLowerCase()))
    if (partial) return partial
    // Not in our fixed list — still keep the scanned value rather than
    // discarding real data from the document. The breed <select> falls
    // back to a free-text-like value; user can correct it in the form.
    return scannedBreed.trim()
  }

  function handleScanResult(result: any, _fileUrl?: string, rawFile?: { base64: string; mediaType: string; documentType: string }) {
    setScannedDocs(prev => [...prev, result])
    if (rawFile) setPendingFiles(prev => [...prev, rawFile])
    setForm(prev => ({
      ...prev,
      name: result.dogName || prev.name,
      breed: result.breed ? matchBreed(result.breed) : prev.breed,
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
    // No authenticated UID at all — block creation outright rather than
    // attempting a create that has no valid session to attribute it to.
    if (!user?.uid) {
      toast('Your session has changed — please sign in again', 'error')
      return
    }
    // Synchronous, first line, before any await (including the duplicate
    // check's own getDogs() call below) and BEFORE beginRequest() — see
    // the lock comment above for why the ordering matters.
    const lockToken = acquireSubmitLock()
    if (!lockToken) return
    // Captures the initiating UID via useRequestGuard — every await below
    // re-checks req.isCurrent() before proceeding to the next step.
    const req = beginRequest()
    if (!form.name || !form.breed || !form.dateOfBirth) {
      toast('Please fill in name, breed and date of birth', 'error')
      releaseSubmitLock(lockToken)
      return
    }
    if (!parseDobStrict(form.dateOfBirth)) {
      toast('Date of birth is not a valid past date', 'error')
      releaseSubmitLock(lockToken)
      return
    }

    // Check for a likely duplicate before creating — same microchip is a
    // strong signal (microchips are physically unique to one dog), same
    // name is a weaker signal but still worth a heads-up. This warns
    // rather than blocks, since two unrelated dogs can coincidentally
    // share a name, and the breeder may have a legitimate reason to
    // re-enter a dog (e.g. correcting a mistaken delete).
    try {
      const existingDogs = await getDogs()
      if (!req.isCurrent()) {
        // Codex round 16: the account changed while this duplicate check
        // was in flight. A stale operation must release its OWN lock —
        // never leave it held for whatever comes next — and must not act
        // on a duplicate-check result computed against a different
        // account's dogs. This page remounts fresh for the new account
        // (see the Outlet key in AppLayout.tsx), so that fresh instance
        // will run its own, correctly-scoped check if the user submits
        // again there.
        releaseSubmitLock(lockToken)
        return
      }
      const active = existingDogs.filter((d: any) => d.status !== 'transferred')
      const microchipMatch = form.microchip && active.find((d: any) => d.microchip && d.microchip === form.microchip)
      const nameMatch = !microchipMatch && active.find((d: any) => d.name.trim().toLowerCase() === form.name.trim().toLowerCase())
      if (microchipMatch) {
        // Pausing for the user's modal decision — release the lock so
        // either "Add anyway" or a fresh Submit click can acquire it
        // again; each acquires its own lock (and its own beginRequest())
        // at its own entry point.
        setDuplicateWarning({ matchedBy: 'microchip', existingDogName: microchipMatch.name })
        releaseSubmitLock(lockToken)
        return
      }
      if (nameMatch) {
        setDuplicateWarning({ matchedBy: 'name', existingDogName: nameMatch.name })
        releaseSubmitLock(lockToken)
        return
      }
    } catch {
      // Codex round 14: the duplicate check is a safety precondition —
      // if we can't confirm this isn't a duplicate, we must not create
      // the dog. Fail closed and let the user retry the submit.
      toast('Could not check for duplicate dogs — please try again', 'error')
      releaseSubmitLock(lockToken)
      return
    }

    // Lock stays held — proceedWithCreate() is called synchronously from
    // here with no intervening await, so there's no window for a second
    // click to slip in; proceedWithCreate() releases it on every exit.
    await proceedWithCreate(req, lockToken)
  }

  // Codex round 15: assumes the submit lock is ALREADY held by whichever
  // entry point called this (handleSubmit's no-duplicate path, or the
  // "Add anyway" button below) — this is the one function that actually
  // calls createDog(), and the one place responsible for releasing the
  // lock on every terminal outcome (success or failure), guaranteeing at
  // most one successful create per acquired lock.
  //
  // Codex round 16: `req` is the caller's beginRequest() token, captured
  // at the SAME synchronous moment the lock was acquired. Re-checked
  // immediately before createDog() — the actual attribution of the new
  // dog to a tenant is separately hardened at the source in
  // src/lib/db.ts's createDog() (captures its own uid once, before its
  // internal passport-reservation transaction), so this check's job is
  // specifically to avoid running any FOLLOW-UP action (uploads, vaccine/
  // health records, navigation) under a session that's no longer the one
  // that initiated the create.
  //
  // Codex round 17: re-checks req.isCurrent() after EVERY await, not just
  // before createDog() — each file upload, each vaccine/health write, and
  // once more immediately before the terminal toast/navigate. An account
  // switch/logout partway through stops all remaining writes rather than
  // racing them to completion under a session that's no longer active.
  // createdDogIdRef makes retrying safe: if createDog() already succeeded
  // in an earlier attempt but a later step failed, this resumes from the
  // existing dogId instead of creating a second, duplicate Dog/Passport.
  // Every previously-silent `.catch(() => {})` is now an explicit,
  // counted failure, surfaced honestly in the final toast instead of
  // disappearing — a partial failure is never reported as either total
  // success or total failure.
  async function proceedWithCreate(req: ReturnType<typeof beginRequest>, lockToken: symbol) {
    setLoading(true)
    try {
      if (!req.isCurrent()) return

      let dogId = createdDogIdRef.current
      if (!dogId) {
        dogId = await createDog({
          ...form,
          breederIdValue: form.breederIdType === 'NONE' ? '' : form.breederIdValue,
        }, isOwner ? 'OWNER_CREATED' : 'BREEDER_ISSUED')
        createdDogIdRef.current = dogId
        if (!req.isCurrent()) {
          // The dog was already correctly created under the INITIATING
          // account (db.ts captures its own uid before its transaction,
          // so attribution is correct regardless of what happened to the
          // session after this call started) — but this session has
          // since changed, so no further action (uploads, records, toast,
          // navigation) should run as if it were still active. dogId is
          // remembered above so a future resume never duplicates it.
          return
        }
      }

      // Now that the dog exists, upload any files that were scanned
      // before we had a dogId to attach them to (fixes "fail to save
      // file" when scanning during dog creation). Every failure is
      // counted, never silently discarded.
      let filesSaved = 0
      let uploadFailures = 0
      if (user?.uid && pendingFiles.length > 0) {
        for (const f of pendingFiles) {
          if (!req.isCurrent()) return
          try {
            const uploadRes = await fetch('/api/upload-document', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                base64: f.base64,
                mediaType: f.mediaType,
                dogId,
                tenantId: user.uid,
                documentType: f.documentType,
                extractedData: { dogName: form.name },
              }),
            })
            if (uploadRes.ok) filesSaved++
            else uploadFailures++
          } catch {
            uploadFailures++
          }
        }
      }
      if (!req.isCurrent()) return

      let recordFailures = 0
      for (const doc of scannedDocs) {
        if (doc.vaccines) {
          for (const v of doc.vaccines) {
            if (!v.name) continue
            if (!req.isCurrent()) return
            try {
              await addVaccineRecord({
                dogId,
                name: v.name,
                dateGiven: v.dateGiven || '',
                nextDue: v.nextDue || '',
                vetClinic: v.vetClinic || '',
                uncertain: v.uncertain || false,
              })
            } catch {
              recordFailures++
            }
          }
        }
        if (doc.healthTest?.result && doc.healthTest?.testType) {
          if (!req.isCurrent()) return
          try {
            await addHealthTest({
              dogId,
              testType: doc.healthTest.testType,
              result: doc.healthTest.result,
              dateTested: doc.healthTest.dateTested || '',
              lab: doc.healthTest.lab || '',
              certNumber: doc.healthTest.certNumber || '',
            })
          } catch {
            recordFailures++
          }
        }
      }

      // One last check before the terminal toast/navigate — a switch
      // that happened during the very last write above must still stop
      // this session from acting as if it were the active one.
      if (!req.isCurrent()) return

      const totalVaccines = scannedDocs.reduce((sum, d) => sum + (d.vaccines?.length || 0), 0)
      const totalFailures = uploadFailures + recordFailures
      if (totalFailures > 0) {
        // Honest partial-failure reporting: the dog and its passport DO
        // exist (created atomically — see db.ts) — this must never read
        // as total failure, but it must also never silently claim full
        // success while records are actually missing.
        const savedNote = pendingFiles.length > 0 ? ` ${filesSaved}/${pendingFiles.length} document(s) saved.` : ''
        toast(`${form.name} was created, but ${totalFailures} record${totalFailures !== 1 ? 's' : ''} failed to save.${savedNote} Open the dog's page to add them.`, 'error')
      } else {
        const fileNote = pendingFiles.length > 0 ? `, ${filesSaved}/${pendingFiles.length} document(s) saved` : ''
        toast(`${form.name} added with ${totalVaccines} vaccine record(s)${fileNote}!`)
      }
      navigate(`/app/dogs/${dogId}`)
    } catch {
      if (createdDogIdRef.current) {
        // The dog itself was already created (this failure happened in a
        // follow-up step, or on a resumed retry after one) — never claim
        // total failure when a real, saved Dog/Passport already exists.
        toast(`${form.name} was created, but some records failed to save. Open the dog's page to check and retry.`, 'error')
        if (req.isCurrent()) navigate(`/app/dogs/${createdDogIdRef.current}`)
      } else {
        toast('Failed to create dog profile', 'error')
      }
    } finally {
      setLoading(false)
      releaseSubmitLock(lockToken)
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

  // Codex round 14: couldn't verify the free-tier limit — fail closed
  // rather than silently letting creation through.
  if (limitCheckError) {
    return (
      <div style={{ padding: 32, maxWidth: 480 }}>
        <Link to="/app/dogs" style={{ fontSize: 13, color: 'var(--light)', textDecoration: 'none' }}>← My dogs</Link>
        <div className="card" style={{ marginTop: 24, textAlign: 'center', padding: '48px 32px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--dark)', marginBottom: 8 }}>
            Couldn't check your plan limit
          </h2>
          <p style={{ fontSize: 14, color: 'var(--mid)', marginBottom: 28, lineHeight: 1.6 }}>
            We need to confirm how many dogs you already have before adding a new one, and that check failed. This is a loading error, not a limit reached — please try again.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={checkLimit}>Retry</button>
            <Link to="/app/dogs" className="btn btn-secondary">
              Back to my dogs
            </Link>
          </div>
        </div>
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
            Upgrade to add more dogs, unlock iDogs Scan, documents, and ownership transfer.
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
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginTop: 8, marginBottom: 4 }}>{isOwner ? 'Create Dog ID' : 'Add a dog'}</h1>
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
                {form.breed && !AU_TOP_BREEDS.includes(form.breed) && (
                  <option value={form.breed}>{form.breed} (from scan)</option>
                )}
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
                <label className="form-label">Dogs Australia Registration</label>
                <input className="form-input" type="text" placeholder="3100012345" value={form.ankc} onChange={e => set('ankc', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Pedigree / Registration status</label>
                <select className="form-select" value={(form as any).pedigreeRegister || 'main'} onChange={e => set('pedigreeRegister', e.target.value)}>
                  <option value="main">🔵 Main Register (Blue) — eligible to breed &amp; show</option>
                  <option value="limited">🟠 Limited Register (Orange) — NOT eligible to breed</option>
                  <option value="no_pedigree">No pedigree — purebred without papers</option>
                  <option value="mixed">Mixed breed / crossbreed</option>
                  <option value="rescue">Rescue / unknown background</option>
                </select>
                {(form as any).pedigreeRegister === 'limited' && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--error)', background: '#FFF8F8', border: '1px solid #F09595', borderRadius: 6, padding: '6px 10px' }}>
                    ⚠️ Limited Register — this dog cannot be used for breeding under Dogs Australia rules.
                  </div>
                )}
                {(form as any).pedigreeRegister === 'main' && (
                  <span className="form-hint">Main Register (Blue certificate) — eligible to breed with other Main Register dogs</span>
                )}
                {['no_pedigree', 'mixed', 'rescue'].includes((form as any).pedigreeRegister) && (
                  <span className="form-hint">iDogs will still track health records, vaccines and reminders for this dog.</span>
                )}
              </div>
            </div>
            {!isOwner && (
              <div style={{ display: 'grid', gridTemplateColumns: form.breederIdType !== 'NONE' ? '1fr 1fr' : '1fr', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Breeder ID type</label>
                  <select className="form-select" value={form.breederIdType} onChange={e => set('breederIdType', e.target.value)}>
                    {(Object.keys(BREEDER_ID_CONFIG) as Array<keyof typeof BREEDER_ID_CONFIG>).map(key => (
                      <option key={key} value={key}>{BREEDER_ID_CONFIG[key].label}</option>
                    ))}
                  </select>
                </div>
                {form.breederIdType !== 'NONE' && (
                  <div className="form-group">
                    <label className="form-label">Breeder ID value</label>
                    <input className="form-input" type="text" placeholder="e.g. B123456789" value={form.breederIdValue} onChange={e => set('breederIdValue', e.target.value)} />
                  </div>
                )}
              </div>
            )}
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
              <button type="submit" className="btn btn-primary" style={{ flex: 1, height: 46 }} disabled={loading || submitting}>
                {(loading || submitting) ? <span className="spinner" /> : (() => {
                  const recordCount = scannedDocs.reduce((s, d) => s + (d.vaccines?.length || 0), 0)
                  const base = isOwner ? 'Create Dog ID & passport' : 'Add dog & create passport'
                  return `${base}${recordCount > 0 ? ` (${recordCount} records)` : ''}`
                })()}
              </button>
              <button type="button" onClick={() => setStep('scan')} className="btn btn-secondary" style={{ height: 46 }}>
                ← Scan more
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Duplicate dog warning modal */}
      {duplicateWarning && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div className="card" style={{ maxWidth: 420, padding: 28 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)', marginBottom: 8 }}>
              Possible duplicate dog
            </h3>
            <p style={{ fontSize: 14, color: 'var(--mid)', marginBottom: 20, lineHeight: 1.6 }}>
              {duplicateWarning.matchedBy === 'microchip'
                ? <>A dog with this <strong>microchip number</strong> already exists in your account, named <strong>{duplicateWarning.existingDogName}</strong>. Microchips should be unique to one dog — please double check before continuing.</>
                : <>A dog named <strong>{duplicateWarning.existingDogName}</strong> already exists in your account. If this is a different dog that happens to share the same name, you can safely continue.</>}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={submitting}
                onClick={() => {
                  // Same single-flight lock AND UID binding as
                  // handleSubmit — lock acquired synchronously, first,
                  // BEFORE beginRequest() (see the lock comment above for
                  // why that order matters), before proceedWithCreate's
                  // own await. A second rapid click on "Add anyway" is a
                  // no-op: the lock is already held, so acquireSubmitLock()
                  // returns null and nothing further happens. No
                  // authenticated UID blocks creation outright, same as
                  // handleSubmit. This resumes safely even if a PREVIOUS
                  // "Add anyway"/submit already created the dog — see
                  // createdDogIdRef in proceedWithCreate().
                  if (!user?.uid) { toast('Your session has changed — please sign in again', 'error'); return }
                  const lockToken = acquireSubmitLock()
                  if (!lockToken) return
                  const req = beginRequest()
                  setDuplicateWarning(null)
                  proceedWithCreate(req, lockToken)
                }}
              >
                Add anyway
              </button>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                disabled={submitting}
                onClick={() => setDuplicateWarning(null)}
              >
                Go back & check
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
