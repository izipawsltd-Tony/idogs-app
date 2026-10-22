// Offline only. No SDK, environment secrets, database or network access.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { invitationEmail, renewalEmail, audienceDryRun } from './lib/promotion-emails.js'

const [command, input] = process.argv.slice(2)
if (command === 'render' && input) {
  const dir = resolve(input)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  for (const [name, email] of [['invitation', invitationEmail()], ['renewal', renewalEmail()]]) {
    for (const format of ['html', 'text']) await writeFile(join(dir, `${name}.${format === 'text' ? 'txt' : format}`), email[format], { flag: 'wx', mode: 0o600 })
  }
  console.log('Rendered two review-only emails. No emails sent; renewal remains Stripe native.')
} else if (command === 'audit' && input) {
  const rows = JSON.parse(await readFile(resolve(input), 'utf8'))
  console.log(JSON.stringify(audienceDryRun(rows), null, 2))
} else {
  console.error('Usage: node scripts/promotion-email-pack.mjs render <new-private-directory> | audit <private-snapshot.json>')
  process.exitCode = 1
}
