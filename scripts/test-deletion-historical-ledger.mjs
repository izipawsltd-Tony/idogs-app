import test from 'node:test'
import assert from 'node:assert/strict'
import {PIN,readHistoricalQaLedger,githubReadApi} from './qa/deletion-historical-ledger.mjs'

function fixture(){
  const run={id:PIN.runId,head_sha:PIN.sourceSha,status:'completed',conclusion:'success',event:'workflow_dispatch',
    path:'.github/workflows/managed-backup-continue.yml',repository:{id:PIN.repositoryId},head_repository:{id:PIN.repositoryId}}
  const artifact={id:PIN.artifactId,name:'managed-backup-manifest',expired:false,digest:`sha256:${PIN.archiveHash}`,size_in_bytes:1844,
    workflow_run:{id:PIN.runId,head_sha:PIN.sourceSha,repository_id:PIN.repositoryId,head_repository_id:PIN.repositoryId,head_branch:'release/ios-app-store-20261025'}}
  const calls=[]
  const readApi=async(path,binary)=>{calls.push(path);if(binary)return Buffer.from('not the authenticated archive');return path.includes('/runs/')?run:artifact}
  return {run,artifact,calls,readApi}
}
test('historical artifact reader is disabled by default and performs no IO',async()=>{
  let called=false
  assert.deepEqual(await readHistoricalQaLedger({readApi:async()=>{called=true}}),{status:'held',code:'historical_ledger_reader_disabled',productionReady:false})
  assert.equal(called,false)
})
test('historical artifact reader requires an explicit transport',async()=>{
  await assert.rejects(readHistoricalQaLedger({executionEnabled:true}),/TRANSPORT_REQUIRED/)
})
for(const change of [{id:1},{head_sha:'0'.repeat(40)},{status:'in_progress'},{conclusion:'failure'},
  {event:'push'},{path:'.github/workflows/other.yml'},{repository:{id:1}},{head_repository:{id:1}}]){
  test(`rejects changed historical run provenance before artifact read: ${JSON.stringify(change)}`,async()=>{
    const f=fixture();Object.assign(f.run,change)
    await assert.rejects(readHistoricalQaLedger({executionEnabled:true,readApi:f.readApi}),/RUN_MISMATCH/)
    assert.equal(f.calls.length,1)
  })
}
for(const change of [{id:1},{name:'backup-content'},{expired:true},{digest:`sha256:${'0'.repeat(64)}`},
  {size_in_bytes:0},{size_in_bytes:3*1024*1024},{size_in_bytes:1843},
  ...[{id:1},{head_sha:'0'.repeat(40)},{repository_id:1},{head_repository_id:1},{head_branch:'main'}].map(w=>({workflow_run:w}))]){
  test(`rejects substituted, expired or unbound artifact before archive read: ${JSON.stringify(change)}`,async()=>{
    const f=fixture()
    if(change.workflow_run)Object.assign(f.artifact.workflow_run,change.workflow_run)
    else Object.assign(f.artifact,change)
    await assert.rejects(readHistoricalQaLedger({executionEnabled:true,readApi:f.readApi}),/ARTIFACT_MISMATCH/)
    assert.equal(f.calls.length,2)
  })
}
test('checks actual archive bytes instead of trusting an asserted artifact digest',async()=>{
  const f=fixture()
  f.readApi=async(path,binary)=>{f.calls.push(path);return binary?Buffer.alloc(PIN.archiveSize):path.includes('/runs/')?f.run:f.artifact}
  await assert.rejects(readHistoricalQaLedger({executionEnabled:true,readApi:f.readApi}),/ARCHIVE_CHANGED/)
  assert.equal(f.calls.length,3)
})
test('GitHub transport refuses arbitrary paths before spawning the CLI',async()=>{
  for(const path of ['https://example.invalid','repos/other/app/actions/runs/1',`repos/${PIN.repo}/actions/runs/${PIN.runId}/rerun`]){
    await assert.rejects(githubReadApi(path),/PATH_FORBIDDEN/)
  }
})
