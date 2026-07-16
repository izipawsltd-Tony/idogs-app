/**
 * copy-prod-to-staging.mjs
 * One-way Firestore copy: PRODUCTION (idogs-app) → STAGING (idogs-app-staging)
 *
 * Usage:
 *   node scripts/copy-prod-to-staging.mjs            # dry-run (default, safe)
 *   node scripts/copy-prod-to-staging.mjs --execute  # write to staging
 *
 * SAFETY RULES:
 *   - Hard project-ID guards immediately after loading credentials (see below).
 *     DO NOT REMOVE these guards — they are the only thing preventing an
 *     accidental overwrite of production data.
 *   - Docs already in staging that are NOT in production are left untouched
 *     (staging test dogs / test accounts are preserved).
 *   - This script NEVER writes to production under any circumstances.
 */

import { readFileSync } from 'fs'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ── Credential paths ──────────────────────────────────────────────────────────

const SOURCE_SA_PATH = 'C:\\Users\\Tom\\Downloads\\idogs-app-firebase-adminsdk-fbsvc-d1ce2cdadc.json'  // idogs-app
const DEST_SA_PATH   = 'C:\\Users\\Tom\\Downloads\\idogs-app-staging-firebase-adminsdk-fbsvc-aaa7042ec9.json'

// ── Load & parse ──────────────────────────────────────────────────────────────

const sourceJson = JSON.parse(readFileSync(SOURCE_SA_PATH, 'utf8'))
const destJson   = JSON.parse(readFileSync(DEST_SA_PATH,   'utf8'))

// ── HARD GUARDS — DO NOT REMOVE ───────────────────────────────────────────────
// These guards are the last line of defence against copying in the wrong
// direction and overwriting production data.  Removing them would make it
// trivially easy to silently destroy live user data.
if (sourceJson.project_id !== 'idogs-app') {
  throw new Error(`SOURCE project_id must be 'idogs-app', got '${sourceJson.project_id}'`)
}
if (destJson.project_id !== 'idogs-app-staging') {
  throw new Error(`DEST project_id must be 'idogs-app-staging', got '${destJson.project_id}'`)
}
// ── END HARD GUARDS ───────────────────────────────────────────────────────────

// ── Firebase init ─────────────────────────────────────────────────────────────

const sourceApp = initializeApp({ credential: cert(sourceJson) }, 'source')
const destApp   = initializeApp({ credential: cert(destJson)   }, 'dest')

const sourceDb = getFirestore(sourceApp)
const destDb   = getFirestore(destApp)

// ── Flags ─────────────────────────────────────────────────────────────────────

const DRY_RUN = !process.argv.includes('--execute')

// ── Core copy logic ───────────────────────────────────────────────────────────

/**
 * Recursively copy all docs (and their subcollections) from a source
 * CollectionReference to the equivalent path on the dest database.
 *
 * @param {FirebaseFirestore.CollectionReference} srcCol
 * @param {FirebaseFirestore.Firestore}           destDb
 * @param {boolean}                               dryRun
 * @param {Map<string, number>}                   tally   collection path → doc count
 */
async function copyCollection(srcCol, destDb, dryRun, tally) {
  const snap = await srcCol.get()
  if (snap.empty) return

  const colPath = srcCol.path
  tally.set(colPath, (tally.get(colPath) ?? 0) + snap.size)

  for (const srcDoc of snap.docs) {
    if (!dryRun) {
      const destDocRef = destDb.doc(srcDoc.ref.path)
      await destDocRef.set(srcDoc.data())   // set = upsert by ID, preserves other DEST docs
    }

    // Recurse into subcollections
    const subCols = await srcDoc.ref.listCollections()
    for (const subCol of subCols) {
      await copyCollection(subCol, destDb, dryRun, tally)
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('')
  console.log('=================================================================')
  console.log(`  Firestore copy: idogs-app  →  idogs-app-staging`)
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : '*** EXECUTE — writing to staging ***'}`)
  console.log('=================================================================')
  console.log('')

  const rootCols = await sourceDb.listCollections()
  const tally    = new Map()   // colPath → doc count

  for (const col of rootCols) {
    process.stdout.write(`  Scanning ${col.id} ...`)
    await copyCollection(col, destDb, DRY_RUN, tally)
    process.stdout.write('\r')   // overwrite the scanning line in execute mode
    if (!DRY_RUN) {
      const count = tally.get(col.path) ?? 0
      console.log(`  ✓  ${col.id.padEnd(28)} ${String(count).padStart(5)} docs`)
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────

  if (DRY_RUN) {
    console.log('  DRY-RUN summary — nothing was written:\n')
    console.log('  Collection'.padEnd(36) + 'Docs')
    console.log('  ' + '─'.repeat(44))

    let total = 0
    for (const [colPath, count] of [...tally.entries()].sort()) {
      const indent = '  ' + '  '.repeat(colPath.split('/').length - 1)
      const label  = colPath.split('/').pop()
      console.log(`${indent}${label.padEnd(36 - indent.length + 2)}${String(count).padStart(5)}`)
      // Only count root-level collections in the total to avoid double-counting
      if (!colPath.includes('/')) total += count
    }

    console.log('  ' + '─'.repeat(44))
    console.log(`  ${'TOTAL (root docs)'.padEnd(36)}${String(total).padStart(5)}`)
    console.log('')
    console.log('  To write to staging, re-run with:')
    console.log('  node scripts/copy-prod-to-staging.mjs --execute')
  } else {
    let total = 0
    for (const [colPath, count] of tally.entries()) {
      if (!colPath.includes('/')) total += count
    }
    console.log('')
    console.log(`  Done. ${total} root-level docs copied to idogs-app-staging.`)
    console.log('  Staging-only docs (test accounts, test dogs) were NOT deleted.')
  }

  console.log('')
}

main().catch(err => {
  console.error('\n  ERROR:', err.message)
  process.exit(1)
})
