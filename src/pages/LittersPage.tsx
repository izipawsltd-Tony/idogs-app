import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getLitters, getDogs, createLitter, updateLitter, deleteLitterServer, removePuppyFromLitter, createLitterPuppyAtomic, updateDog, transferDogOwnership,
  getShowcaseForLitter, createShowcase, setShowcaseEnabled, updateShowcasePuppy, bulkUpdateShowcasePuppies, DEFAULT_SHOWCASE_PUPPY_ENTRY,
  rotateShowcaseShare, updateShowcaseShare, uploadShowcaseMedia, updateShowcaseMediaOrder, getShowcaseMediaUrls, getEnquiriesForLitter,
} from '../lib/db'
import type { ShowcaseBulkAction, SignedMediaItem } from '../lib/db'
import { doc, collection, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { formatDate, isEligibleSireDog, isEligibleDamDog, isDogTransferred, parseDobStrict, getEffectivePlanClient } from '../lib/utils'
import type { Litter, Dog, ToastMessage, LitterShowcase, ShowcaseAvailability, ShowcaseEnquiry, MediaItem } from '../types'
import { useAuth } from '../hooks/useAuth'
import { useShowcaseRequestGuard } from '../hooks/useShowcaseRequestGuard'
import { sendTransferEmail } from '../lib/email'
import { describeTransferFailure } from '../lib/transferError'
import { emitDogUsageChanged } from '../lib/dogUsageEvents'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
  dismissAll: () => void
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

// NON-AUTHORITATIVE preview only — used to word handleDeleteLitter's
// confirm() dialog before the request is even sent to the server. The
// actual decision is made server-side, fresh, inside api/delete-litter.js
// / api/update-litter.js's own Admin SDK transaction (Codex round 4,
// Blocker 3) via the canonical copy of this same logic in
// api/_lib/litter-eligibility.js — kept in sync by hand; see that file's
// own comment. A dog only counts as a confirmed member of `litterId` if
// its own litterId explicitly agrees (a legacy dog with no litterId
// can't be confirmed either way from its own record, so it's excluded
// entirely rather than assumed eligible on the strength of the litter's
// forward reference alone). A confirmed member is eligible for deletion
// only if it's still exclusively breeder-controlled AND has no
// ownership history at all — buyerEmail alone is not the complete
// history signal (Codex round 3): previousOwnerId, transferredAt,
// claimedAt, AND claimedBy (Codex round 4, Blocker 5 — claimedBy alone,
// without claimedAt, must still block) are all independent, permanent
// provenance that must each individually block deletion. Presence, not
// truthiness (Codex round 5/6, Blocker 3) — even an explicit null counts
// as history now, matching isDogHistoryBearing's own pure hasOwnProperty
// check; a field simply never having been written is the only "clean" case.
const HISTORY_FIELD_NAMES = ['buyerEmail', 'previousOwnerId', 'transferredAt', 'claimedAt', 'claimedBy'] as const
function isDogHistoryBearingPreview(dog: Dog): boolean {
  return HISTORY_FIELD_NAMES.some(field => Object.prototype.hasOwnProperty.call(dog, field))
}
function partitionLitterCandidates(litterId: string, fetched: Dog[], requesterUid: string) {
  const confirmedMembers = fetched.filter(d => d.litterId === litterId)
  const ambiguousCount = fetched.length - confirmedMembers.length
  const eligible = confirmedMembers.filter(d =>
    d.currentOwnerId === requesterUid &&
    !isDogTransferred(d) &&
    !isDogHistoryBearingPreview(d)
  )
  const preserved = confirmedMembers.length - eligible.length
  return { confirmedMembers, ambiguousCount, eligible, preserved }
}

// Fix round (promoted-puppy delete bug) — same allowlist-by-code
// convention as transferError.ts / saleAvailabilityError.ts: never show
// an arbitrary thrown error's raw text, only pre-written copy for a
// small set of known-safe reason codes api/remove-litter-puppy.js
// actually returns. Anything else (network failure, unexpected
// exception, no reason code at all) falls back to one fixed generic
// message.
const PUPPY_DELETE_KNOWN_MESSAGES: Record<string, string> = {
  PROMOTED_ACTIVE_IN_MY_DOGS: 'This puppy is currently in My Dogs. Return it to litter-only before deleting, or archive it from My Dogs to retain its history.',
  DOG_PROTECTED: "This dog can't be deleted — it's transferred, pending claim, claimed, or otherwise no longer exclusively yours.",
  NOT_CONFIRMED_MEMBER: "This puppy's litter membership couldn't be confirmed — please refresh and try again.",
  LITTER_ARCHIVED: 'This litter has been deleted and can no longer be edited.',
}
const PUPPY_DELETE_GENERIC_MESSAGE = 'Failed to delete puppy. Please try again.'
function describePuppyDeleteFailure(err: unknown): string {
  if (err && typeof err === 'object' && 'reason' in err) {
    const reason = (err as { reason?: unknown }).reason
    if (typeof reason === 'string' && PUPPY_DELETE_KNOWN_MESSAGES[reason]) {
      return PUPPY_DELETE_KNOWN_MESSAGES[reason]
    }
  }
  return PUPPY_DELETE_GENERIC_MESSAGE
}

function buildDeleteLitterConfirmText(litterName: string, eligibleCount: number, preservedCount: number, ambiguousCount: number): string {
  const parts = [`Delete litter "${litterName}"?`]
  if (eligibleCount > 0) {
    parts.push(`This will also delete ${eligibleCount} puppy record${eligibleCount !== 1 ? 's' : ''} still in your care.`)
  }
  if (preservedCount > 0) {
    parts.push(`${preservedCount} puppy record${preservedCount !== 1 ? 's' : ''} will be kept (transferred, claimed, or otherwise no longer exclusively yours).`)
  }
  if (ambiguousCount > 0) {
    parts.push(`${ambiguousCount} puppy record${ambiguousCount !== 1 ? 's' : ''} could not be confirmed as exact members of this litter and will be left untouched.`)
  }
  if (eligibleCount === 0 && preservedCount === 0 && ambiguousCount === 0) {
    parts.push('No puppies will be affected.')
  }
  return parts.join(' ')
}

export default function LittersPage({ toast, dismissAll }: Props) {
  const { user, profile, upgradeToBreeder } = useAuth()
  const [upgrading, setUpgrading] = useState(false)
  const [litters, setLitters] = useState<Litter[]>([])
  const [dogs, setDogs] = useState<Dog[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedLitter, setExpandedLitter] = useState<string | null>(null)

  // ── Litter Showcase (Slice 1) ──
  // Keyed by litterId. `undefined` = not yet loaded, `null` = loaded and
  // confirmed no Showcase exists yet for that litter. Loaded lazily (on
  // expand), not up front for every litter — a breeder typically expands
  // one litter at a time.
  const [showcases, setShowcases] = useState<Record<string, LitterShowcase | null | undefined>>({})
  const [showcaseLoading, setShowcaseLoading] = useState<Record<string, boolean>>({})
  const [showcaseBusy, setShowcaseBusy] = useState<Record<string, boolean>>({})
  const [showcaseError, setShowcaseError] = useState<Record<string, string>>({})
  // UI gap fix: distinct from showcaseError (which is only ever the LOAD
  // failure — it drives the whole-panel "Couldn't load Showcase — Retry"
  // empty state, replacing ShowcaseManager entirely) — this is the most
  // recent EDIT/save failure for a litter whose Showcase already loaded
  // successfully. Kept separate so a failed toggle/availability/bulk
  // action shows an inline status message WITHIN the still-visible
  // ShowcaseManager panel, never hides the puppy list the breeder was
  // just looking at. Non-empty = the last save attempt for this litter
  // failed; cleared at the start of every new attempt (so a retry
  // doesn't keep showing a stale failure) and never set on success.
  const [showcaseSaveError, setShowcaseSaveError] = useState<Record<string, string>>({})

  // Slice 2: public share link state, keyed by litterId like the
  // showcase state above. `shareLastRotatedToken` is IN-MEMORY ONLY —
  // the raw token is never persisted anywhere (server or client) once
  // this component unmounts/reloads; api/rotate-showcase-share.js
  // returns it exactly once, at generation time.
  const [shareBusy, setShareBusy] = useState<Record<string, boolean>>({})
  const [shareError, setShareError] = useState<Record<string, string>>({})
  const [shareLastRotatedToken, setShareLastRotatedToken] = useState<Record<string, string>>({})

  // Keep the reusable public URL available after a reload/sign-in on this
  // browser without weakening the server-side hash-only token model. Stored
  // tokens are verified against the current Firestore hash before use, so a
  // token rotated on another device is removed instead of being shown stale.
  useEffect(() => {
    let cancelled = false
    async function restoreShareTokens() {
      for (const [litterId, showcase] of Object.entries(showcases)) {
        if (!showcase?.shareTokenHash || shareLastRotatedToken[litterId]) continue
        const storageKey = `idogs.showcaseShareToken.${litterId}`
        const token = window.localStorage.getItem(storageKey)
        if (!token) continue
        const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
        if (cancelled) return
        if (hash === showcase.shareTokenHash) {
          setShareLastRotatedToken(prev => ({ ...prev, [litterId]: token }))
        } else {
          window.localStorage.removeItem(storageKey)
        }
      }
    }
    void restoreShareTokens()
    return () => { cancelled = true }
  }, [showcases, shareLastRotatedToken])

  // Slice 2: enquiries received through this litter's public Showcase —
  // undefined means "not loaded yet", [] means "loaded, none yet".
  const [enquiries, setEnquiries] = useState<Record<string, ShowcaseEnquiry[] | undefined>>({})
  const [enquiriesLoading, setEnquiriesLoading] = useState<Record<string, boolean>>({})

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
  // Persists the pre-generated dog-doc id AND a separate operation id
  // for the IN-PROGRESS "add puppy" submission across retries within
  // this page session, so a second click after an ambiguous failure
  // resumes the SAME operation. Codex round 4, Blocker 4: the server
  // (api/create-litter-puppy.js) no longer trusts an existing dogId
  // alone as proof of a valid retry — it persists an operation record
  // keyed by operationId atomically with the dog, and only resumes when
  // every field of that record (including this same operationId) agrees
  // with the new request. Both ids are local-only (no network round
  // trip) and are only ever meaningful together — cleared as a pair on
  // success and whenever the form is opened fresh for a different
  // litter/closed.
  const pendingPuppyOperationRef = useRef<{ operationId: string; dogId: string } | null>(null)

  // Codex round 14: this retry loop had three separate bugs.
  // 1. `finally { setLoading(false) }` ran on EVERY attempt, including
  //    ones that were about to schedule a retry — so between each of
  //    the 3 retry attempts (up to ~2.4s total), the spinner disappeared
  //    and the page briefly rendered with litters=[]/dogs=[] as if
  //    genuinely empty, before the next retry even started.
  // 2. Once all retries were exhausted, only a transient toast fired —
  //    litters/dogs stayed at their initial [] with no persistent
  //    indication the load had actually failed (see the loadError
  //    render branch below).
  // 3. Nothing guarded against the component unmounting (navigating
  //    away from /app/litters) while a retry setTimeout was still
  //    pending, or against a NEWER load (a manual Retry click) racing a
  //    STILL-RETRYING older one and having a late, stale response
  //    overwrite fresher state.
  // `loadTokenRef` fixes #3: every call to startLoad() (the initial
  // effect run, or a manual Retry) mints a new token; any in-flight
  // attempt/retry from a PREVIOUS token is a no-op once it resolves.
  // `mountedRef` additionally guards against post-unmount state
  // updates. `loading` is only ever cleared in the two TERMINAL cases
  // (success, or retries fully exhausted) — never between retries.
  const mountedRef = useRef(true)
  const loadTokenRef = useRef(0)
  const [loadError, setLoadError] = useState(false)

  // Codex fix-round finding (Showcase account-switch race): an in-flight
  // Showcase read or mutation started under account A can resolve AFTER
  // the account-switch effect below has already reset all Showcase state
  // for account B — without a guard, that late resolution would call
  // setShowcases/setShowcaseError/setShowcaseLoading/setShowcaseBusy with
  // account A's data and silently resurrect it under account B. See
  // useShowcaseRequestGuard.ts (src/hooks) for the full design rationale
  // — extracted as a plain, no-React-dependency class specifically so a
  // Node test can exercise the exact production guard logic directly,
  // mirroring useRequestGuard.ts's own RequestGuardState split.
  const showcaseGuard = useShowcaseRequestGuard()

  // Only true immediately after `gen` was captured (before its await) —
  // false once the account has switched (or the component has unmounted)
  // in the meantime. Every Showcase async function must check this
  // before EVERY state write that happens after an `await`, including in
  // catch/finally blocks — a stale continuation that fails this check
  // must silently no-op, never toast, never touch showcases/
  // showcaseLoading/showcaseBusy/showcaseError for any litterId.
  function isShowcaseRequestCurrent(gen: number): boolean {
    return mountedRef.current && showcaseGuard.isCurrent(gen)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  function startLoad() {
    if (!user) return
    const token = ++loadTokenRef.current
    setLoading(true)
    setLoadError(false)

    async function attempt(retries: number) {
      try {
        const [l, d] = await Promise.all([getLitters(), getDogs()])
        if (!mountedRef.current || loadTokenRef.current !== token) return
        setLitters(l)
        setDogs(d.filter(dog => !dog.isDeceased))
        setLoading(false)
      } catch {
        if (!mountedRef.current || loadTokenRef.current !== token) return
        if (retries > 0) {
          setTimeout(() => {
            if (mountedRef.current && loadTokenRef.current === token) attempt(retries - 1)
          }, 800)
          // Deliberately no setLoading(false) here — a retry is still
          // scheduled, so the page must keep showing the loading state,
          // not a misleadingly-empty one.
        } else {
          setLoadError(true)
          setLoading(false)
          toast('Failed to load — please try again', 'error')
        }
      }
    }
    setTimeout(() => {
      if (mountedRef.current && loadTokenRef.current === token) attempt(3)
    }, 300)
  }

  useEffect(() => {
    // Codex round 15: clear the previous account's litters/dogs
    // immediately on an account switch (or logout) — loadTokenRef already
    // stops a stale response from COMMITTING, but without this, the OLD
    // account's data would still be visibly on screen for the ~300ms
    // initial delay (and any retries) before the new load resolves.
    // Keyed on user?.uid (a primitive) rather than the whole `user`
    // object, so a token refresh for the SAME account doesn't trigger an
    // unnecessary clear+reload.
    setLitters([])
    setDogs([])
    startLoad()
    // Codex fix-round findings, item 3: Showcase state is keyed by
    // litterId, and litterIds are not guaranteed unique ACROSS accounts —
    // without this reset, switching accounts (or logging out and into a
    // different one in the same tab) could render a stale previous
    // account's cached Showcase (puppies map, enabled flag, in-flight
    // busy/error state) against a same-named litterId that happens to
    // belong to the NEW account, or simply leave an expandedLitter panel
    // open with data that was never re-fetched for the new user. All five
    // pieces of Showcase UI state are reset together, exactly like
    // litters/dogs above.
    //
    // Codex fix-round finding (Showcase account-switch race): bumping the
    // Showcase guard's account generation here, in the SAME synchronous
    // effect body as the resets above, is what actually closes the race
    // — any Showcase request already in flight for the OLD account
    // captured the OLD generation number before its own first `await`,
    // so isShowcaseRequestCurrent() will find it stale the instant its
    // continuation resumes, no matter how long after this effect runs
    // that turns out to be.
    showcaseGuard.bumpAccountGeneration()
    setShowcases({})
    setShowcaseLoading({})
    setShowcaseBusy({})
    setShowcaseError({})
    setShowcaseSaveError({})
    // Slice 2: a rotated-but-unsaved share token must never survive an
    // account switch — it belongs to the OLD account's litter, and this
    // component has no legitimate reason to keep displaying it once a
    // different account is signed in.
    setShareBusy({})
    setShareError({})
    setShareLastRotatedToken({})
    setEnquiries({})
    setEnquiriesLoading({})
    setExpandedLitter(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  // ── Litter Showcase (Slice 1) ──────────────────────────────────

  async function loadShowcase(litterId: string) {
    // Captured BEFORE the first await — see useShowcaseRequestGuard.ts
    // for why this must read the guard's live generation counter, not
    // the `user`/`profile` values closed over by this call (a closure
    // over a stale render never observes a LATER account switch), and
    // why a per-account (not per-request) generation is what lets a
    // DIFFERENT litter's concurrent Showcase call proceed unaffected by
    // this one.
    const gen = showcaseGuard.currentGeneration()
    setShowcaseLoading(prev => ({ ...prev, [litterId]: true }))
    setShowcaseError(prev => ({ ...prev, [litterId]: '' }))
    try {
      const result = await getShowcaseForLitter(litterId)
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcases(prev => ({ ...prev, [litterId]: result }))
    } catch (err) {
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcaseError(prev => ({ ...prev, [litterId]: err instanceof Error && err.message ? err.message : 'Failed to load Showcase' }))
    } finally {
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcaseLoading(prev => ({ ...prev, [litterId]: false }))
    }
  }

  // Lazily loads a litter's Showcase the first time it's expanded — not
  // for every litter up front. `profile?.role === 'owner'` never expands
  // into the breeder controls branch at all (see the render below), so
  // this only ever fires for a breeder/admin viewing their own litters.
  useEffect(() => {
    if (expandedLitter && profile?.role !== 'owner' && showcases[expandedLitter] === undefined) {
      loadShowcase(expandedLitter)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedLitter])

  // Slice 2: the breeder's own read-only view of enquiries received
  // through this litter's public Showcase — same lazy-load-on-expand
  // pattern as loadShowcase above, kept as its own simple state (no
  // busy/save-error tracking needed since this is read-only, unlike the
  // Showcase management state above).
  async function loadEnquiries(litterId: string) {
    const gen = showcaseGuard.currentGeneration()
    setEnquiriesLoading(prev => ({ ...prev, [litterId]: true }))
    try {
      const result = await getEnquiriesForLitter(litterId)
      if (!isShowcaseRequestCurrent(gen)) return
      setEnquiries(prev => ({ ...prev, [litterId]: result }))
    } catch {
      if (!isShowcaseRequestCurrent(gen)) return
      setEnquiries(prev => ({ ...prev, [litterId]: [] }))
    } finally {
      if (!isShowcaseRequestCurrent(gen)) return
      setEnquiriesLoading(prev => ({ ...prev, [litterId]: false }))
    }
  }
  useEffect(() => {
    if (expandedLitter && profile?.role !== 'owner' && enquiries[expandedLitter] === undefined) {
      loadEnquiries(expandedLitter)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedLitter])

  async function handleCreateShowcase(litterId: string) {
    const gen = showcaseGuard.currentGeneration()
    setShowcaseBusy(prev => ({ ...prev, [litterId]: true }))
    try {
      const showcase = await createShowcase(litterId)
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcases(prev => ({ ...prev, [litterId]: showcase }))
      toast('Showcase created — no puppies are shown until you select them')
    } catch (err) {
      if (!isShowcaseRequestCurrent(gen)) return
      toast(err instanceof Error && err.message ? err.message : 'Failed to create Showcase', 'error')
    } finally {
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcaseBusy(prev => ({ ...prev, [litterId]: false }))
    }
  }

  async function handleToggleShowcaseEnabled(litterId: string, current: LitterShowcase) {
    const gen = showcaseGuard.currentGeneration()
    setShowcaseBusy(prev => ({ ...prev, [litterId]: true }))
    // UI gap fix: clear any stale failure from a PREVIOUS attempt the
    // moment a new one starts — otherwise a successful retry would still
    // show the old "Save failed" message for the instant before this
    // request itself resolves.
    setShowcaseSaveError(prev => ({ ...prev, [litterId]: '' }))
    try {
      const showcase = await setShowcaseEnabled(litterId, !current.enabled)
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcases(prev => ({ ...prev, [litterId]: showcase }))
      toast(showcase.enabled ? 'Showcase enabled' : 'Showcase disabled — puppy selection kept')
    } catch (err) {
      if (!isShowcaseRequestCurrent(gen)) return
      const message = err instanceof Error && err.message ? err.message : 'Failed to update Showcase'
      // Deliberately does NOT touch `showcases` here — no optimistic
      // update was ever applied (the checkbox is bound to the last
      // server-CONFIRMED value), so the UI already shows the last
      // successfully saved state automatically; this only surfaces WHY.
      setShowcaseSaveError(prev => ({ ...prev, [litterId]: message }))
      toast(message, 'error')
    } finally {
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcaseBusy(prev => ({ ...prev, [litterId]: false }))
    }
  }

  // Slice 2: mints a new public share token, invalidating any link
  // shared before this. Stores the raw (one-time) token in local state
  // only — never anywhere persisted — so the UI can show/copy it once.
  async function handleRotateShare(litterId: string) {
    if (showcases[litterId]?.shareTokenHash && !window.confirm('Create a new link? The previous link will stop working immediately.')) return
    const gen = showcaseGuard.currentGeneration()
    setShareBusy(prev => ({ ...prev, [litterId]: true }))
    setShareError(prev => ({ ...prev, [litterId]: '' }))
    try {
      const { showcase, shareToken } = await rotateShowcaseShare(litterId)
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcases(prev => ({ ...prev, [litterId]: showcase }))
      setShareLastRotatedToken(prev => ({ ...prev, [litterId]: shareToken }))
      window.localStorage.setItem(`idogs.showcaseShareToken.${litterId}`, shareToken)
      toast('New share link created')
    } catch (err) {
      if (!isShowcaseRequestCurrent(gen)) return
      const message = err instanceof Error && err.message ? err.message : 'Failed to create share link'
      setShareError(prev => ({ ...prev, [litterId]: message }))
      toast(message, 'error')
    } finally {
      if (!isShowcaseRequestCurrent(gen)) return
      setShareBusy(prev => ({ ...prev, [litterId]: false }))
    }
  }

  async function handleToggleShareEnabled(litterId: string, current: LitterShowcase) {
    const gen = showcaseGuard.currentGeneration()
    setShareBusy(prev => ({ ...prev, [litterId]: true }))
    setShareError(prev => ({ ...prev, [litterId]: '' }))
    try {
      const showcase = await updateShowcaseShare(litterId, { shareEnabled: !current.shareEnabled })
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcases(prev => ({ ...prev, [litterId]: showcase }))
      toast(showcase.shareEnabled ? 'Share link enabled' : 'Share link paused')
    } catch (err) {
      if (!isShowcaseRequestCurrent(gen)) return
      const message = err instanceof Error && err.message ? err.message : 'Failed to update share link'
      setShareError(prev => ({ ...prev, [litterId]: message }))
      toast(message, 'error')
    } finally {
      if (!isShowcaseRequestCurrent(gen)) return
      setShareBusy(prev => ({ ...prev, [litterId]: false }))
    }
  }

  async function handleTogglePuppyVisible(litterId: string, puppyId: string, visible: boolean) {
    const gen = showcaseGuard.currentGeneration()
    setShowcaseBusy(prev => ({ ...prev, [litterId]: true }))
    setShowcaseSaveError(prev => ({ ...prev, [litterId]: '' }))
    try {
      const showcase = await updateShowcasePuppy(litterId, puppyId, { visible })
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcases(prev => ({ ...prev, [litterId]: showcase }))
    } catch (err) {
      if (!isShowcaseRequestCurrent(gen)) return
      const message = err instanceof Error && err.message ? err.message : 'Failed to update puppy'
      setShowcaseSaveError(prev => ({ ...prev, [litterId]: message }))
      toast(message, 'error')
    } finally {
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcaseBusy(prev => ({ ...prev, [litterId]: false }))
    }
  }

  async function handlePuppyAvailabilityChange(litterId: string, puppyId: string, availability: ShowcaseAvailability) {
    const gen = showcaseGuard.currentGeneration()
    setShowcaseBusy(prev => ({ ...prev, [litterId]: true }))
    setShowcaseSaveError(prev => ({ ...prev, [litterId]: '' }))
    try {
      const showcase = await updateShowcasePuppy(litterId, puppyId, { availability })
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcases(prev => ({ ...prev, [litterId]: showcase }))
    } catch (err) {
      if (!isShowcaseRequestCurrent(gen)) return
      const message = err instanceof Error && err.message ? err.message : 'Failed to update puppy'
      setShowcaseSaveError(prev => ({ ...prev, [litterId]: message }))
      toast(message, 'error')
    } finally {
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcaseBusy(prev => ({ ...prev, [litterId]: false }))
    }
  }

  // Codex fix-round ("Explicit media publication"): a puppy being
  // visible in the Showcase never implies any of its photos/videos are
  // published — this is the ONLY path that toggles publishedPhotoIds/
  // publishedVideoIds. Same autosave-per-field pattern as
  // handleTogglePuppyVisible/handlePuppyAvailabilityChange above.
  async function handlePublishedMediaChange(litterId: string, puppyId: string, patch: { publishedPhotoIds?: string[]; publishedVideoIds?: string[] }) {
    const gen = showcaseGuard.currentGeneration()
    setShowcaseBusy(prev => ({ ...prev, [litterId]: true }))
    setShowcaseSaveError(prev => ({ ...prev, [litterId]: '' }))
    try {
      const showcase = await updateShowcasePuppy(litterId, puppyId, patch)
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcases(prev => ({ ...prev, [litterId]: showcase }))
    } catch (err) {
      if (!isShowcaseRequestCurrent(gen)) return
      const message = err instanceof Error && err.message ? err.message : 'Failed to update published media'
      setShowcaseSaveError(prev => ({ ...prev, [litterId]: message }))
      toast(message, 'error')
    } finally {
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcaseBusy(prev => ({ ...prev, [litterId]: false }))
    }
  }

  async function handleShowcaseDetailsChange(litterId: string, puppyId: string, patch: Parameters<typeof updateShowcasePuppy>[2]) {
    const gen = showcaseGuard.currentGeneration()
    setShowcaseBusy(prev => ({ ...prev, [litterId]: true }))
    setShowcaseSaveError(prev => ({ ...prev, [litterId]: '' }))
    try {
      const showcase = await updateShowcasePuppy(litterId, puppyId, patch)
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcases(prev => ({ ...prev, [litterId]: showcase }))
    } catch (err) {
      if (!isShowcaseRequestCurrent(gen)) return
      const message = err instanceof Error && err.message ? err.message : 'Failed to update public puppy details'
      setShowcaseSaveError(prev => ({ ...prev, [litterId]: message }))
      toast(message, 'error')
    } finally {
      if (isShowcaseRequestCurrent(gen)) setShowcaseBusy(prev => ({ ...prev, [litterId]: false }))
    }
  }

  // Codex fix-round finding: the underlying action id (show_available_only —
  // api/_lib/showcase-schema.js's BULK_ACTIONS enum, unchanged) is an
  // internal API contract, not user-facing copy — only the BUTTON LABEL
  // and this toast needed fixing. "Show available only" (and a toast that
  // dropped the "in the Showcase" qualifier) read like a FILTER on the
  // breeder's own admin puppy list — it never was; this action only ever
  // changes each available puppy's `visible` flag in the Showcase, and
  // the admin panel below always lists every puppy in the litter
  // regardless (see ShowcaseManager's puppyDogs.map — never filtered by
  // visible/availability).
  const BULK_ACTION_LABELS: Record<ShowcaseBulkAction, string> = {
    select_all: 'All puppies are now shown in the Showcase',
    clear_all: 'All puppies are now hidden from the Showcase',
    show_available_only: 'Available puppies are now selected for the Showcase — other puppies are hidden',
  }

  async function handleShowcaseBulkAction(litterId: string, action: ShowcaseBulkAction) {
    const gen = showcaseGuard.currentGeneration()
    setShowcaseBusy(prev => ({ ...prev, [litterId]: true }))
    setShowcaseSaveError(prev => ({ ...prev, [litterId]: '' }))
    try {
      const showcase = await bulkUpdateShowcasePuppies(litterId, action)
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcases(prev => ({ ...prev, [litterId]: showcase }))
      toast(BULK_ACTION_LABELS[action])
    } catch (err) {
      if (!isShowcaseRequestCurrent(gen)) return
      const message = err instanceof Error && err.message ? err.message : 'Failed to update Showcase'
      setShowcaseSaveError(prev => ({ ...prev, [litterId]: message }))
      toast(message, 'error')
    } finally {
      if (!isShowcaseRequestCurrent(gen)) return
      setShowcaseBusy(prev => ({ ...prev, [litterId]: false }))
    }
  }

  function handleDamChange(damId: string) {
    const dam = dogs.find(d => d.id === damId)
    const year = form.actualBirthDate ? form.actualBirthDate.slice(0, 4) : new Date().getFullYear()
    setForm(prev => ({ ...prev, damId, name: dam ? `${dam.name} Litter ${year}` : prev.name }))
  }

  async function handleCreateLitter() {
    if (!form.damId) { toast('Please select a dam', 'error'); return }
    const dam = dogs.find(d => d.id === form.damId)
    if (!dam) { toast('Dam not found — please refresh', 'error'); return }
    // actualBirthDate is optional at create time (a planned litter may
    // have only a mating/due date) — but if one is provided, it must be
    // a genuinely valid past date, same standard as everywhere else a
    // dateOfBirth-shaped value is accepted.
    if (form.actualBirthDate && !parseDobStrict(form.actualBirthDate)) {
      toast('Actual birth date is not a valid past date', 'error')
      return
    }
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
      })
      const updated = await getLitters()
      setLitters(updated)
      setShowCreate(false)
      setForm({ name: '', damId: '', sireId: '', sireName: '', sireAnkc: '', matingSuspectedDate: '', expectedDueDate: '', actualBirthDate: '', notes: '' })
      toast('Litter created!')
    } catch (err) {
      // The server endpoint returns a specific, actionable message (e.g.
      // "Dam is not an eligible breeding parent") — surface it directly
      // rather than a generic failure, since the whole point of the
      // server-side check is to explain WHY (underage, transferred,
      // deceased, malformed DOB) when the client's own selector missed it.
      toast(err instanceof Error && err.message ? err.message : 'Failed to create litter', 'error')
    } finally {
      setSavingLitter(false)
    }
  }

  async function handleSaveLitter(litterId: string, litter: Litter) {
    // A litter that already has puppies must keep an actual birth date —
    // clearing it would leave born puppy records pointing at a litter
    // that (per policy) shouldn't have been able to produce them.
    if ((litter.puppyIds?.length || 0) > 0 && !editLitterForm.actualBirthDate) {
      toast('This litter has puppies — actual birth date cannot be cleared', 'error')
      return
    }
    if (editLitterForm.actualBirthDate && !parseDobStrict(editLitterForm.actualBirthDate)) {
      toast('Actual birth date is not a valid past date', 'error')
      return
    }
    try {
      // Codex round 4, Blocker 3: this now calls the trusted server
      // endpoint (api/update-litter.js) instead of writing directly —
      // firestore.rules denies a direct client litters update outright.
      // The server re-decides, from fresh state, which puppies are
      // still safe to propagate the new birth date to (same eligibility
      // policy as litter deletion — still owned, no ownership history).
      const { updatedPuppyCount } = await updateLitter(litterId, editLitterForm)
      const [updatedLitters, updatedDogs] = await Promise.all([getLitters(), getDogs()])
      setLitters(updatedLitters)
      setDogs(updatedDogs.filter(dog => !dog.isDeceased))
      setEditingLitter(null)
      toast(updatedPuppyCount > 0 ? `Litter updated — ${updatedPuppyCount} puppy record${updatedPuppyCount !== 1 ? 's' : ''} synced to the new birth date` : 'Litter updated!')
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'Failed to update litter', 'error')
    }
  }

  async function handleDeleteLitter(litter: Litter) {
    if (!user) return
    const currentUid = user.uid

    // Step 1 — a best-effort PREVIEW read, used ONLY to word the
    // confirmation dialog. NOT authoritative: it can be stale the moment
    // it's shown (another tab could transfer a puppy right after this
    // read completes). The actual decision is made fresh in Step 2,
    // inside a transaction — if reality has moved on by then, the
    // transaction acts on the NEW truth, not on what this preview said,
    // and the toast after completion reports what really happened.
    let previewLitterName: string
    try {
      const previewLitterSnap = await getDoc(doc(db, 'litters', litter.id))
      if (!previewLitterSnap.exists()) { toast('This litter no longer exists — refreshing', 'error'); setLitters(prev => prev.filter(l => l.id !== litter.id)); return }
      const previewLitter = { id: previewLitterSnap.id, ...previewLitterSnap.data() } as Litter
      previewLitterName = previewLitter.name
      const previewCandidateSnaps = await Promise.all((previewLitter.puppyIds || []).map(id => getDoc(doc(db, 'dogs', id))))
      const previewFetched = previewCandidateSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() } as Dog))
      const preview = partitionLitterCandidates(previewLitter.id, previewFetched, currentUid)
      if (!confirm(buildDeleteLitterConfirmText(previewLitterName, preview.eligible.length, preview.preserved, preview.ambiguousCount))) return
    } catch {
      toast('Failed to load current litter details — please try again', 'error')
      return
    }

    // Step 2 — the AUTHORITATIVE operation. Codex round 4, Blocker 3:
    // this is now a call to api/delete-litter.js (Admin SDK transaction,
    // bypasses Rules) rather than a client-side Firestore transaction —
    // firestore.rules denies a direct client litters delete outright, so
    // a client transaction touching litters/{id} can no longer work at
    // all. The server endpoint re-reads the litter and every candidate
    // puppy from scratch inside its own transaction and decides
    // eligibility fresh, exactly as round 3's client transaction did —
    // just moved where a stray direct write can no longer bypass it.
    let outcome: { deletedCount: number; preservedCount: number; ambiguousCount: number; litterDeleted: boolean; litterArchived: boolean }
    try {
      outcome = await deleteLitterServer(litter.id)
    } catch {
      toast('Failed to delete litter — please try again', 'error')
      return
    }

    // Codex round 14: this refresh (unlike every other post-action
    // refresh in this file) was not wrapped in a try/catch at all — if
    // it failed AFTER deleteLitterServer() had already succeeded, the
    // rejection went uncaught (a silent unhandled-rejection risk) and
    // the user got no feedback at all: the just-deleted litter would
    // still appear in `litters` (the refresh that would remove it never
    // completed), with nothing telling them why.
    try {
      const [updatedLitters, updatedDogs] = await Promise.all([getLitters(), getDogs()])
      setLitters(updatedLitters)
      setDogs(updatedDogs.filter(d => !d.isDeceased))
    } catch {
      toast('Litter deleted, but the list failed to refresh — reload the page to see the current state', 'error')
    }
    // Codex round 5, Blocker 2: the litter is ARCHIVED (kept, not
    // deleted — see api/delete-litter.js) rather than hard-deleted
    // whenever a transferred/claimed dog is still linked to it, so that
    // dog's lineage reference stays resolvable. Either way it disappears
    // from this list (getLitters() filters archived litters out), so
    // the wording just needs to be honest about which happened.
    if (outcome.litterArchived) {
      toast(`Litter removed from your list — ${outcome.preservedCount} puppy record${outcome.preservedCount !== 1 ? 's' : ''} transferred/claimed elsewhere kept their history, so the litter record itself was preserved rather than deleted`)
    } else {
      toast(outcome.deletedCount > 0 ? `Litter deleted along with ${outcome.deletedCount} puppy record${outcome.deletedCount !== 1 ? 's' : ''}` : 'Litter deleted')
    }
  }

  async function handleAddPuppy(litterId: string, litter: Litter) {
    // A litter that has produced puppies must have an actual birth date —
    // planned/expected litters (mating date or due date only) can exist,
    // but must never generate a born puppy record. This is the service-
    // layer guard; the "+ Add puppy" button itself is also hidden for a
    // litter with no actualBirthDate (see render below), so reaching
    // here without one would only happen via a stale/bypassed UI state.
    if (!litter.actualBirthDate) {
      toast('Set an actual birth date for this litter before adding puppies', 'error')
      return
    }
    if (!parseDobStrict(litter.actualBirthDate)) {
      toast('This litter\'s actual birth date is invalid — fix it before adding puppies', 'error')
      return
    }
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
      // Pre-generate the dog's id AND a separate operation id locally
      // (no network round-trip) and persist both as a pair across
      // retries of this same submission — if this is a retry after an
      // earlier attempt whose outcome was unknown, reusing both lets the
      // server (api/create-litter-puppy.js) verify this retry against
      // its persisted operation record (Codex round 4, Blocker 4) rather
      // than trusting the dogId alone, and resume the prior attempt
      // instead of generating a fresh submission (and thus a fresh,
      // genuinely duplicate dog) every click.
      if (!pendingPuppyOperationRef.current) {
        pendingPuppyOperationRef.current = {
          operationId: doc(collection(db, 'litterPuppyOperations')).id,
          dogId: doc(collection(db, 'dogs')).id,
        }
      }
      const { operationId, dogId } = pendingPuppyOperationRef.current
      const { alreadyExisted, status: createdStatus } = await createLitterPuppyAtomic(litterId, dogId, operationId, {
        name: finalName,
        breed: dam?.breed || '',
        sex: puppyForm.sex,
        dateOfBirth: litter.actualBirthDate,
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
      pendingPuppyOperationRef.current = null
      const [updatedLitters, updatedDogs] = await Promise.all([getLitters(), getDogs()])
      setLitters(updatedLitters)
      setDogs(updatedDogs.filter(d => !d.isDeceased))
      setPuppyForm(emptyPuppy)
      setShowAddPuppy(null)
      // Bug 2 fix (Red Boy staging QA): a puppy created while the breeder
      // is over their plan's dog cap lands 'restricted' (read-only) —
      // previously this success toast claimed an unqualified win either
      // way, so the breeder had no idea until their first edit attempt
      // failed with an unexplained error. Tell them immediately instead.
      toast(
        createdStatus === 'restricted'
          ? `${finalName} added, but is read-only — you're over your plan's dog limit. Upgrade or free up a slot to edit it.`
          : (alreadyExisted ? `${finalName} was already added — no duplicate created` : `${finalName} added — QR Passport created!`)
      )
    } catch (err) {
      // Deliberately does NOT clear pendingPuppyOperationRef — if the
      // failure was a transient network error after the transaction
      // actually committed server-side, the next click reuses the same
      // (operationId, dogId) pair and the server resolves it
      // idempotently instead of creating a duplicate. A genuine full
      // failure left nothing committed, so reusing the pair on retry is
      // equally safe there. A MISMATCH error (wrong litter/tenant/
      // payload/passport for this operationId — Blocker 4's fail-closed
      // path) is a genuine anomaly, not a transient failure — surface it
      // distinctly so the user isn't told to "just retry" a request that
      // will keep failing the same way.
      toast(err instanceof Error && err.message ? err.message : 'Failed to add puppy — click Add again to safely retry', 'error')
    } finally {
      setSavingPuppy(false)
    }
  }

  function startEditPuppy(puppy: Dog) {
    // Staging QA finding (Red Boy, item 4): opening the editor makes no
    // network request of its own (nothing below this line is async, and
    // this function never shows a NEW message) — but a message from an
    // EARLIER, unrelated action can still be visible on screen for up to
    // 3.5s (see useToast's auto-dismiss timer), which reads as if opening
    // THIS editor caused it. Clearing here guarantees a fresh edit
    // session never inherits a stale message from whatever happened
    // right before it.
    dismissAll()
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
    // Bug 2 fix (Red Boy staging QA): a 'restricted' puppy (over the
    // breeder's plan cap — iDogs Pricing v1.1 §3.2/§3.3) is read-only by
    // design; firestore.rules already denies this write, but letting the
    // request round-trip just to fail produced the confusing bare
    // "Failed to update puppy" the QA report flagged. Checked here first
    // so the breeder gets the same clear, actionable guidance
    // DogDetailPage already shows for a restricted dog, instead of a
    // generic denial with no explanation. Ownership/transfer protections
    // are untouched — this only short-circuits a write Rules would deny
    // anyway.
    if ((puppy as any).status === 'restricted') {
      toast("This puppy is over your plan's dog limit and is read-only — upgrade or free up a slot to edit it.", 'error')
      return
    }
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
    // Fix round (promoted-puppy delete bug): client-side pre-check so a
    // promoted puppy is blocked BEFORE the confirm dialog even appears —
    // this is a UX convenience only, never authoritative. The server
    // enforces the same rule fresh on every request (see
    // api/remove-litter-puppy.js's PROMOTED_ACTIVE_IN_MY_DOGS check) so a
    // direct API call, or a puppy promoted in another tab after this
    // page loaded, still can't bypass it.
    const puppy = dogs.find(d => d.id === puppyId)
    if (puppy?.retainedByBreeder === true) {
      toast(PUPPY_DELETE_KNOWN_MESSAGES.PROMOTED_ACTIVE_IN_MY_DOGS, 'error')
      return
    }
    if (!confirm('Permanently delete this puppy record? This cannot be undone.')) return
    try {
      // Codex round 4, Blocker 3: replaces the old direct
      // updateLitter(litter.id, {puppyIds: filtered}) call — a raw
      // client puppyIds mutation — with the trusted server endpoint,
      // which also verifies confirmed litter membership before deleting.
      await removePuppyFromLitter(litter.id, puppyId)
      const [updatedLitters, updatedDogs] = await Promise.all([getLitters(), getDogs()])
      setLitters(updatedLitters)
      setDogs(updatedDogs.filter(d => !d.isDeceased))
      // Success-only refresh, matching AppLayout's sidebar-count fix —
      // never fired on a rejected/failed deletion.
      if (user?.uid) emitDogUsageChanged(user.uid)
      toast('Puppy deleted')
    } catch (err) {
      toast(describePuppyDeleteFailure(err), 'error')
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
    } catch (err) {
      // Round 20: never log/surface the raw error — it can carry a
      // Firestore document path, this caller's UID, or the buyer name/
      // email just entered above. Only a fixed operation name and a
      // normalized, allowlisted code are safe to log — see
      // describeTransferFailure() in ../lib/transferError.ts.
      const { userMessage, logCode, logOperation } = describeTransferFailure(err)
      console.error(logOperation, { code: logCode })
      setTransferError(userMessage)
    } finally {
      setTransferring(false)
    }
  }

  const femalesOnly = dogs.filter(isEligibleDamDog)
  const malesOnly = dogs.filter(isEligibleSireDog)

  if (loading) return <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>

  // Codex round 14: distinct from litters/dogs being genuinely empty —
  // once all 3 retries are exhausted, this must stay visible (not just
  // the transient toast) until the user retries successfully. Shown
  // before branching into the owner/breeder views below since a load
  // failure means the same thing regardless of role.
  if (loadError) {
    return (
      <div style={{ padding: 32 }}>
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <div className="empty-state-title">Couldn't load your litters</div>
          <div className="empty-state-desc">This is a loading error, not an empty list. Please try again.</div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={startLoad}>Retry</button>
        </div>
      </div>
    )
  }

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
                      onClick={() => handleDeleteLitter(litter)}
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
                            <button className="btn btn-primary btn-sm" onClick={() => handleSaveLitter(litter.id, litter)}>Save changes</button>
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
                        {litter.actualBirthDate ? (
                          <button className="btn btn-primary btn-sm" onClick={() => { pendingPuppyOperationRef.current = null; setShowAddPuppy(showAddPuppy === litter.id ? null : litter.id) }}>
                            + Add puppy
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--light)' }}>Set an actual birth date to add puppies</span>
                        )}
                      </div>

                      {/* Add puppy form */}
                      {showAddPuppy === litter.id && litter.actualBirthDate && (
                        <div style={{ background: 'var(--sand)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16 }}>
                          <PuppyFormFields form={puppyForm} onChange={setPuppyForm} />
                          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => handleAddPuppy(litter.id, litter)} disabled={savingPuppy}>
                              {savingPuppy ? <span className="spinner" /> : 'Add & create passport'}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => { pendingPuppyOperationRef.current = null; setShowAddPuppy(null) }}>Cancel</button>
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
                            // Bug 2 fix (Red Boy staging QA) — same 'restricted'
                            // signal DogDetailPage already shows via its 🔒
                            // Restricted badge/banner, mirrored here so a
                            // breeder sees WHY a puppy is read-only before
                            // ever attempting an edit that Rules would deny.
                            const isPuppyRestricted = (puppy as any).status === 'restricted'
                            // Fix round (promoted-puppy delete bug): a
                            // promoted puppy is a deliberately-kept My
                            // Dogs record — shown here so a breeder sees
                            // WHY delete is blocked before ever clicking
                            // it, same pattern as isPuppyRestricted above.
                            const isPuppyPromoted = puppy.retainedByBreeder === true

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
                                  {isPuppyRestricted && (
                                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'var(--gold-light)', color: 'var(--gold)', border: '1px solid rgba(200,151,31,0.3)', whiteSpace: 'nowrap' }}>🔒 Restricted</span>
                                  )}
                                  {isPuppyPromoted && (
                                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'var(--green-light)', color: 'var(--green)', border: '1px solid rgba(8,80,65,.16)', whiteSpace: 'nowrap' }}>✓ In My Dogs</span>
                                  )}
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
                                      style={{ background: isPuppyPromoted ? 'var(--sand)' : '#FDEDED', color: isPuppyPromoted ? 'var(--light)' : 'var(--danger)', border: isPuppyPromoted ? '1px solid var(--border)' : '1px solid #F3B0B0', cursor: isPuppyPromoted ? 'not-allowed' : 'pointer' }}
                                      disabled={isPuppyPromoted}
                                      title={isPuppyPromoted ? PUPPY_DELETE_KNOWN_MESSAGES.PROMOTED_ACTIVE_IN_MY_DOGS : undefined}
                                      onClick={() => handleDeletePuppy(puppy.id, litter)}
                                    >✕</button>
                                  </div>
                                </div>

                                {/* Edit puppy form */}
                                {isEditingThisPuppy && (
                                  <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', background: 'var(--sand)' }}>
                                    {isPuppyRestricted && (
                                      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--gold)', background: 'var(--gold-light)', border: '1px solid rgba(200,151,31,0.3)', padding: '10px 14px', borderRadius: 10 }}>
                                        🔒 This puppy is over your plan's dog limit and is read-only — <Link to="/app/billing" style={{ color: 'var(--gold)', fontWeight: 600 }}>upgrade to Plus</Link> or free up a slot to edit it.
                                      </div>
                                    )}
                                    <fieldset disabled={isPuppyRestricted} style={{ border: 'none', padding: 0, margin: 0 }}>
                                      <PuppyFormFields form={editPuppyForm} onChange={setEditPuppyForm} />
                                    </fieldset>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 14 }}>
                                      <button className="btn btn-primary btn-sm" onClick={() => handleSavePuppy(puppy, litter)} disabled={isPuppyRestricted}>Save changes</button>
                                      <button className="btn btn-secondary btn-sm" onClick={() => setEditingPuppy(null)}>Cancel</button>
                                    </div>
                                    <PuppyMediaManager puppy={puppy} disabled={isPuppyRestricted} toast={toast} onUpdated={updated => setDogs(prev => prev.map(d => d.id === puppy.id ? { ...d, ...updated } : d))} />
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* ── LITTER SHOWCASE (Slice 1) ── */}
                    <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dark)', marginBottom: 10 }}>🎪 Litter Showcase</div>
                      {getEffectivePlanClient(profile) !== 'plus' ? (
                        <div style={{ fontSize: 13, color: 'var(--light)' }}>
                          Litter Showcase is a Plus-plan feature — upgrade to curate which puppies from this litter can be showcased.
                        </div>
                      ) : showcaseLoading[litter.id] ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}><div className="spinner" /></div>
                      ) : showcaseError[litter.id] ? (
                        <div style={{ fontSize: 13, color: 'var(--mid)' }}>
                          <p style={{ marginBottom: 8 }}>Couldn't load Showcase — {showcaseError[litter.id]}</p>
                          <button className="btn btn-secondary btn-sm" onClick={() => loadShowcase(litter.id)}>Retry</button>
                        </div>
                      ) : !showcases[litter.id] ? (
                        <div style={{ fontSize: 13, color: 'var(--mid)' }}>
                          <p style={{ marginBottom: 10 }}>No Showcase yet for this litter. Creating one shows zero puppies until you explicitly select them.</p>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleCreateShowcase(litter.id)}
                            disabled={!!showcaseBusy[litter.id]}
                          >
                            {showcaseBusy[litter.id] ? <span className="spinner" /> : '+ Create Showcase'}
                          </button>
                        </div>
                      ) : (
                        <ShowcaseManager
                          showcase={showcases[litter.id] as LitterShowcase}
                          puppyDogs={puppyDogs}
                          busy={!!showcaseBusy[litter.id]}
                          saveError={showcaseSaveError[litter.id] || ''}
                          onToggleEnabled={() => handleToggleShowcaseEnabled(litter.id, showcases[litter.id] as LitterShowcase)}
                          onToggleVisible={(puppyId, visible) => handleTogglePuppyVisible(litter.id, puppyId, visible)}
                          onAvailabilityChange={(puppyId, availability) => handlePuppyAvailabilityChange(litter.id, puppyId, availability)}
                          onPublishedMediaChange={(puppyId, patch) => handlePublishedMediaChange(litter.id, puppyId, patch)}
                          onDetailsChange={(puppyId, patch) => handleShowcaseDetailsChange(litter.id, puppyId, patch)}
                          onBulkAction={(action) => handleShowcaseBulkAction(litter.id, action)}
                          shareBusy={!!shareBusy[litter.id]}
                          shareError={shareError[litter.id] || ''}
                          shareLastRotatedToken={shareLastRotatedToken[litter.id]}
                          onRotateShare={() => handleRotateShare(litter.id)}
                          onToggleShareEnabled={() => handleToggleShareEnabled(litter.id, showcases[litter.id] as LitterShowcase)}
                          toast={toast}
                          onPuppyMediaUpdated={(puppyId, patch) => setDogs(prev => prev.map(d => d.id === puppyId ? { ...d, ...patch } : d))}
                        />
                      )}
                    </div>

                    {/* ── CUSTOMER ENQUIRIES (Slice 2) ── */}
                    {getEffectivePlanClient(profile) === 'plus' && (
                      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dark)', marginBottom: 10 }}>
                          📩 Enquiries {enquiries[litter.id] && enquiries[litter.id]!.length > 0 && `(${enquiries[litter.id]!.length})`}
                        </div>
                        {enquiriesLoading[litter.id] ? (
                          <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}><div className="spinner" /></div>
                        ) : !enquiries[litter.id] || enquiries[litter.id]!.length === 0 ? (
                          <div style={{ fontSize: 13, color: 'var(--light)' }}>No enquiries yet from this litter's public Showcase.</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {enquiries[litter.id]!.map(enq => {
                              const aboutPuppy = enq.puppyId ? puppyDogs.find(p => p.id === enq.puppyId) : null
                              return (
                                <div key={enq.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 13 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ fontWeight: 600, color: 'var(--dark)' }}>{enq.name}</span>
                                    <span style={{ fontSize: 11, color: 'var(--light)' }}>{formatDate(enq.createdAt)}</span>
                                  </div>
                                  <div style={{ color: 'var(--mid)', marginBottom: 4 }}>
                                    {enq.email && <span>{enq.email}</span>}{enq.email && enq.phone && ' · '}{enq.phone && <span>{enq.phone}</span>}
                                    {aboutPuppy && <span> · about {aboutPuppy.name}</span>}
                                  </div>
                                  <div style={{ color: 'var(--dark)' }}>{enq.message}</div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
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

// ── PUPPY SHOWCASE MEDIA (Slice 2) ──────────────────────────────
// Photo/video gallery for a single puppy — api/upload-showcase-media.js
// does the actual processing (real magic-byte sniffing, HEIC/HEIF
// decode via the shared image-pipeline, size/type validation), this
// component only ever sends raw file bytes and reflects back whatever
// the server returns. No client-side resize/HEIC-detection branch like
// PhotoUpload.tsx's avatar flow — deliberately simpler: the server
// pipeline handles every accepted type uniformly, so there's no
// "special-case HEIC differently" client logic needed here at all.
// Codex fix-round ("Revocable media delivery"): dog.photos/dog.videos are
// now PRIVATE Storage paths ({id, path} — see MediaItem in
// src/types/index.ts), never directly renderable. This component fetches
// fresh, short-lived SIGNED URLs itself (getShowcaseMediaUrls, on mount
// and whenever the puppy changes) and every mutation (upload/reorder/
// delete) works off MediaItem.id — never a URL — since a signed URL is
// deliberately never stable enough to use as a stored reference.
// `onUpdated` only ever hands the PARENT id-only MediaItem placeholders
// (path omitted — never used downstream, only `.id` is, for the
// publish/unpublish checkboxes in ShowcaseManager below) so the litter
// page's own `dogs` state stays roughly in sync for that purpose, without
// this component needing to manage two divergent sources of truth for
// the same gallery.
function PuppyMediaManager({ puppy, disabled, toast, onUpdated }: {
  puppy: Dog
  disabled: boolean
  toast: (msg: string, type?: ToastMessage['type']) => void
  onUpdated: (patch: { photos?: MediaItem[]; videos?: MediaItem[] }) => void
}) {
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<'photo' | 'video' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [photos, setPhotos] = useState<SignedMediaItem[]>([])
  const [videos, setVideos] = useState<SignedMediaItem[]>([])
  const photoInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getShowcaseMediaUrls(puppy.id)
      .then(result => {
        if (cancelled) return
        setPhotos(result.photos)
        setVideos(result.videos)
      })
      .catch(err => {
        if (!cancelled) toast(err instanceof Error && err.message ? err.message : 'Failed to load media', 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [puppy.id])

  function applyResult(result: { photos: SignedMediaItem[]; videos: SignedMediaItem[] }) {
    setPhotos(result.photos)
    setVideos(result.videos)
    onUpdated({
      photos: result.photos.map(item => ({ id: item.id, path: '' })),
      videos: result.videos.map(item => ({ id: item.id, path: '' })),
    })
  }

  function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function handleUpload(file: File, kind: 'photo' | 'video') {
    setUploading(kind)
    try {
      const base64 = await readAsBase64(file)
      const result = await uploadShowcaseMedia(puppy.id, base64, kind)
      applyResult(result)
      toast(`${kind === 'photo' ? 'Photo' : 'Video'} added`)
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : `Failed to upload ${kind}`, 'error')
    } finally {
      setUploading(null)
    }
  }

  async function handleReorder(kind: 'photo' | 'video', current: SignedMediaItem[], fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= current.length) return
    const next = [...current]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    setBusyId(current[fromIndex].id)
    try {
      const result = await updateShowcaseMediaOrder(puppy.id, kind, next.map(item => item.id))
      applyResult(result)
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'Failed to reorder', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(kind: 'photo' | 'video', current: SignedMediaItem[], id: string) {
    if (!window.confirm(`Remove this ${kind}? This cannot be undone.`)) return
    setBusyId(id)
    try {
      const result = await updateShowcaseMediaOrder(puppy.id, kind, current.filter(item => item.id !== id).map(item => item.id))
      applyResult(result)
      toast(`${kind === 'photo' ? 'Photo' : 'Video'} removed`)
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'Failed to remove', 'error')
    } finally {
      setBusyId(null)
    }
  }

  function MediaRow({ kind, items }: { kind: 'photo' | 'video'; items: SignedMediaItem[] }) {
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {items.map((item, i) => (
          <div key={item.id} style={{ position: 'relative', width: 64, opacity: busyId === item.id ? 0.5 : 1 }}>
            {kind === 'photo' ? (
              <img src={item.url} alt="" style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', border: i === 0 ? '2px solid var(--brand-600)' : '1px solid var(--border)' }} />
            ) : (
              <video src={item.url} style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border)' }} muted />
            )}
            {i === 0 && <span style={{ position: 'absolute', top: 2, left: 2, fontSize: 9, fontWeight: 700, background: 'var(--brand-600)', color: '#fff', padding: '1px 4px', borderRadius: 4 }}>COVER</span>}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
              <button type="button" disabled={disabled || i === 0 || busyId !== null} onClick={() => handleReorder(kind, items, i, i - 1)} style={{ fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mid)' }}>◀</button>
              <button type="button" disabled={disabled || busyId !== null} onClick={() => handleDelete(kind, items, item.id)} style={{ fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}>✕</button>
              <button type="button" disabled={disabled || i === items.length - 1 || busyId !== null} onClick={() => handleReorder(kind, items, i, i + 1)} style={{ fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mid)' }}>▶</button>
            </div>
            {kind === 'photo' && i > 0 && (
              <button type="button" disabled={disabled || busyId !== null} onClick={() => handleReorder(kind, items, i, 0)} title="Set as cover photo" style={{ width: '100%', marginTop: 2, fontSize: 9, background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--mid)', padding: '1px 0' }}>★ Set cover</button>
            )}
          </div>
        ))}
      </div>
    )
  }

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}><div className="spinner" /></div>
  }

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mid)', marginBottom: 6 }}>Photos {photos.length > 0 && `(${photos.length})`}</div>
      <MediaRow kind="photo" items={photos} />
      <input ref={photoInputRef} type="file" accept="image/*,.heic,.heif" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f, 'photo'); e.target.value = '' }} />
      <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || uploading !== null} onClick={() => photoInputRef.current?.click()} style={{ marginBottom: 14 }}>
        {uploading === 'photo' ? <span className="spinner" /> : '+ Add photo'}
      </button>

      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mid)', marginBottom: 6 }}>Videos {videos.length > 0 && `(${videos.length})`}</div>
      <MediaRow kind="video" items={videos} />
      <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/webm" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f, 'video'); e.target.value = '' }} />
      <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || uploading !== null} onClick={() => videoInputRef.current?.click()}>
        {uploading === 'video' ? <span className="spinner" /> : '+ Add video'}
      </button>
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

