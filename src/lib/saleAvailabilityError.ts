// Extracted from DogDetailPage.tsx in Codex round 14 so both the React
// component AND a Node test script import the exact same production code
// (rather than a test mirroring the logic and drifting from it).
//
// Codex round 13: the round-12 fix logged the FULL raw error object to
// console and, for anything other than a permission-denied, fell back
// to displaying `e.message` verbatim — a Firestore/network error's
// message can carry a document path, an internal backend string, or
// (worst case) get accidentally paired with request-shaped text a
// future caller adds to an Error's message. Neither the toast nor the
// console output should ever depend on what an arbitrary thrown value
// happens to say. This maps ONLY a small, known-safe allowlist of
// Firebase error `code` values to controlled, pre-written copy — every
// other code (including no code at all, e.g. a plain thrown string or a
// non-Firebase Error) falls through to one fixed generic message.
// Nothing here ever reads `.message`, `.stack`, or any other property.
export const SALE_AVAILABILITY_KNOWN_ERROR_MESSAGES: Record<string, string> = {
  'permission-denied': "you don't have permission to update this dog anymore — ownership may have changed since this page loaded",
  'unavailable': 'you appear to be offline, or our servers are temporarily unavailable — please try again in a moment',
}
export const SALE_AVAILABILITY_GENERIC_ERROR_MESSAGE = 'Failed to save. Please try again, or contact support if this keeps happening.'

// Codex round 14: `e.code` must be read AT MOST ONCE, inside try/catch —
// `e` is an arbitrary thrown value and could be a Proxy or an object with
// a throwing/side-effecting getter for `code`. The previous version read
// it three times (an `in` check, a `typeof` cast, then again in the
// return), which is both wasteful and unsafe if the getter throws on a
// later call, returns something different each time, or has side effects.
// This function is guaranteed to never throw, regardless of what `e` is
// (Symbol, Proxy, throwing getter, non-Error, null, etc.) — any failure
// while reading `code` is caught and normalizes to 'unknown'.
export function normalizeSaleAvailabilityErrorCode(e: unknown): string {
  try {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code?: unknown }).code
      if (typeof code === 'string') return code
    }
  } catch {
    // Reading/accessing `code` itself threw — fall through to 'unknown'.
  }
  return 'unknown'
}

export function describeSaleAvailabilitySaveFailure(e: unknown): { userMessage: string; logCode: string } {
  const code = normalizeSaleAvailabilityErrorCode(e)
  const detail = SALE_AVAILABILITY_KNOWN_ERROR_MESSAGES[code]
  return {
    userMessage: detail ? `Failed to save — ${detail}` : SALE_AVAILABILITY_GENERIC_ERROR_MESSAGE,
    logCode: code,
  }
}
