// src/lib/transferError.ts — Round 20: sanitized/classified error handling
// for the two live dog-transfer save flows — DogDetailPage.tsx's
// TransferModal.handleSubmit() and LittersPage.tsx's handleTransferPuppy()
// (both call db.ts's transferDogOwnership()) — mirroring the pattern
// established by saleAvailabilityError.ts (Codex round 13/14/15).
// src/components/ui/TransferOwnershipModal.tsx is a separate, currently
// unused component (not imported anywhere) and is intentionally left
// alone here — out of scope for this fix.
//
// Root cause this exists for: transferDogOwnership() writes to the dogs/
// {dogId} document, which is governed by firestore.rules — a legacy dog
// missing createdByUserId/sourceType previously made that rule throw and
// deny the update outright (see firestore.rules' isEffectiveDogOwner/
// dogProtectedFieldsUnchanged for the actual fix). Whether the rule denies
// for a legitimate reason (ownership genuinely changed) or a bug, the
// SAME client-side handling applies here: never surface or log the raw
// Firebase error. It can carry a Firestore document path, the caller's
// UID, buyer email/name (the two fields this exact form just collected),
// or — if the failure came from the transfer-email step instead — a
// provider payload, token, or other credential-shaped text.
//
// Deliberately narrower than saleAvailabilityError.ts: per-code user-
// facing copy isn't in scope here, only classification for diagnostics.
// The client-facing message stays fixed and identical for every failure
// (a permission change mid-transfer and a transient network blip look
// the same to the breeder: "try again, and if it keeps happening
// something needs to change"). Only the LOGGED code is classified, and
// only 'permission-denied' is a recognized/allowlisted value — everything
// else (including other real Firestore codes, non-Firebase errors from
// the email-send step, and hostile/malformed thrown values) normalizes to
// 'unknown'. `.code` is read at most once, inside try/catch, so a
// throwing getter/Proxy can never crash the handler or the app.
export const TRANSFER_GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.'

const TRANSFER_ALLOWED_ERROR_CODES = new Set(['permission-denied'])

export function normalizeTransferErrorCode(e: unknown): string {
  try {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code?: unknown }).code
      if (typeof code === 'string' && TRANSFER_ALLOWED_ERROR_CODES.has(code)) {
        return code
      }
    }
  } catch {
    // Reading/accessing `code` itself threw — fall through to 'unknown'.
  }
  return 'unknown'
}

// Returns the fixed client message plus a sanitized { operation, code }
// pair that is the ONLY thing safe to log — never `e` itself, never
// `e.message`/`e.stack`, and never any of the buyer/dog details the
// caller collected for this transfer.
export function describeTransferFailure(e: unknown): { userMessage: string; logCode: string; logOperation: string } {
  return {
    userMessage: TRANSFER_GENERIC_ERROR_MESSAGE,
    logCode: normalizeTransferErrorCode(e),
    logOperation: 'transfer-ownership',
  }
}
