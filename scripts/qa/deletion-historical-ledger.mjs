import {createHash} from 'node:crypto'
import {inflateRawSync} from 'node:zlib'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {pathToFileURL} from 'node:url'

// Reviewed, completed QA artifact only. This is not a current/live deletion
// history reader and cannot authorize account activation or a new restore.
export const PIN=Object.freeze({repo:'izipawsltd-Tony/idogs-app',runId:40671427781,artifactId:12809300074,
  sourceSha:'1fa8549b0f4aa145bdd686bc68f6726d2009eb75',repositoryId:1270695712,archiveSize:1844,
  archiveHash:'ee52e9b242073636e3f0e161ac0371b49623c3a7c8ba67946853401aa5727c11',
  sourceUid:'e9cbde7b-2372-47eb-9000-1ccb7baf6ecf',destinationUid:'7bfd4493-b0ae-4429-8861-3779aec1a253',
  nonce:'28944b70-51c1-401e-94f6-3a1e7692a60f'})
const ensure=(ok,code)=>{if(!ok)throw Error(code)}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const jsonHash=value=>hash(JSON.stringify(value))

// Bounded single-file ZIP decoder. Never extracts archive paths onto disk.
function manifestFromArchive(bytes){
  ensure(Buffer.isBuffer(bytes)&&bytes.length===PIN.archiveSize,'HISTORICAL_LEDGER_ARCHIVE_INVALID')
  ensure(hash(bytes)===PIN.archiveHash,'HISTORICAL_LEDGER_ARCHIVE_CHANGED')
  let end=-1
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break}
  ensure(end>=0,'HISTORICAL_LEDGER_ZIP_INVALID')
  const count=bytes.readUInt16LE(end+10),central=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12)
  ensure(bytes.readUInt16LE(end+4)===0&&bytes.readUInt16LE(end+6)===0&&bytes.readUInt16LE(end+8)===1&&count===1
    &&central+size===end&&central+46<=end,'HISTORICAL_LEDGER_ZIP_INVALID')
  ensure(bytes.readUInt32LE(central)===0x02014b50,'HISTORICAL_LEDGER_ZIP_INVALID')
  const flags=bytes.readUInt16LE(central+8),method=bytes.readUInt16LE(central+10),compressed=bytes.readUInt32LE(central+20),plain=bytes.readUInt32LE(central+24)
  const nameSize=bytes.readUInt16LE(central+28),extra=bytes.readUInt16LE(central+30),comment=bytes.readUInt16LE(central+32),local=bytes.readUInt32LE(central+42)
  ensure(!(flags&1)&&[0,8].includes(method)&&plain>0&&plain<=1024*1024&&compressed<=1024*1024
    &&central+46+nameSize+extra+comment===end&&local+30<=central,'HISTORICAL_LEDGER_ZIP_INVALID')
  const name=bytes.subarray(central+46,central+46+nameSize).toString('utf8')
  ensure(name==='managed-backup-manifest.json'&&bytes.readUInt32LE(local)===0x04034b50
    &&bytes.readUInt16LE(local+6)===flags&&bytes.readUInt16LE(local+8)===method,'HISTORICAL_LEDGER_ZIP_INVALID')
  const localNameSize=bytes.readUInt16LE(local+26),start=local+30+localNameSize+bytes.readUInt16LE(local+28)
  ensure(localNameSize===nameSize&&bytes.subarray(local+30,local+30+localNameSize).toString('utf8')===name&&start+compressed<=central,'HISTORICAL_LEDGER_ZIP_INVALID')
  const payload=bytes.subarray(start,start+compressed),decoded=method===8?inflateRawSync(payload,{maxOutputLength:1024*1024}):payload
  ensure(decoded.length===plain,'HISTORICAL_LEDGER_ZIP_INVALID')
  return JSON.parse(decoded.toString('utf8'))
}

