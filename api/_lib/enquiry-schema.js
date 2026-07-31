// api/_lib/enquiry-schema.js — validation/sanitization for a public
// Litter Showcase enquiry submission (Slice 2). No auth exists at this
// point (a potential buyer viewing the public page has no account), so
// this is the ONLY gate between arbitrary internet input and a
// Firestore write — every field is validated server-side regardless of
// whatever the public page's own client-side form validation already
// did (which a direct API caller can simply skip).

export class EnquiryValidationError extends Error {}

const MAX_NAME_LENGTH = 200
const MAX_CONTACT_LENGTH = 200
const MAX_MESSAGE_LENGTH = 3000

// Deliberately simple/permissive patterns — this is a lead-capture
// form, not a strict RFC 5322/E.164 validator. The goal is catching
// obviously-malformed input (so a breeder never receives an
// unreachable "contact"), not rejecting every real-world edge case of
// a valid email or phone number.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^[0-9+()\-.\s]{6,30}$/

// Strips control characters (keeping ordinary whitespace) and trims —
// the same class of defensive cleanup this codebase's other public
// input path (api/survey.js, if present) and litter-schema.js's own
// text-field handling already apply, so a submission can never smuggle
// terminal-control sequences or similar into a breeder's own dashboard
// view of their enquiries.
function cleanString(value, maxLength) {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()
  return stripped.slice(0, maxLength)
}

// Returns a fully-normalized, safe object. Throws EnquiryValidationError
// (mapped to a 400 by the caller) for anything a genuine user could
// reasonably be expected to fix — missing name, missing BOTH email and
// phone, a malformed email/phone, a missing message, or missing
// consent. Never throws for the honeypot field being filled — that's
// signalled via the returned `honeypotFilled` flag instead, so the
// caller can silently discard it (a real validation error would teach a
// bot exactly what to fix).
export function sanitizeEnquiryInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new EnquiryValidationError('Invalid submission')
  }

  const name = cleanString(raw.name, MAX_NAME_LENGTH)
  if (!name) throw new EnquiryValidationError('Name is required')

  const email = cleanString(raw.email, MAX_CONTACT_LENGTH)
  const phone = cleanString(raw.phone, MAX_CONTACT_LENGTH)
  if (!email && !phone) throw new EnquiryValidationError('An email or phone number is required')
  if (email && !EMAIL_PATTERN.test(email)) throw new EnquiryValidationError('Email address is not valid')
  if (phone && !PHONE_PATTERN.test(phone)) throw new EnquiryValidationError('Phone number is not valid')

  const message = cleanString(raw.message, MAX_MESSAGE_LENGTH)
  if (!message) throw new EnquiryValidationError('Message is required')

  if (raw.consent !== true) throw new EnquiryValidationError('Consent is required')

  // Honeypot — a form field real users never see or fill (hidden via
  // CSS on the public page), that a naive bot filling every input
  // finds and fills anyway. Any non-empty value here means "treat as
  // spam", handled by the caller (api/create-showcase-enquiry.js)
  // returning a FAKE success without writing anything — telling a bot
  // it was caught only teaches it to adapt.
  const honeypotFilled = typeof raw.website === 'string' && raw.website.trim() !== ''

  return {
    name,
    email: email || null,
    phone: phone || null,
    message,
    consent: true,
    honeypotFilled,
    puppyId: typeof raw.puppyId === 'string' && raw.puppyId.trim() !== '' ? raw.puppyId.trim() : null,
  }
}
