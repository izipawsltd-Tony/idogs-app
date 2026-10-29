import {digest} from './deletion-plan.js'
import {scopedDeletionRequestBinding} from './deletion-independent-ledger.js'

const permits=new WeakMap()
const ensure=(ok)=>{if(!ok)throw Object.assign(Error('DELETION_INTAKE_PERMIT_INVALID'),{code:'DELETION_INTAKE_PERMIT_INVALID'})}
// Server-memory capability only. JSON, stored source metadata or a restored
// request cannot mint this permit. The factory remains emulator guarded.
export function makeEmulatorIntakePermit({db,ledger,intent}){
  ledger.assertRuntime()
  ensure(intent.state==='dispatching'&&ledger.scope.uid===intent.uid&&ledger.scope.nonce===intent.nonce&&/^[a-f0-9]{64}$/.test(intent.hash)
    &&/^[a-f0-9]{64}$/.test(intent.requestHash)&&db.projectId==='demo-idogs-deletion'&&db.databaseId==='(default)')
  const permit=Object.freeze({})
  permits.set(permit,{db,ledger,intent:structuredClone(intent)})
  return permit
}
export function applyEmulatorIntakePermit({permit,db,tx,previous,next}){
  const p=permits.get(permit);ensure(p&&p.db===db)
  p.ledger.assertRuntime();const i=p.intent
  ensure(!previous&&next.uid===i.uid&&digest(scopedDeletionRequestBinding(next,i.uid))===i.requestHash)
  const marker={schema:1,uid:i.uid,nonce:i.nonce,intentHash:i.hash,requestHash:i.requestHash}
  tx.create(db.doc(`accountMutationLeases/intake_${i.nonce}`),{uids:[i.uid],operation:'emulator-deletion-intake',state:'active',startedAt:next.requestedAt,intake:marker})
  return marker
}
