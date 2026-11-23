import { request } from '@playwright/test'
import { assertStagingPreview, bootstrapPreviewCookie } from './previewContext'
import { cleanupPreviewState, writePreviewState } from './state-path'

// Obtains the Vercel bypass cookie once, origin-bound (see previewContext.ts), and stores ONLY
// that host-only cookie (no origins, no storage) for the `page`/`context` fixtures. The state file is
// created directly with owner-only permissions in a private directory (see state-path.ts), is outside
// playwright-report/ and test-results/, and is removed by the returned teardown on success or failure
// (a cleanup failure fails the run), and here if setup itself fails.
export default async function globalSetup() {
  const base = process.env.BASE_URL
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  try {
    if (!base || !bypass) {
      writePreviewState(JSON.stringify({ cookies: [], origins: [] }))
    } else {
      const origin = new URL(assertStagingPreview(base)).origin
      const host = new URL(origin).hostname
      const rc = await request.newContext()
      try {
        await bootstrapPreviewCookie(rc, origin, bypass)
        const { cookies } = await rc.storageState()
        writePreviewState(JSON.stringify({ cookies: cookies.filter(c => c.domain.replace(/^\./, '') === host), origins: [] }))
      } finally {
        await rc.dispose()
      }
    }
  } catch (e) {
    try { cleanupPreviewState() } catch { process.stderr.write('preview state cleanup also failed after setup failure\n') }
    throw e
  }
  return async () => cleanupPreviewState()
}
