// GET-only metadata audit. No document/object reads, writes, backup creation or IAM changes.
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { cert } from 'firebase-admin/app'
const report = {checkedAt:new Date().toISOString(), source:process.env.GITHUB_SHA || 'local', mode:'READ_ONLY_METADATA', project:'idogs-app', evidence:{}, limitations:[
  'Metadata does not prove successful restoration or removal of personal data from all backups.',
  'No IAM, Rules, Storage, environment, TTL, retention, schedule or provider setting is changed.',
  'External provider contractual retention and operator/offline exports remain unverified.',
]}
let token
const record = (name, value) => {report.evidence[name] = value}
async function get(url) {
  const response = await fetch(url,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)})
  if (!response.ok) return {status:response.status,verified:false}
  return {status:200,verified:true,data:await response.json()}
}
async function inspect(name,url,select) {
  try { const r=await get(url); record(name,r.verified?{verified:true,...select(r.data)}:{verified:false,httpStatus:r.status}) }
  catch {record(name,{verified:false,reason:'metadata_request_failed'})}
}
try {
  if (!process.env.VERCEL_TOKEN) throw new Error('connection_unavailable')
  const config = await fetch('https://api.vercel.com/v10/projects/prj_UsnGhC1BWtYnmF5rKMYBR9KWkbIo/env?teamId=team_oZF1Z0BUEceb9fAXdmFV1Saz&decrypt=true&target=production', {
    method:'GET', headers:{Authorization:`Bearer ${process.env.VERCEL_TOKEN}`}, redirect:'error', signal:AbortSignal.timeout(15000)
  })
  if (!config.ok) {record('productionConfig',{verified:false,httpStatus:config.status});throw new Error('config_unavailable')}
  const raw = await config.json(), env = {}
  const allowed = new Set(['FIREBASE_PROJECT_ID','FIREBASE_STORAGE_BUCKET','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY'])
  for (const item of raw.envs || []) if (allowed.has(item.key) && item.target?.includes('production') && !item.gitBranch) env[item.key]=item.value
  // Only the existing project's four Firebase variables are used in memory.
  // No raw values, env files or tokens are printed, persisted or uploaded.
  if (env.FIREBASE_PROJECT_ID !== 'idogs-app' || env.FIREBASE_STORAGE_BUCKET !== 'idogs-app.firebasestorage.app') throw new Error('wrong_identity')
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) throw new Error('credentials_unavailable')
  const credential=cert({projectId:env.FIREBASE_PROJECT_ID,clientEmail:env.FIREBASE_CLIENT_EMAIL,privateKey:env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,'\n')})
  token=(await credential.getAccessToken()).access_token
  const database='https://firestore.googleapis.com/v1/projects/idogs-app/databases/(default)'
  await inspect('firestoreDatabase',database,d=>({locationId:d.locationId,type:d.type,
    pointInTimeRecoveryEnablement:d.pointInTimeRecoveryEnablement || 'UNSPECIFIED',
    versionRetentionPeriod:d.versionRetentionPeriod || null,earliestVersionTime:d.earliestVersionTime || null,deleteProtectionState:d.deleteProtectionState || 'UNSPECIFIED'}))
  await inspect('firestoreBackupSchedules',database+'/backupSchedules',d=>({schedules:(d.backupSchedules||[]).map(s=>({retention:s.retention,daily:!!s.dailyRecurrence,weekly:s.weeklyRecurrence?.day || null}))}))
  await inspect('firestoreBackups','https://firestore.googleapis.com/v1/projects/idogs-app/locations/-/backups',d=>({paginationComplete:!d.nextPageToken,
    backups:(d.backups||[]).filter(b=>b.database==='projects/idogs-app/databases/(default)').map(b=>({state:b.state,snapshotTime:b.snapshotTime,expireTime:b.expireTime})),
    unreachableLocations:d.unreachable || []}))
  await inspect('storageBucket','https://storage.googleapis.com/storage/v1/b/idogs-app.firebasestorage.app?projection=noAcl',d=>({location:d.location,locationType:d.locationType,
    retentionPolicy:d.retentionPolicy?{retentionPeriod:d.retentionPolicy.retentionPeriod,isLocked:d.retentionPolicy.isLocked}:null,
    softDeletePolicy:d.softDeletePolicy || null,versioningEnabled:d.versioning?.enabled === true,
    lifecycleRules:(d.lifecycle?.rule||[]).map(r=>({action:r.action?.type,age:r.condition?.age,daysSinceNoncurrentTime:r.condition?.daysSinceNoncurrentTime,isLive:r.condition?.isLive})),
    lifecycleClassification:'metadata_only_no_guarantee_of_all_copies_removed'}))
  for (const [label,release] of [['firestoreRules','cloud.firestore'],['storageRules','firebase.storage/idogs-app.firebasestorage.app']]) {
    try {
      const r=await get('https://firebaserules.googleapis.com/v1/projects/idogs-app/releases/'+release)
      if (!r.verified) {record(label,{verified:false,httpStatus:r.status});continue}
      if (!/^projects\/idogs-app\/rulesets\/[a-zA-Z0-9-]+$/.test(r.data.rulesetName || '')) throw new Error('identity')
      const rules=await get('https://firebaserules.googleapis.com/v1/'+r.data.rulesetName)
      if (!rules.verified) {record(label,{verified:false,httpStatus:rules.status});continue}
      const content=(rules.data.source?.files||[]).map(f=>f.content).join('\n')
      record(label,{verified:true,sha256:createHash('sha256').update(content).digest('hex'),
        deletionFenceReferencePresent:/accountDeletionFences/.test(content),
        deletionRequestReferencePresent:/accountDeletionRequests/.test(content),
        enforcement:'UNVERIFIED_reference_detection_is_not_authorization_proof'})
    } catch {record(label,{verified:false,reason:'rules_metadata_unavailable'})}
  }
} catch {record('credentials',{verified:false,reason:'existing_credentials_missing_or_wrong_project_or_authentication_failed'})}
finally {token=undefined;await writeFile('retention-backup-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))}
