// src/lib/superAdmin.ts — shared Super Admin allowlist for internal
// admin-only surfaces in THIS app (the Admin Console shortcut link in
// AppLayout.tsx, and the Landing Page Media admin page). Extracted from
// AppLayout.tsx's own previously-local SUPER_ADMIN_EMAILS constant so
// both consumers stay in sync automatically — a client-side gate only
// (UX convenience: hides a link/page a non-admin has no use for). It
// carries no authority of its own; every actual write this allowlist
// gates is re-checked server-side against api/_lib/admin-access.js's own
// SUPER_ADMIN_EMAILS copy (a separate, deliberately duplicated list —
// see that module's header comment for why the src/ and api/ build
// pipelines can't share one module).
export const SUPER_ADMIN_EMAILS = [
  'trunghieungo@gmail.com',
  'theresanguyenngo@gmail.com',
]

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return !!email && SUPER_ADMIN_EMAILS.includes(email.trim().toLowerCase())
}
