import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { invitationEmail, renewalEmail } from './promotion-emails.js'

export async function writeEmailPreviews(outDir, vercelEnv) {
  const dir = join(outDir, '__qa', 'promotion-emails')
  if (vercelEnv !== 'preview') {
    // Remove this feature's cached artifacts even when the build reuses dist.
    await rm(dir, { recursive: true, force: true })
    return
  }
  await mkdir(dir, { recursive: true })
  for (const [file, email] of [['invitation', invitationEmail()], ['renewal', renewalEmail()]]) {
    const preview = email.html.replace('<head>', '<head><meta name="robots" content="noindex,nofollow">').replace('<table role="presentation"', '<p style="padding:12px;text-align:center;background:#fff4cf;margin:0">EMAIL PREVIEW · Synthetic content · Not sent · Provider unsubscribe token applies to invitation only</p><table role="presentation"')
    await writeFile(join(dir, `${file}.html`), preview)
    // Fixed-width canvas for browser review when viewport emulation is absent.
    // This is a layout sample, not a real mobile email-client test.
    const narrow = preview.replace('<body style="', '<body style="width:390px;max-width:100%;margin:0 auto;')
    await writeFile(join(dir, `${file}-narrow.html`), narrow)
  }
}
