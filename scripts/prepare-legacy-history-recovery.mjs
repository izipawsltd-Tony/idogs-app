// Read-only unless --apply-staging explicitly targets the staging project.
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { legacyTransferHistory } from '../api/_lib/ownership-history.js'
import { RECOVERY_COLLECTIONS, makeRecoveredHistory, transferCutoff } from '../api/_lib/legacy-history-recovery.js'
export function ownedMediaPath(raw, bucketName, prefix) {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    let path = null
    if (url.protocol !== 'https:') return null
    if (url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/' + bucketName + '/')) path = decodeURIComponent(url.pathname.slice(bucketName.length + 2))
    if (url.hostname === 'firebasestorage.googleapis.com') {
      const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/)
      if (match && decodeURIComponent(match[1]) === bucketName) path = decodeURIComponent(match[2])
    }
    return path?.startsWith(prefix) && !path.includes('..') ? path : null
  } catch { return null }
}
export async function prepareRecovery({ db, bucket, dogId, fromOwnerId }) {
  const json = v => v?.toDate ? v.toDate().toISOString() : Array.isArray(v) ? v.map(json) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, json(x)])) : v
  const ownAudit = await db.collection('auditLogs').where('tenantId', '==', fromOwnerId).get()
  const audit = legacyTransferHistory(ownAudit.docs.map(d => json({ ...d.data(), id: d.id })), fromOwnerId).find(s => s.dogId === dogId)
  if (!audit) throw Error('NO_OWNER_SCOPED_TRANSFER_EVIDENCE')
  const dog = await db.collection('dogs').doc(dogId).get()
  const data = dog.exists ? dog.data() : {}
  // Caller-owned audit text alone must never authorize reading another
  // dog's history. Cross-check the server-managed ownership boundary.
  const cutoff = dog.exists ? transferCutoff(json(data.transferredAt), audit.transferredAt) : null
  if (!cutoff || ![data.previousOwnerId, data.tenantId].includes(fromOwnerId)) throw Error('TRANSFER_BOUNDARY_MISMATCH')
  const legacy = { ...audit, transferredAt: cutoff }
  const existing = await db.collection('ownershipHistorySnapshots').where('fromOwnerId', '==', fromOwnerId).get()
  if (existing.docs.some(d => d.data().dogId === dogId)) throw Error('HISTORY_ALREADY_EXISTS')
  const records = {}
  for (const collection of RECOVERY_COLLECTIONS) {
    const snap = await db.collection(collection).where('dogId', '==', dogId).get()
    records[collection] = snap.docs.map(d => ({ id: d.id, createTime: d.createTime, updateTime: d.updateTime, data: json(d.data()) }))
  }
  const prefix = `dogs/${fromOwnerId}/${dogId}/`
  const paths = new Set((data.photos || []).map(m => m.path).filter(p => typeof p === 'string' && p.startsWith(prefix)))
  const profilePath = ownedMediaPath(data.profilePhoto, bucket.name, prefix)
  if (profilePath) paths.add(profilePath)
  for (const note of records.activityNotes || []) {
    const path = ownedMediaPath(note.data.photoUrl, bucket.name, prefix)
    if (path) paths.add(path)
  }
  const media = []
  for (const path of paths) {
    const [m] = await bucket.file(path).getMetadata()
    media.push({ path, generation: m.generation, timeCreated: m.timeCreated, updated: m.updated })
  }
  const snapshot = makeRecoveredHistory({ legacy, records, media, recoveredAt: new Date().toISOString() })
  const id = `recovered-${dogId}-${createHash('sha256').update(fromOwnerId + ':' + legacy.transferredAt).digest('hex').slice(0, 16)}`
  return { id, evidence: { auditTransferredAt: audit.transferredAt }, snapshot }
}
export async function applyStagingRecovery({ db, project, plan }) {
  if (project !== 'idogs-app-staging') throw Error('PRODUCTION_WRITES_NOT_SUPPORTED')
  if (db.projectId !== project) throw Error('PROJECT_MISMATCH')
  return db.runTransaction(async tx => {
    const dog = await tx.get(db.collection('dogs').doc(plan.snapshot.dogId))
    const current = dog.exists ? dog.data() : {}
    const time = current.transferredAt?.toDate ? current.transferredAt.toDate().toISOString() : current.transferredAt
    if (![current.previousOwnerId, current.tenantId].includes(plan.snapshot.fromOwnerId)
      || transferCutoff(time, plan.evidence?.auditTransferredAt) !== plan.snapshot.transferredAt) throw Error('TRANSFER_BOUNDARY_MISMATCH')
    const existing = await tx.get(db.collection('ownershipHistorySnapshots').where('fromOwnerId', '==', plan.snapshot.fromOwnerId))
    if (existing.docs.some(d => d.data().dogId === plan.snapshot.dogId)) throw Error('HISTORY_ALREADY_EXISTS')
    tx.create(db.collection('ownershipHistorySnapshots').doc(plan.id), plan.snapshot)
  })
}
async function main() {
  const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1]
  if (!['--project', '--dog', '--former', '--output'].every(key => args.includes(key) && value(key) && !value(key).startsWith('--'))) throw Error('REQUIRED: --project --dog --former --output')
  const project = value('--project')
  if (!['idogs-app', 'idogs-app-staging'].includes(project)) throw Error('PROJECT_NOT_ALLOWED')
  if (args.includes('--apply') || (args.includes('--apply-staging') && project !== 'idogs-app-staging')) throw Error('PRODUCTION_WRITES_NOT_SUPPORTED')
  const { initializeApp, applicationDefault } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  const { getStorage } = await import('firebase-admin/storage')
  const app = initializeApp({ projectId: project, credential: applicationDefault(), storageBucket: project + '.firebasestorage.app' })
  const db = getFirestore(app)
  const plan = await prepareRecovery({ db, bucket: getStorage(app).bucket(), dogId: value('--dog'), fromOwnerId: value('--former') })
  await writeFile(value('--output'), JSON.stringify({ project, ...plan }, null, 2), { flag: 'wx', mode: 0o600 })
  if (args.includes('--apply-staging')) await applyStagingRecovery({ db, project, plan })
  console.log(JSON.stringify({ project, id: plan.id, applied: args.includes('--apply-staging'), counts: Object.fromEntries(RECOVERY_COLLECTIONS.map(c => [c, plan.snapshot[c].length])), photos: plan.snapshot.recoveredMedia.length }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1 })