// ── LITTER SHOWCASE MANAGER (Slice 1) ───────────────────────────
// Renders per-litter, only for a breeder/admin on a Plus plan viewing an
// already-created Showcase (see the empty/upgrade/loading/error states
// handled by the caller in the main component above). Every mutation
// here goes through lib/db.ts's showcase functions, which call the
// trusted server endpoints — this component never writes to Firestore
// directly, and never touches the `dogs` collection at all (Slice 1
// requirement 7: hiding a puppy must not modify or delete its
// underlying record).

const AVAILABILITY_LABELS: Record<ShowcaseAvailability, string> = {
  available: 'Available',
  on_hold: 'On hold',
  reserved: 'Reserved',
  unavailable: 'Unavailable',
  sold: 'Sold',
}
const PUBLIC_AVAILABILITY_OPTIONS: ShowcaseAvailability[] = ['available', 'reserved', 'sold']

function ShowcaseManager({
  showcase, puppyDogs, busy, saveError, onToggleEnabled, onToggleVisible, onAvailabilityChange, onPublishedMediaChange, onDetailsChange, onBulkAction,
  shareBusy, shareError, shareLastRotatedToken, onRotateShare, onToggleShareEnabled, toast, onPuppyMediaUpdated,
}: {
  showcase: LitterShowcase
  puppyDogs: Dog[]
  busy: boolean
  saveError: string
  onToggleEnabled: () => void
  onToggleVisible: (puppyId: string, visible: boolean) => void
  onAvailabilityChange: (puppyId: string, availability: ShowcaseAvailability) => void
  onPublishedMediaChange: (puppyId: string, patch: { publishedPhotoIds?: string[]; publishedVideoIds?: string[] }) => void
  onDetailsChange: (puppyId: string, patch: Parameters<typeof updateShowcasePuppy>[2]) => void
  onBulkAction: (action: ShowcaseBulkAction) => void
  shareBusy: boolean
  shareError: string
  // Only ever set immediately after THIS session rotated a link — never
  // reconstructed from `showcase` (which only ever carries the hash).
  shareLastRotatedToken: string | undefined
  onRotateShare: () => void
  onToggleShareEnabled: () => void
  toast: (msg: string, type?: ToastMessage['type']) => void
  // Tony live-staging finding: uploading media was only reachable from
  // the separate "Puppies" list's own Edit-puppy form, with no path to
  // it from this panel at all — a breeder curating a Showcase had no way
  // to add a first photo/video without already knowing to look
  // elsewhere. Reuses the SAME PuppyMediaManager component (and the SAME
  // onUpdated -> setDogs sync pattern) inline per-puppy below so upload
  // is reachable from wherever a breeder is actually trying to use it.
  onPuppyMediaUpdated: (puppyId: string, patch: { photos?: MediaItem[]; videos?: MediaItem[] }) => void
}) {
  const [mediaOpenFor, setMediaOpenFor] = useState<string | null>(null)
  const visibleCount = puppyDogs.filter(p => (showcase.puppies?.[p.id] ?? DEFAULT_SHOWCASE_PUPPY_ENTRY).visible).length

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: busy ? 'default' : 'pointer', marginBottom: 4 }}>
        <input
          type="checkbox"
          checked={showcase.enabled}
          disabled={busy}
          onChange={onToggleEnabled}
          aria-label={showcase.enabled ? 'Disable Showcase' : 'Enable Showcase'}
          style={{ width: 16, height: 16, accentColor: 'var(--brand-600)' }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--dark)' }}>
          {showcase.enabled ? 'Showcase enabled' : 'Showcase disabled'}
        </span>
      </label>
      <p style={{ fontSize: 12, color: 'var(--light)', marginBottom: 4 }}>
        Puppy selection below is kept whether the Showcase is enabled or disabled.
      </p>
      {/* Codex fix-round finding (kept, still true): "enabled/disabled"
          above must never read as "published/public" on its own — it
          only controls this breeder workspace panel's own curation
          state. Slice 2 adds the ACTUAL public link below, as an
          explicit, separate, opt-in action — turning the Showcase
          "enabled" above never by itself shares anything; a link must
          be generated AND turned on. */}
      <p style={{ fontSize: 12, color: 'var(--light)', marginBottom: 8 }}>
        Turning the Showcase on above only affects this panel — nothing is shared publicly until you generate a link below.
      </p>

      <div style={{ marginBottom: 14, padding: 10, background: 'var(--sand)', borderRadius: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dark)', marginBottom: 6 }}>Public share link</div>
        {!showcase.shareTokenHash ? (
          <>
            <p style={{ fontSize: 12, color: 'var(--light)', marginBottom: 8 }}>
              No public share link has been created
            </p>
            <button className="btn btn-secondary btn-sm" disabled={shareBusy} onClick={onRotateShare}>
              {shareBusy ? <span className="spinner" /> : 'Get share link'}
            </button>
          </>
        ) : (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: shareBusy ? 'default' : 'pointer', marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={showcase.shareEnabled}
                disabled={shareBusy}
                onChange={onToggleShareEnabled}
                aria-label={showcase.shareEnabled ? 'Pause public link' : 'Resume public link'}
                style={{ width: 16, height: 16, accentColor: 'var(--brand-600)' }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: showcase.enabled && showcase.shareEnabled ? 'var(--brand-600)' : 'var(--mid)' }}>
                {showcase.enabled && showcase.shareEnabled ? 'Showcase is live and publicly accessible' : 'Share link created — Showcase is currently disabled'}
              </span>
            </label>
            {shareLastRotatedToken ? (
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="form-input"
                    readOnly
                    value={`${window.location.origin}/s/${shareLastRotatedToken}`}
                    style={{ fontSize: 12 }}
                    onFocus={e => e.target.select()}
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/s/${shareLastRotatedToken}`) }}
                  >Copy link</button>
                </div>
                <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 5 }}>Use the same link for all interested buyers.</p>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--light)', marginBottom: 8 }}>
                This link was created on another device or before reusable links were supported. Generate a new link only if you no longer have the original.
              </p>
            )}
            <button className="btn btn-secondary btn-sm" disabled={shareBusy} onClick={onRotateShare}>
              {shareBusy ? <span className="spinner" /> : 'Generate new link (invalidates the current one)'}
            </button>
            <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 5 }}>Creates a new link and disables the previous one.</p>
          </>
        )}
        {shareError && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>⚠️ {shareError}</p>}
      </div>

      {/* UI gap fix: every toggle/select/bulk action already saves
          immediately (autosave, one field per network call — see
          handleToggleShowcaseEnabled/handleTogglePuppyVisible/
          handlePuppyAvailabilityChange/handleShowcaseBulkAction above).
          There is no local draft buffer to lose, so there is no explicit
          "Save changes" button and no unsaved-changes-on-close warning to
          add — see this component's own header note in the source for
          the full reasoning. What was genuinely missing was RELIABLE,
          always-accurate status feedback proving that autosave actually
          happened. role="status"/aria-live so screen readers announce a
          state change without needing focus to move here. Deliberately
          NOT the same visual line as "Showcase enabled/disabled" above —
          that is PUBLISH status; this is DRAFT-PERSISTENCE status. A
          disabled Showcase can still say "All changes saved" (its config
          is saved, just not public), and an enabled one can briefly say
          "Saving…" mid-edit without implying it went offline. */}
      <div role="status" aria-live="polite" style={{ fontSize: 12, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        {busy ? (
          <span style={{ color: 'var(--mid)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="spinner" style={{ width: 12, height: 12 }} /> Saving…
          </span>
        ) : saveError ? (
          <span style={{ color: 'var(--danger)' }}>
            Changes couldn’t be saved — try again
          </span>
        ) : (
          <span style={{ color: 'var(--brand-600)' }}>✓ All changes saved</span>
        )}
      </div>

      {puppyDogs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '16px', color: 'var(--light)', fontSize: 13 }}>
          No puppies in this litter yet — add puppies above to include them here.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--mid)' }}>{visibleCount} of {puppyDogs.length} puppies shown</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onBulkAction('select_all')}>Select all</button>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onBulkAction('clear_all')}>Clear all</button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => onBulkAction('show_available_only')}
                title="Selects every puppy currently marked Available for the Showcase and hides the rest. This list below still always shows every puppy in the litter."
              >Select available puppies only</button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {puppyDogs.map(puppy => {
              const entry = showcase.puppies?.[puppy.id] ?? DEFAULT_SHOWCASE_PUPPY_ENTRY
              const checkboxId = `showcase-visible-${puppy.id}`
              const puppyPhotoIds = (puppy.photos || []).map(item => item.id)
              const puppyVideoIds = (puppy.videos || []).map(item => item.id)
              function togglePublished(kind: 'photo' | 'video', id: string, checked: boolean) {
                const field = kind === 'photo' ? 'publishedPhotoIds' : 'publishedVideoIds'
                const current = kind === 'photo' ? (entry.publishedPhotoIds || []) : (entry.publishedVideoIds || [])
                const next = checked ? [...current, id] : current.filter(existingId => existingId !== id)
                onPublishedMediaChange(puppy.id, { [field]: next })
              }
              return (
                <div
                  key={puppy.id}
                  style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--white)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={entry.visible}
                      disabled={busy}
                      onChange={e => onToggleVisible(puppy.id, e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: 'var(--brand-600)', flexShrink: 0 }}
                    />
                    <label htmlFor={checkboxId} style={{ flex: 1, minWidth: 100, fontSize: 13, fontWeight: 500, color: 'var(--dark)', cursor: busy ? 'default' : 'pointer' }}>
                      {puppy.name}
                      <span style={{ fontWeight: 400, color: 'var(--light)' }}> · {puppy.sex === 'female' ? '♀' : '♂'}</span>
                    </label>
                    <select
                      className="form-select"
                      value={entry.availability === 'on_hold' ? 'reserved' : entry.availability === 'unavailable' ? 'sold' : entry.availability}
                      disabled={busy}
                      onChange={e => onAvailabilityChange(puppy.id, e.target.value as ShowcaseAvailability)}
                      style={{ fontSize: 12, padding: '4px 8px', minWidth: 120 }}
                      aria-label={`Availability for ${puppy.name}`}
                    >
                      {PUBLIC_AVAILABILITY_OPTIONS.map(value => (
                        <option key={value} value={value}>{AVAILABILITY_LABELS[value]}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ paddingLeft: 26, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                    <label className="form-group" style={{ margin: 0 }}>
                      <span className="form-label">Public colour</span>
                      <input className="form-input" defaultValue={entry.colour ?? puppy.colour ?? ''} maxLength={80} disabled={busy}
                        onBlur={e => onDetailsChange(puppy.id, { colour: e.target.value || null })} />
                    </label>
                    <label className="form-group" style={{ margin: 0 }}>
                      <span className="form-label">Ready for new home</span>
                      <input className="form-input" type="date" defaultValue={entry.readyToGoHomeDate ?? ''} disabled={busy}
                        onBlur={e => onDetailsChange(puppy.id, { readyToGoHomeDate: e.target.value || null })} />
                    </label>
                    <label className="form-group" style={{ margin: 0, gridColumn: '1/-1' }}>
                      <span className="form-label">Personality <span style={{ color: 'var(--light)', fontWeight: 400 }}>(max 500 characters)</span></span>
                      <textarea className="form-input" rows={2} defaultValue={entry.personality ?? ''} maxLength={500} disabled={busy}
                        onBlur={e => onDetailsChange(puppy.id, { personality: e.target.value || null })} />
                    </label>
                    <label className="form-group" style={{ margin: 0 }}>
                      <span className="form-label">Price (AUD)</span>
                      <input className="form-input" type="number" min="0" step="0.01" defaultValue={entry.priceCents == null ? '' : (entry.priceCents / 100).toFixed(2)} disabled={busy}
                        onBlur={e => onDetailsChange(puppy.id, { priceCents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} />
                      <span style={{ fontSize: 11 }}><input type="checkbox" checked={entry.showPrice === true} disabled={busy || entry.priceCents == null} onChange={e => onDetailsChange(puppy.id, { showPrice: e.target.checked })} /> Show publicly</span>
                    </label>
                    <label className="form-group" style={{ margin: 0 }}>
                      <span className="form-label">Deposit (AUD)</span>
                      <input className="form-input" type="number" min="0" step="0.01" defaultValue={entry.depositCents == null ? '' : (entry.depositCents / 100).toFixed(2)} disabled={busy}
                        onBlur={e => onDetailsChange(puppy.id, { depositCents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} />
                      <span style={{ fontSize: 11 }}><input type="checkbox" checked={entry.showDeposit === true} disabled={busy || entry.depositCents == null} onChange={e => onDetailsChange(puppy.id, { showDeposit: e.target.checked })} /> Show publicly</span>
                    </label>
                  </div>
                  {/* Tony live-staging finding: this row previously had no
                      way to add a puppy's first photo/video at all — the
                      upload UI only existed in the separate Edit-puppy
                      form. This toggle opens the SAME PuppyMediaManager
                      right here, so adding media is reachable from
                      wherever a breeder is actually setting up the
                      Showcase. */}
                  <div style={{ paddingLeft: 26 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setMediaOpenFor(mediaOpenFor === puppy.id ? null : puppy.id)}
                      style={{ fontSize: 12 }}
                    >
                      📷 Photos &amp; videos {(puppyPhotoIds.length + puppyVideoIds.length) > 0 && `(${puppyPhotoIds.length + puppyVideoIds.length})`} {mediaOpenFor === puppy.id ? '▲' : '▼'}
                    </button>
                    {mediaOpenFor === puppy.id && (
                      <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--sand)' }}>
                        <PuppyMediaManager
                          puppy={puppy}
                          disabled={busy}
                          toast={toast}
                          onUpdated={patch => onPuppyMediaUpdated(puppy.id, patch)}
                        />
                      </div>
                    )}
                  </div>
                  {/* Codex fix-round ("Explicit media publication"): being
                      `visible` above never publishes any media by itself —
                      each photo/video must be individually selected here.
                      Uses the puppy's own photo/video COUNT+order (from
                      PuppyMediaManager above) since this compact row
                      deliberately doesn't re-fetch signed thumbnails just
                      to render a publish checklist. */}
                  {(puppyPhotoIds.length > 0 || puppyVideoIds.length > 0) && (
                    <div style={{ paddingLeft: 26, fontSize: 12, color: 'var(--mid)' }}>
                      {puppyPhotoIds.length > 0 && (
                        <div style={{ marginBottom: puppyVideoIds.length > 0 ? 6 : 0 }}>
                          <span style={{ fontWeight: 600 }}>Publish photos: </span>
                          {puppyPhotoIds.map((id, i) => (
                            <label key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 10, cursor: busy ? 'default' : 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={(entry.publishedPhotoIds || []).includes(id)}
                                disabled={busy}
                                onChange={e => togglePublished('photo', id, e.target.checked)}
                                style={{ width: 13, height: 13, accentColor: 'var(--brand-600)' }}
                              />
                              {i === 0 ? 'Cover' : `#${i + 1}`}
                            </label>
                          ))}
                        </div>
                      )}
                      {puppyVideoIds.length > 0 && (
                        <div>
                          <span style={{ fontWeight: 600 }}>Publish videos: </span>
                          {puppyVideoIds.map((id, i) => (
                            <label key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 10, cursor: busy ? 'default' : 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={(entry.publishedVideoIds || []).includes(id)}
                                disabled={busy}
                                onChange={e => togglePublished('video', id, e.target.checked)}
                                style={{ width: 13, height: 13, accentColor: 'var(--brand-600)' }}
                              />
                              #{i + 1}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
