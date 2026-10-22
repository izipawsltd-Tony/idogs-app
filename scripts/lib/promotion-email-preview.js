import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { invitationEmail, renewalEmail } from './promotion-emails.js'

export async function writeEmailPreviews(outDir, vercelEnv) {
  if (vercelEnv !== 'preview') return
  const dir = join(outDir, '__qa', 'promotion-emails')
  await mkdir(dir, { recursive: true })
  for (const [file, email] of [['invitation', invitationEmail()], ['renewal', renewalEmail()]]) {
    const preview = email.html.replace('<head>', '<head><meta name="robots" content="noindex,nofollow">').replace('<table role="presentation"', '<p style="padding:12px;text-align:center;background:#fff4cf;margin:0">EMAIL PREVIEW · Synthetic content · Not sent · Provider unsubscribe token applies to invitation only</p><table role="presentation"')
    await writeFile(join(dir, `${file}.html`), preview)
  }
}
