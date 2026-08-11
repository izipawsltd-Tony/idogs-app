// api/_lib/admin-access.js — shared Super Admin authorization for
// trusted server endpoints (Landing Page Media). Verifies a real,
// cryptographically-valid Firebase ID token via the Admin SDK, then
// checks the token's OWN embedded, server-verified email claim against
// a fixed allowlist — never a client-supplied role/claim/header, which
// could be forged by anyone able to reach this endpoint at all.
//
// This allowlist is a deliberate, separate copy of
// src/components/layout/AppLayout.tsx's SUPER_ADMIN_EMAILS (re-exported
// there from src/lib/superAdmin.ts) — the frontend bundle (src/) and
// these Vercel serverless functions (api/) are built and deployed
// through entirely different pipelines (Vite vs esbuild/ncc) with no
// shared module graph between them, so the two lists cannot import from
// one shared source. Kept as two explicitly-written copies (with this
// comment on both) rather than a derived value, so a mismatch between
// them is a visible, obvious diff in code review — the same convention
// already established for MAX_DIRECT_VIDEO_UPLOAD_BYTES (see
// api/_lib/direct-upload.js's own header comment).
export const SUPER_ADMIN_EMAILS = [
  'trunghieungo@gmail.com',
  'theresanguyenngo@gmail.com',
]

export function isSuperAdminEmail(email) {
  return !!email && SUPER_ADMIN_EMAILS.includes(String(email).trim().toLowerCase())
}

// Verifies the Authorization: Bearer <Firebase ID token> header and
// confirms the caller's own verified email is on the Super Admin
// allowlist. Returns { uid, email } on success, or null on ANY failure
// (missing header, invalid/expired token, or an email not on the
// allowlist) — callers should treat null as a generic 401/403, never
// distinguishing "token invalid" from "not an admin" in the response
// (no reason to help an attacker enumerate which failure mode they hit).
export async function requireSuperAdmin(req, getAuthFn) {
  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) return null

  let decoded
  try {
    decoded = await getAuthFn().verifyIdToken(idToken)
  } catch {
    return null
  }

  // email_verified is required — an unverified email on a compromised or
  // typo'd signup must never be treated as proof of identity for an
  // admin-only surface, even if it happens to match the allowlist string.
  if (!decoded.email || decoded.email_verified !== true) return null
  if (!isSuperAdminEmail(decoded.email)) return null

  return { uid: decoded.uid, email: decoded.email.trim().toLowerCase() }
}
