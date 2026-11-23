import { request } from '@playwright/test'
import { assertStagingPreview, bootstrapPreviewCookie } from './previewContext'
import { cleanupPreviewState, lockPreviewState, writePreviewState, PREVIEW_STATE } from './state-path'

// Obtains the Vercel bypass cookie once, origin-bound (see previewContext.ts), and stores ONLY
// that host-only cookie for the `page`/`context` fixtures. The state file is private to this run
// (see state-path.ts), outside playwright-report/ and test-results/, and removed by the returned
// teardown on success or failure, and here if setup itself fails.
export default async function globalSetup() {
  const base = process.env.BASE_URL
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  try {
    if (!base || !bypass) {
      writePreviewState(JSON.stringify({ cookies: [], origins: [] }))
    } else {
      const origin = new URL(assertStagingPreview(base)).origin
      const rc = await request.newContext()
      try {
        await bootstrapPreviewCookie(rc, origin, bypass)
        await rc.storageState({ path: PREVIEW_STATE })
        lockPreviewState()
      } finally {
        await rc.dispose()
      }
    }
  } catch (e) {
    cleanupPreviewState()
    throw e
  }
  return async () => cleanupPreviewState()
}