export async function readHistoricalQaLedger({executionEnabled=false,readApi}={}){
  if(executionEnabled!==true)return {status:'held',code:'historical_ledger_reader_disabled',productionReady:false}
  ensure(typeof readApi==='function','HISTORICAL_LEDGER_TRANSPORT_REQUIRED')
  const prefix=`repos/${PIN.repo}/actions`,run=await readApi(`${prefix}/runs/${PIN.runId}`)
  ensure(run?.id===PIN.runId&&run.head_sha===PIN.sourceSha&&run.status==='completed'&&run.conclusion==='success'
    &&run.event==='workflow_dispatch'&&run.path==='.github/workflows/managed-backup-continue.yml'
    &&run.repository?.id===PIN.repositoryId&&run.head_repository?.id===PIN.repositoryId,'HISTORICAL_LEDGER_RUN_MISMATCH')
  const artifact=await readApi(`${prefix}/artifacts/${PIN.artifactId}`),w=artifact?.workflow_run
  ensure(artifact?.id===PIN.artifactId&&artifact.name==='managed-backup-manifest'&&artifact.expired===false
    &&artifact.digest===`sha256:${PIN.archiveHash}`&&artifact.size_in_bytes===PIN.archiveSize
    &&w?.id===PIN.runId&&w.head_sha===PIN.sourceSha&&w.repository_id===PIN.repositoryId&&w.head_repository_id===PIN.repositoryId
    &&w.head_branch==='release/ios-app-store-20261025','HISTORICAL_LEDGER_ARTIFACT_MISMATCH')
  const m=manifestFromArchive(await readApi(`${prefix}/artifacts/${PIN.artifactId}/zip`,true))
  const ledger={independentOfRestore:true,complete:true,revision:PIN.nonce,accounts:[{uid:'qa-deleted',revision:1,state:'completed',retained:[]}]}
  ensure(m.schema===1&&m.ownerApproval==='2026-10-28-two-databases-one-backup'&&m.projectId==='idogs-app-staging'
    &&m.source==='idogs-deletion-backup-qa'&&m.destination==='idogs-deletion-restore-qa'&&m.nonce===PIN.nonce
    &&m.sourceUid===PIN.sourceUid&&m.destinationUid===PIN.destinationUid&&m.cleanupVerified===true
    &&m.replayReceipt?.sourceUid===PIN.sourceUid&&m.replayReceipt.destinationUid===PIN.destinationUid
    &&m.replayReceipt.managedBackupRestoreVerified===true&&m.replayReceipt.managedBackupResurrectionBlocked===true
    &&jsonHash(m.ledger)===jsonHash(ledger),'HISTORICAL_LEDGER_MANIFEST_MISMATCH')
  // No freshness assertion: an authenticated old artifact can still omit later
  // accepted deletions. It must never become the live authority by default.
  return {status:'historical_artifact_verified',historicalOnly:true,freshnessVerified:false,productionReady:false,
    ledger:structuredClone(ledger),provenance:{repo:PIN.repo,runId:PIN.runId,artifactId:PIN.artifactId,sourceSha:PIN.sourceSha,archiveHash:PIN.archiveHash}}
}

export async function githubReadApi(path,binary=false){
  ensure(new RegExp(`^repos/${PIN.repo}/actions/(runs/${PIN.runId}|artifacts/${PIN.artifactId}(/zip)?)$`).test(path),'HISTORICAL_LEDGER_PATH_FORBIDDEN')
  try{
    const {stdout}=await promisify(execFile)('gh',['api',path],{encoding:'buffer',maxBuffer:2*1024*1024,timeout:20000,windowsHide:true})
    return binary?stdout:JSON.parse(stdout.toString('utf8'))
  }catch{throw Error('HISTORICAL_LEDGER_READ_UNAVAILABLE')}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const result=await readHistoricalQaLedger({executionEnabled:process.argv[2]==='--read-approved-artifact',readApi:githubReadApi})
    const {ledger,...safe}=result;console.log(JSON.stringify({...safe,...(ledger?{checkedAccounts:ledger.accounts.length}:{})},null,2))
  }catch(error){console.error(error.message?.startsWith('HISTORICAL_LEDGER_')?error.message:'HISTORICAL_LEDGER_REJECTED');process.exitCode=1}
}
