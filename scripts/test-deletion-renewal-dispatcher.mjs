import test from 'node:test'
import assert from 'node:assert/strict'
import {createEmulatorRenewalDispatcher,createGuardedRenewalDispatcher} from '../api/_lib/deletion-renewal-dispatcher.js'
import {createGuardedRenewalQueue} from '../api/_lib/deletion-renewal-queue.js'

const provider=()=>({mode:'isolated-cloud-qa',discover:async()=>assert.fail('unexpected provider IO'),stopRenewal:async()=>assert.fail('unexpected provider IO'),verify:async()=>assert.fail('unexpected provider IO')})
test('dispatcher has no Production mode or unguarded provider configuration',()=>{
  for(const change of [{mode:'production'},{assertRuntime:undefined},{provider:{...provider(),mode:'live'}},{provider:{mode:'isolated-cloud-qa'}},{clock:null}]) {
    assert.throws(()=>createGuardedRenewalDispatcher({mode:'isolated-cloud-qa',provider:provider(),assertRuntime:()=>{},...change}),/RENEWAL_GUARDED_RUNTIME_REQUIRED/)
  }
})
test('asynchronous runtime refusal occurs before database or provider access',async()=>{
  let accessed=0
  const db=new Proxy({}, {get(){accessed++;throw Error('unexpected DB access')}})
  const worker=createGuardedRenewalDispatcher({db,mode:'isolated-cloud-qa',provider:provider(),assertRuntime:async()=>{await Promise.resolve();throw Error('scope revoked')}})
  await assert.rejects(worker.execute({uid:'qa-account',revision:1}),/scope revoked/)
  assert.equal(accessed,0)
})
test('invalid task identifiers fail without constructing database references',async()=>{
  let accessed=0
  const db=new Proxy({}, {get(){accessed++;throw Error('unexpected DB access')}})
  const worker=createGuardedRenewalDispatcher({db,mode:'isolated-cloud-qa',provider:provider(),assertRuntime:async()=>{}})
  for(const input of [{uid:'foreign/path',revision:1},{uid:'qa-account',revision:0},{uid:'qa-account',revision:1.5}])await assert.rejects(worker.execute(input),/RENEWAL_INPUT_INVALID/)
  assert.equal(accessed,0)
})
test('local dispatcher constructor rejects cloud targets before any SDK access',()=>{
  assert.throws(()=>createEmulatorRenewalDispatcher({projectId:'idogs-app',db:{},auth:{},bucket:{},provider:{...provider(),mode:'synthetic'}}),/DELETION_EMULATOR_ONLY/)
})

const manifest=()=>({id:'qa-batch',targets:[{uid:'qa-account',revision:1,acceptedAt:'2026-01-01T00:00:00.000Z'}]})
const queue=options=>createGuardedRenewalQueue({mode:'isolated-cloud-qa',provider:provider(),assertRuntime:async()=>{},manifest:manifest(),...options})
test('queue refuses Production, unbounded, duplicate and invalid revision manifests',()=>{
  for(const options of [{mode:'production'},{manifest:{id:'qa',targets:[]}},{manifest:{id:'qa',targets:Array(51).fill(manifest().targets[0])}},
    {manifest:{...manifest(),targets:Array(2).fill(manifest().targets[0])}},
    {manifest:{...manifest(),targets:[{...manifest().targets[0],revision:0}]}},{provider:{mode:'live'}}])assert.throws(()=>queue(options),/RENEWAL_/)
})
test('queue rejects invalid limits and authority before constructing any database reference',async()=>{
  let accessed=0
  const db=new Proxy({}, {get(){accessed++;throw Error('unexpected DB access')}})
  for(const limit of [0,11,1.5])await assert.rejects(queue({db}).run({limit,executionEnabled:true}),/RENEWAL_QUEUE_LIMIT_INVALID/)
  await assert.rejects(queue({db,assertRuntime:async()=>{throw Error('revoked')}}).run({executionEnabled:true}),/revoked/)
  assert.equal(accessed,0)
})
