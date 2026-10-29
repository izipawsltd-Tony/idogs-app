import test from 'node:test'
import assert from 'node:assert/strict'
import {createEmulatorRenewalDispatcher,createGuardedRenewalDispatcher} from '../api/_lib/deletion-renewal-dispatcher.js'

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
