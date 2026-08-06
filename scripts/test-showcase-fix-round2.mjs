// scripts/test-showcase-fix-round2.mjs — regression coverage for the
// 2026-08-05 Litter Showcase fix round (two Tony live-staging findings):
//
//   Bug 1 — uploaded puppy media not appearing publicly. Root cause: NOT
//   a code defect — the upload→publish→public-display pipeline (already
//   covered exhaustively by scripts/test-litter-showcase-public.mjs) was
//   proven correct end-to-end on live staging; the QA fixture simply had
//   media uploaded but never explicitly published. This file only covers
//   the ONE new thing added because of it: a row-level "unpublished
//   media" warning in the breeder workspace (LittersPage.tsx), so this
//   exact confusion is harder to reproduce a third time.
//
//   Bug 2 — the enquiry success message couldn't tell Tony whether an
//   email was actually sent, because none ever was — api/create-
//   showcase-enquiry.js only ever persisted a Firestore document. This
//   file covers the real best-effort notification added on top of that
//   (sendShowcaseEnquiryNotification(), a pure exported function unit-
//   tested directly here via a mocked global.fetch) plus the frontend/
//   breeder-UI copy and security-property checks not already covered by
//   scripts/test-showcase-enquiry.mjs (updated in this same round).
//
// IMPLEMENT NOW round (buyer/breeder enquiry email workflow) added
// Section 1b/1c below: the breeder notification's Reply-To (buyer's own
// address) and the new sendShowcaseEnquiryConfirmation() sent to the
// buyer once that notification is accepted, with Reply-To the breeder's
// own resolved address. Same pure-function-plus-mocked-fetch approach as
// Section 1 — no emulator, no real Resend credential needed.
//
// Usage: node scripts/test-showcase-fix-round2.mjs (no emulator needed —
// sendShowcaseEnquiryNotification/sendShowcaseEnquiryConfirmation are
// pure functions w.r.t. their inputs plus the injectable global.fetch,
// never touch Firestore/Auth themselves)

import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { sendShowcaseEnquiryNotification, sendShowcaseEnquiryConfirmation } from '../api/_lib/showcase-notification.js'

const { check, checkAsync, summary } = makeChecker()

// =========================================================================
// SECTION 1 — sendShowcaseEnquiryNotification(): pure-function unit tests
// covering every state the required test list asks for (accepted,
// failed, not-configured, no-recipient) via a mocked global.fetch —
// no real network call, no real Resend credential needed.
// =========================================================================

const BASE_ARGS = {
  breederEmail: 'breeder@example.com',
  litterName: 'Test Litter 2026',
  puppyName: 'Test Puppy',
  enquirerName: 'Jane Buyer',
  enquirerEmail: 'jane@example.com',
  enquirerPhone: null,
  message: 'Interested in this puppy',
}

function withMockedFetch(impl, fn) {
  const original = global.fetch
  global.fetch = impl
  return Promise.resolve(fn()).finally(() => { global.fetch = original })
}

check('RESEND_API_KEY unset entirely — treated as "not attempted" (notified:false, errorCode:null), never a crash', await (async () => {
  const original = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  try {
    const result = await sendShowcaseEnquiryNotification(BASE_ARGS)
    return result.notified === false && result.errorCode === null
  } finally {
    if (original !== undefined) process.env.RESEND_API_KEY = original
  }
})())

