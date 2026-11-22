import { request } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { assertStagingPreview, bootstrapPreviewCookie } from './previewContext'
import { PREVIEW_STATE } from './state-path'

// Obtains the Vercel bypass cookie once, origin-bound (see previewContext.ts), and stores ONLY
// that host-only cookie for the `page`/`context` fixtures. The state file lives in the OS temp
// dir, outside playwright-report/ and test-results/, so it is never uploaded as an artifact.
export default async function globalSetup() {
  const base = process.env.BASE_URL
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (!base || !bypass) {
    writeFileSync(PREVIEW_STATE, JSON.stringify({ cookies: [], origins: [] }))
    return
  }
  const origin = new URL(assertStagingPreview(base)).origin
  const rc = await request.newContext()
  try {
    await bootstrapPreviewCookie(rc, origin, bypass)
    await rc.storageState({ path: PREVIEW_STATE })
  } finally {
    await rc.dispose()
  }
}