await checkAsync('a resolved recipient + configured key + Resend accepting (200) => notified:true, errorCode:null', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  try {
    return await withMockedFetch(
      async () => ({ ok: true, json: async () => ({ id: 'evt_fake' }) }),
      async () => {
        const result = await sendShowcaseEnquiryNotification(BASE_ARGS)
        return result.notified === true && result.errorCode === null
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('Resend rejecting the request (non-2xx) => notified:false, errorCode:EMAIL_PROVIDER_REJECTED — enquiry still expected to persist (caller-level guarantee, see Section 2)', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  try {
    return await withMockedFetch(
      async () => ({ ok: false, json: async () => ({ message: 'invalid domain' }) }),
      async () => {
        const result = await sendShowcaseEnquiryNotification(BASE_ARGS)
        return result.notified === false && result.errorCode === 'EMAIL_PROVIDER_REJECTED'
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('the provider call throwing (network failure) => notified:false, errorCode:NOTIFICATION_SEND_FAILED — never propagates/crashes the caller', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  try {
    return await withMockedFetch(
      async () => { throw new Error('ECONNRESET') },
      async () => {
        const result = await sendShowcaseEnquiryNotification(BASE_ARGS)
        return result.notified === false && result.errorCode === 'NOTIFICATION_SEND_FAILED'
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

check('no resolvable breeder email (breederEmail: null) => notified:false, errorCode:RECIPIENT_EMAIL_UNAVAILABLE, no network call attempted at all', await (async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let fetchCalled = false
  try {
    return await withMockedFetch(
      async () => { fetchCalled = true; return { ok: true, json: async () => ({}) } },
      async () => {
        const result = await sendShowcaseEnquiryNotification({ ...BASE_ARGS, breederEmail: null })
        return result.notified === false && result.errorCode === 'RECIPIENT_EMAIL_UNAVAILABLE' && !fetchCalled
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})())

await checkAsync('a general litter enquiry (no puppyName) still succeeds and uses the litter-level subject line', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        const result = await sendShowcaseEnquiryNotification({ ...BASE_ARGS, puppyName: null })
        return result.notified === true && capturedBody.subject.includes('Test Litter 2026') && !capturedBody.subject.includes('undefined')
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('the outbound email is sent FROM the existing verified noreply@idogs.com.au sender and TO the resolved breederEmail only — never to the enquirer\'s own email', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        await sendShowcaseEnquiryNotification(BASE_ARGS)
        return capturedBody.from.includes('noreply@idogs.com.au') &&
          JSON.stringify(capturedBody.to) === JSON.stringify(['breeder@example.com']) &&
          !JSON.stringify(capturedBody.to).includes('jane@example.com')
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('the enquirer\'s own contact details (name/email/phone/message) are included in the email body so the breeder can act on it', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        await sendShowcaseEnquiryNotification(BASE_ARGS)
        return capturedBody.html.includes('Jane Buyer') && capturedBody.html.includes('jane@example.com') && capturedBody.html.includes('Interested in this puppy')
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

// =========================================================================
// SECTION 1b — buyer/breeder email workflow: breeder notification's
// Reply-To (test B), sender display name, and header-injection safety.
// =========================================================================

await checkAsync('[B] the breeder notification\'s Reply-To is the BUYER\'s own submitted email — never noreply@idogs.com.au', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        await sendShowcaseEnquiryNotification(BASE_ARGS)
        return capturedBody.reply_to === 'jane@example.com' && capturedBody.reply_to !== 'noreply@idogs.com.au'
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('the breeder notification is sent from the exact display name "iDogs <noreply@idogs.com.au>"', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        await sendShowcaseEnquiryNotification(BASE_ARGS)
        return capturedBody.from === 'iDogs <noreply@idogs.com.au>'
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('a phone-only enquiry (no enquirerEmail) omits Reply-To entirely on the breeder notification — never falls back to noreply@idogs.com.au', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        await sendShowcaseEnquiryNotification({ ...BASE_ARGS, enquirerEmail: null, enquirerPhone: '0412 345 678' })
        return !('reply_to' in capturedBody)
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('[header injection] an enquirerEmail carrying a smuggled CRLF/second-header payload is rejected by the header-safety guard — Reply-To is omitted, never set to the malicious value', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        await sendShowcaseEnquiryNotification({ ...BASE_ARGS, enquirerEmail: 'jane@example.com\r\nBcc: attacker@evil.com' })
        return !('reply_to' in capturedBody)
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

// =========================================================================
// SECTION 1c — sendShowcaseEnquiryConfirmation(): the buyer's own
// confirmation email (tests C, D, G).
// =========================================================================

const CONFIRMATION_ARGS = {
  buyerEmail: 'jane@example.com',
  buyerName: 'Jane Buyer',
  litterName: 'Test Litter 2026',
  puppyName: 'Test Puppy',
  kennelName: 'Happy Tails Kennel',
  breederEmail: 'breeder@example.com',
}

check('sendShowcaseEnquiryConfirmation: RESEND_API_KEY unset — treated as "not attempted" (sent:false, errorCode:null), never a crash', await (async () => {
  const original = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  try {
    const result = await sendShowcaseEnquiryConfirmation(CONFIRMATION_ARGS)
    return result.sent === false && result.errorCode === null
  } finally {
    if (original !== undefined) process.env.RESEND_API_KEY = original
  }
})())

check('sendShowcaseEnquiryConfirmation: no buyerEmail at all (phone-only enquiry) => sent:false, errorCode:BUYER_EMAIL_UNAVAILABLE, no network call attempted', await (async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let fetchCalled = false
  try {
    return await withMockedFetch(
      async () => { fetchCalled = true; return { ok: true, json: async () => ({}) } },
      async () => {
        const result = await sendShowcaseEnquiryConfirmation({ ...CONFIRMATION_ARGS, buyerEmail: null })
        return result.sent === false && result.errorCode === 'BUYER_EMAIL_UNAVAILABLE' && !fetchCalled
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})())

await checkAsync('[C] a resolved buyerEmail + configured key + Resend accepting (200) => sent:true, errorCode:null, sent TO the buyer only', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        const result = await sendShowcaseEnquiryConfirmation(CONFIRMATION_ARGS)
        return result.sent === true && result.errorCode === null &&
          JSON.stringify(capturedBody.to) === JSON.stringify(['jane@example.com'])
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('[D] the confirmation email\'s Reply-To is the BREEDER\'s own resolved email — never noreply@idogs.com.au', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        await sendShowcaseEnquiryConfirmation(CONFIRMATION_ARGS)
        return capturedBody.reply_to === 'breeder@example.com' && capturedBody.reply_to !== 'noreply@idogs.com.au'
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('the confirmation email is sent from "iDogs <noreply@idogs.com.au>" with the exact required subject "Your enquiry has been sent"', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        await sendShowcaseEnquiryConfirmation(CONFIRMATION_ARGS)
        return capturedBody.from === 'iDogs <noreply@idogs.com.au>' && capturedBody.subject === 'Your enquiry has been sent'
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('the confirmation email body includes the buyer name, puppy name, and kennel name, and states the breeder will contact them directly', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        await sendShowcaseEnquiryConfirmation(CONFIRMATION_ARGS)
        return capturedBody.html.includes('Jane Buyer') &&
          capturedBody.html.includes('Test Puppy') &&
          capturedBody.html.includes('Happy Tails Kennel') &&
          /will contact you directly/.test(capturedBody.html)
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('a missing kennelName falls back to a generic "the breeder" phrase rather than showing "undefined" or "null"', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        await sendShowcaseEnquiryConfirmation({ ...CONFIRMATION_ARGS, kennelName: null })
        return capturedBody.html.includes('the breeder') && !capturedBody.html.includes('undefined') && !capturedBody.html.includes('null')
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('[G] Resend rejecting the confirmation (non-2xx) => sent:false, errorCode:EMAIL_PROVIDER_REJECTED — never throws, caller-level guarantee that this can never surface as a false success', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  try {
    return await withMockedFetch(
      async () => ({ ok: false, json: async () => ({ message: 'invalid domain' }) }),
      async () => {
        const result = await sendShowcaseEnquiryConfirmation(CONFIRMATION_ARGS)
        return result.sent === false && result.errorCode === 'EMAIL_PROVIDER_REJECTED'
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('the confirmation provider call throwing (network failure) => sent:false, errorCode:NOTIFICATION_SEND_FAILED — never propagates/crashes the caller', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  try {
    return await withMockedFetch(
      async () => { throw new Error('ECONNRESET') },
      async () => {
        const result = await sendShowcaseEnquiryConfirmation(CONFIRMATION_ARGS)
        return result.sent === false && result.errorCode === 'NOTIFICATION_SEND_FAILED'
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('[header injection] a breederEmail carrying a smuggled CRLF payload is rejected by the header-safety guard — Reply-To is omitted, never set to the malicious value', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let capturedBody = null
  try {
    return await withMockedFetch(
      async (_url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) } },
      async () => {
        await sendShowcaseEnquiryConfirmation({ ...CONFIRMATION_ARGS, breederEmail: 'breeder@example.com\r\nBcc: attacker@evil.com' })
        return !('reply_to' in capturedBody)
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

await checkAsync('[header injection] a buyerEmail carrying a smuggled CRLF payload is rejected outright — no send attempted at all (unsafe To address)', async () => {
  process.env.RESEND_API_KEY = 'test-key-not-real'
  let fetchCalled = false
  try {
    return await withMockedFetch(
      async () => { fetchCalled = true; return { ok: true, json: async () => ({}) } },
      async () => {
        const result = await sendShowcaseEnquiryConfirmation({ ...CONFIRMATION_ARGS, buyerEmail: 'jane@example.com\r\nBcc: attacker@evil.com' })
        return result.sent === false && result.errorCode === 'BUYER_EMAIL_UNAVAILABLE' && !fetchCalled
      }
    )
  } finally {
    delete process.env.RESEND_API_KEY
  }
})

// =========================================================================
// SECTION 2 — api/create-showcase-enquiry.js: additional security-
// property source checks not already covered by scripts/test-showcase-
// enquiry.mjs's own (updated, in this same round) assertions.
// =========================================================================

{
  const enquirySrc = readFileSync(new URL('../api/create-showcase-enquiry.js', import.meta.url), 'utf8')

  check('breederEmail is resolved from showcase.tenantId ONLY — the exact same tenantId every tenant-chain/cross-tenant check above it already re-validates, never a second, independent source',
    /getAuth\(\)\.getUser\(showcase\.tenantId\)/.test(enquirySrc))
  check('puppyName passed to the notification is resolved from resolveVisiblePuppyByRef\'s own dog.name (same tenant/litter-chain-validated puppy), never client-supplied',
    /resolvedPuppyName = resolved\.dog\.name \|\| null/.test(enquirySrc))
  check('the honeypot branch returns before any notification/write logic is ever reached — a bot never triggers an outbound email or a Firestore write',
    enquirySrc.indexOf('if (sanitized.honeypotFilled)') < enquirySrc.indexOf('sendShowcaseEnquiryNotification({'))

  // ── [E] kennelName (buyer/breeder email workflow round) is resolved
  // server-side from the SAME already-fetched, tenant-authoritative
  // profile document the Plus-eligibility check reads — never from the
  // request body. ──
  check('[E] kennelName is resolved from the already-fetched breederProfile (users/{tenantId}), never from req.body/body/sanitized input',
    /const kennelName = breederProfile\?\.kennelName \|\| null/.test(enquirySrc) &&
    !/kennelName:\s*(req\.body|body|sanitized)/.test(enquirySrc))
  check('[E] breederProfile itself comes from the SAME profileSnap already fetched for the Plus-eligibility check — no separate/duplicated read, and never client input',
    /const breederProfile = profileSnap\.exists \? profileSnap\.data\(\) : null/.test(enquirySrc))
}

// =========================================================================
// SECTION 3 — Bug 1: the new row-level "unpublished media" warning
// (LittersPage.tsx) — source inspection, breeder-workspace UI only, no
// security surface.
// =========================================================================

{
  const pageSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('the unpublished-media warning checks BOTH publishedPhotos and publishedVideos being empty — a puppy with only a published video (no photo) must not be flagged',
    /puppyFields\.visible && \(publishedPhotos\[puppy\.id\] \|\| \[\]\)\.length === 0 && \(publishedVideos\[puppy\.id\] \|\| \[\]\)\.length === 0/.test(pageSrc))
  check('the warning is gated on puppyFields.visible — a puppy the breeder hasn\'t made public at all is not warned about (nothing to fix yet)',
    /puppyFields\.visible &&/.test(pageSrc))
  check('the warning text explains the actual consequence (placeholder) and the fix (publish at least one item), not just "warning"',
    /it will show the iDogs placeholder/.test(pageSrc) && /Publish at least one item below/.test(pageSrc))
}

// =========================================================================
// SECTION 4 — breeder-side enquiry list: submission time + not-notified
// indicator (LittersPage.tsx render), and ShowcaseEnquiry type shape.
// =========================================================================

{
  const pageSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('the breeder enquiry list now shows date AND time (formatDateTime), not date-only (formatDate) — satisfies "identified by... submission time"',
    /formatDateTime\(enq\.createdAt\)/.test(pageSrc))
  check('formatDateTime is imported from lib/utils, not a duplicated inline implementation', /import \{[^}]*formatDateTime[^}]*\} from '\.\.\/lib\/utils'/.test(pageSrc))
  check('a per-enquiry "not emailed" indicator is shown when enq.notified is false, directing the breeder to reply from the stored contact details instead',
    /!enq\.notified &&[\s\S]{0,200}Not emailed/.test(pageSrc))

  const utilsSrc = readFileSync(new URL('../src/lib/utils.ts', import.meta.url), 'utf8')
  check('formatDateTime is exported from lib/utils.ts and formats with both date and time precision', /export function formatDateTime/.test(utilsSrc) && /h:mm a/.test(utilsSrc))

  const typesSrc = readFileSync(new URL('../src/types/index.ts', import.meta.url), 'utf8')
  check('ShowcaseEnquiry type declares notified as OPTIONAL (notified?: boolean) — a legacy enquiry created before this field existed genuinely lacks it in Firestore, and the type must not lie about that',
    /interface ShowcaseEnquiry \{[\s\S]*?notified\?: boolean/.test(typesSrc))
  check('ShowcaseEnquiry type declares notificationErrorCode as optional (only present on a failed/unattempted notification)',
    /notificationErrorCode\?: string/.test(typesSrc))
  check('ShowcaseEnquiry type declares buyerConfirmationSent as optional, mirroring notified\'s own optionality contract',
    /buyerConfirmationSent\?: boolean/.test(typesSrc))
  check('ShowcaseEnquiry type declares buyerConfirmationErrorCode as optional',
    /buyerConfirmationErrorCode\?: string/.test(typesSrc))
}

// =========================================================================
// SECTION 5 — Codex fix-round ("durability-first ordering"): the create-
// then-attempt-then-update sequence, and its required failure-mode
// guarantees. api/create-showcase-enquiry.js's handler is a full HTTP
// endpoint with top-level Admin SDK initialization (same as every other
// endpoint in this codebase) and is not directly invokable here without
// real Firebase credentials or a running emulator — so, matching this
// codebase's own established convention for exactly this class of file
// (see scripts/test-showcase-enquiry.mjs's own Section 1), the required
// ordering/failure-mode guarantees are proven via precise source
// inspection: relative statement position (indexOf comparisons), call-
// count (never more than one attempt), and absence of any
// delete/rollback/retry code path. Section 1 above already proves
// sendShowcaseEnquiryNotification()'s OWN internal behavior for each
// outcome (accepted/rejected/thrown/no-recipient/not-configured) via
// real unit tests with a mocked fetch — this section proves the CALLER
// wires those outcomes together with the correct durability guarantees.
// =========================================================================

{
  const enquirySrc = readFileSync(new URL('../api/create-showcase-enquiry.js', import.meta.url), 'utf8')

  const addIndex = enquirySrc.indexOf("db.collection('showcaseEnquiries').add(")
  const notifyIndex = enquirySrc.indexOf('await sendShowcaseEnquiryNotification({')
  const confirmIndex = enquirySrc.indexOf('await sendShowcaseEnquiryConfirmation({')
  const updateIndex = enquirySrc.indexOf('await enquiryRef.update({')
  const responseIndex = enquirySrc.indexOf('res.status(200).json({ success: true, notified })')

  check('Section 5 setup: all five key statements (create, notify, confirm, update, response) were located in source', addIndex > -1 && notifyIndex > -1 && confirmIndex > -1 && updateIndex > -1 && responseIndex > -1)

  // ── Requirement 1 & 2: Firestore initial write happens FIRST, with
  // notified:false, before any Resend attempt — "no email attempted"
  // if this write itself throws is a structural guarantee of plain
  // sequential await + the single outer try/catch (see the next check),
  // not something that needs its own branch. ──
  check('the Firestore enquiry is CREATED before the Resend notification is ever attempted (durability-first — the enquiry can never be lost to an email that hangs or the function timing out)',
    addIndex < notifyIndex)
  check('the initial create writes notified:false explicitly — an honest, safe default if the process is cut off before the follow-up update ever runs',
    /showcaseEnquiries'\)\.add\(\{[\s\S]{0,400}notified: false,\s*\n\s*\}\)/.test(enquirySrc))
  check('the initial create is a single top-level `await` with NO local try/catch wrapping it — a throw here propagates straight to the outer handler catch, which returns 500 WITHOUT ever reaching the notification call below (structural proof of "initial write failure => no email attempted")',
    !/try \{\s*\n\s*const enquiryRef = await db\.collection\('showcaseEnquiries'\)\.add/.test(enquirySrc))

  // ── Requirement 3 & 4: Resend is attempted only after the write above
  // succeeded, and its result is written back to the SAME document. ──
  check('the notification attempt happens strictly between the create and the update — never before create, never after update',
    addIndex < notifyIndex && notifyIndex < updateIndex)
  check('the follow-up write is an UPDATE on the exact enquiryRef returned by the create — never a second .add() (never a duplicate enquiry document)',
    /enquiryRef\.update\(/.test(enquirySrc) && (enquirySrc.match(/\.add\(\{/g) || []).length === 1)
  check('the update writes the REAL `notified` result (from the notification attempt) — true on acceptance, false otherwise, never hardcoded',
    /await enquiryRef\.update\(\{\s*\n\s*notified,/.test(enquirySrc))

  // ── [G] the buyer confirmation is attempted strictly between the
  // breeder notification and the status update, and ONLY when the
  // breeder notification was accepted — never before it, never
  // unconditionally, never after the update has already recorded the
  // outcome. ──
  check('[G] the buyer confirmation attempt happens strictly between the breeder notification and the status update',
    notifyIndex < confirmIndex && confirmIndex < updateIndex)
  check('[G] the buyer confirmation call is gated on `if (notified)` — never attempted when the breeder notification was not accepted',
    /if \(notified\) \{\s*\n\s*const confirmation = await sendShowcaseEnquiryConfirmation\(\{/.test(enquirySrc))
  check('[G] the update writes the REAL buyerConfirmationSent result — defaults to false when never attempted, never hardcoded true',
    /let buyerConfirmationSent = false/.test(enquirySrc) && /buyerConfirmationSent,/.test(enquirySrc))
  check('sendShowcaseEnquiryConfirmation is CALLED (await ...(...)) exactly once in this file — no loop, no retry wrapper',
    (enquirySrc.match(/await sendShowcaseEnquiryConfirmation\(/g) || []).length === 1)

  // ── Requirement 5: failure/unavailable => preserve the enquiry, store
  // only the approved fixed notificationErrorCode. ──
  check('there is NO delete/rollback of the enquiry document anywhere in this file, under any outcome — the enquiry is unconditionally preserved once created',
    !/enquiryRef\.delete\(/.test(enquirySrc) && !enquirySrc.includes(".collection('showcaseEnquiries').doc(") ) // no ad-hoc doc(id).delete() path either
  check('only the fixed, non-PII notificationErrorCode (never a raw provider error/message) is ever written to the document',
    /\.\.\.\(notificationErrorCode \? \{ notificationErrorCode \} : \{\}\)/.test(enquirySrc))
  check('only the fixed, non-PII buyerConfirmationErrorCode (never a raw provider error/message) is ever written to the document',
    /\.\.\.\(buyerConfirmationErrorCode \? \{ buyerConfirmationErrorCode \} : \{\}\)/.test(enquirySrc))

  // ── Requirement 6: if the post-send status update itself fails, do
  // NOT delete/recreate the enquiry and do NOT send a second email. ──
  check('the status-update call is wrapped in its OWN try/catch, separate from the outer handler catch — its failure must not be treated as "the whole request failed" (the enquiry is already safely saved)',
    /try \{\s*\n\s*await enquiryRef\.update\(\{/.test(enquirySrc))
  check('the status-update catch block does NOT re-invoke sendShowcaseEnquiryNotification — a failed bookkeeping update never triggers a second (potentially duplicate) email',
    (() => {
      const catchStart = enquirySrc.indexOf('} catch {', updateIndex)
      const catchEnd = enquirySrc.indexOf('}', catchStart + 10)
      const catchBody = enquirySrc.slice(catchStart, catchEnd)
      return !catchBody.includes('sendShowcaseEnquiryNotification')
    })())
  check('the status-update catch block does NOT re-invoke sendShowcaseEnquiryConfirmation either — same duplicate-send guarantee for the buyer\'s copy',
    (() => {
      const catchStart = enquirySrc.indexOf('} catch {', updateIndex)
      const catchEnd = enquirySrc.indexOf('}', catchStart + 10)
      const catchBody = enquirySrc.slice(catchStart, catchEnd)
      return !catchBody.includes('sendShowcaseEnquiryConfirmation')
    })())
  check('the status-update catch block does NOT delete or re-create the enquiry document',
    (() => {
      const catchStart = enquirySrc.indexOf('} catch {', updateIndex)
      const catchEnd = enquirySrc.indexOf('}', catchStart + 10)
      const catchBody = enquirySrc.slice(catchStart, catchEnd)
      return !catchBody.includes('.delete(') && !catchBody.includes('.add(')
    })())
  check('sendShowcaseEnquiryNotification is CALLED (await ...(...)) exactly once in this file — no loop, no retry wrapper, anywhere (a header-comment cross-reference to the same name is expected and does not count as a call)',
    (enquirySrc.match(/await sendShowcaseEnquiryNotification\(/g) || []).length === 1)

  // ── The HTTP response reports the in-memory `notified` result, never
  // re-read from the (possibly now-stale, if the update failed) document
  // — proven by the response line referencing the same `notified`
  // variable bound from the notification call, not a fresh Firestore
  // read. ──
  check('the API response uses the notification\'s own in-memory `notified` result, not a re-read of the (possibly stale after an update failure) Firestore document',
    responseIndex > -1 && !/const .*= await enquiryRef\.get\(\)/.test(enquirySrc))

  // ── Anti-spam / rate-limit / duplicate-submission posture unchanged ──
  const rateLimitIndex = enquirySrc.indexOf('checkDurableRateLimit(')
  check('the existing durable rate limiter still runs BEFORE any of this round\'s new create/notify/confirm/update logic (position unchanged by this round\'s edits)',
    rateLimitIndex > -1 && rateLimitIndex < addIndex)
  check('the honeypot short-circuit still returns before the create/notify/confirm/update sequence — a bot never creates an enquiry or triggers either email',
    enquirySrc.indexOf('if (sanitized.honeypotFilled)') < addIndex)

  // ── [F] every early-return (invalid token, disabled/expired share,
  // downgraded tenant, tenant-chain drift, unresolved puppyRef) happens
  // strictly before the Firestore create — and therefore strictly before
  // BOTH email attempts, which only ever run after it. A forged/invalid
  // request can only ever reach the point of returning a generic 404,
  // never trigger any outbound email. ──
  check('[F] every pre-create validation gate (token/share-live/tenant-plan/tenant-chain/puppyRef) returns before the Firestore create — and therefore before either email attempt, which both run strictly after it',
    (() => {
      const gates = [
        "if (showcaseSnap.empty) {",
        "if (!isShareLive(showcase)) {",
        "if (!isTenantPlusEligible(breederProfile)) {",
        "if (!litterSnap.exists || litterSnap.data().tenantId !== showcase.tenantId) {",
        "if (!resolved) {",
      ]
      return gates.every(g => {
        const idx = enquirySrc.indexOf(g)
        return idx > -1 && idx < addIndex
      })
    })())

  // ── The public response never exposes the breeder's destination email ──
  check('the success response body is exactly { success: true, notified } — breederEmail, kennelName, and buyerConfirmationSent are never included',
    /res\.status\(200\)\.json\(\{ success: true, notified \}\)/.test(enquirySrc) &&
    !/notified, breederEmail/.test(enquirySrc) && !/breederEmail,\s*notified/.test(enquirySrc) &&
    !/notified, kennelName/.test(enquirySrc) && !/notified, buyerConfirmationSent/.test(enquirySrc))
}

// =========================================================================
// SECTION 6 — legacy enquiry documents (created before `notified`
// existed) render safely in the breeder UI. Pure, Firebase-free logic
// test — mirrors LittersPage.tsx's exact `!enq.notified` condition
// against a plain object shaped like a real pre-migration Firestore
// document (no `notified` key at all, not even `undefined` explicitly).
// =========================================================================

{
  // Exactly what a real legacy showcaseEnquiries document looks like —
  // written before this fix round existed, so it genuinely has no
  // `notified` key in Firestore at all (Firestore never retroactively
  // backfills fields onto existing documents).
  const legacyEnquiry = {
    id: 'legacy1', tenantId: 't1', litterId: 'l1', puppyId: null,
    name: 'Old Buyer', email: 'old@example.com', phone: null,
    message: 'Enquiry from before this feature existed', createdAt: '2026-01-01T00:00:00Z',
    // no `notified` key at all
  }
  check('a legacy enquiry object has no `notified` property at all (real pre-migration document shape)', !('notified' in legacyEnquiry))
  check('LittersPage.tsx\'s exact `!enq.notified` condition (mirrored here) evaluates true for a legacy document — safely shows the "not emailed" indicator rather than crashing or silently assuming it was sent',
    !legacyEnquiry.notified === true)

  const pageSrc = readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
  check('the breeder UI never accesses enq.notified in a way that would throw on undefined (e.g. enq.notified.toString(), no optional-chaining-required member access)',
    !/enq\.notified\.\w/.test(pageSrc))
}

await summary()
