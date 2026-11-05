import {createHash,randomUUID} from 'node:crypto'
import {validAccountId} from './deletion-fence.js'
import {createGuardedRenewalDispatcher} from './deletion-renewal-dispatcher.js'

const fail=code=>Object.assign(new Error(code),{code})
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
// Internal QA operator only. Never discovers tasks with a collection query and
// never enables a disabled task. The authority must validate EVERY manifest UID.
export function createGuardedRenewalQueue({db,provider,assertRuntime,mode,manifest,clock=Date.now}) {
  if(typeof assertRuntime!=='function'||typeof clock!=='function'
    ||!['prototype-emulator','isolated-cloud-qa'].includes(mode)
    ||!validAccountId(manifest?.id)||!Array.isArray(manifest?.targets)
    ||manifest.targets.length<1||manifest.targets.length>50)throw fail('RENEWAL_QUEUE_MANIFEST_REQUIRED')
  const targets=manifest.targets.map(t=>{
    if(!validAccountId(t.uid)||!Number.isSafeInteger(t.revision)||t.revision<1
      ||typeof t.acceptedAt!=='string'||!Number.isFinite(Date.parse(t.acceptedAt)))throw fail('RENEWAL_QUEUE_TARGET_INVALID')
    return {uid:t.uid,revision:t.revision,acceptedAt:t.acceptedAt}
  })
  if(new Set(targets.map(t=>t.uid)).size!==targets.length)throw fail('RENEWAL_QUEUE_DUPLICATE_TARGET')
  createGuardedRenewalDispatcher({db,provider,assertRuntime,mode,clock}) // validate before any checkpoint write
  const manifestHash=hash([mode,manifest.id,targets]),owner=targets[0]
  let observed=-1
  function now(){const n=clock();if(!Number.isSafeInteger(n)||n<0||n<observed||n>8640000000000000-60000)throw fail('RENEWAL_QUEUE_CLOCK_INVALID');observed=n;return n}
  async function authority(){for(const t of targets)await assertRuntime(t.uid);now()}
  function binding(request,t){if(!request||request.uid!==t.uid||request.revision!==t.revision||request.acceptedAt!==t.acceptedAt||Date.parse(t.acceptedAt)>now())throw fail('RENEWAL_QUEUE_TARGET_CHANGED')}
  function state(request){
    binding(request,owner)
    const q=request.renewalQueue
    if(q!==undefined&&(q.schema!==1||q.manifestHash!==manifestHash||q.mode!==mode
      ||!Number.isSafeInteger(q.cursor)||q.cursor<0||q.cursor>targets.length
      ||!Number.isSafeInteger(q.leaseUntil)||q.leaseUntil<0
      ||!['idle','processing','completed'].includes(q.state)
      ||(q.state==='completed')!==(q.cursor===targets.length)))throw fail('RENEWAL_QUEUE_CHECKPOINT_CHANGED')
    return q
  }
  async function run({limit=5,executionEnabled=false}={}){
    if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw fail('RENEWAL_QUEUE_LIMIT_INVALID')
    await authority()
    if(executionEnabled!==true)return {status:'held',code:'queue_execution_disabled'}
    const ref=db.collection('accountDeletionRequests').doc(owner.uid),epoch=randomUUID()
    const claim=await db.runTransaction(async tx=>{
      await authority()
      const r=(await tx.get(ref)).data(),q=state(r),time=now()
      if(q?.leaseUntil>time)return {status:'busy'}
      const cursor=q?.cursor||0
      tx.update(ref,{renewalQueue:{schema:1,manifestHash,mode,cursor,epoch,leaseUntil:time+60000,state:cursor===targets.length?'completed':'processing'}})
      return {cursor}
    })
    if(claim.status)return claim
    let cursor=claim.cursor
    async function owned(tx){
      await authority()
      const q=state((await tx.get(ref)).data())
      if(q?.epoch!==epoch||q.leaseUntil<=now()||q.cursor!==cursor)throw fail('RENEWAL_QUEUE_STALE_ATTEMPT')
      return q
    }
    const assertOwned=async uid=>{
      const t=targets.find(t=>t.uid===uid)
      if(!t)throw fail('RENEWAL_QUEUE_SCOPE_REQUIRED')
      await db.runTransaction(async tx=>{await owned(tx);binding((await tx.get(db.collection('accountDeletionRequests').doc(uid))).data(),t)})
    }
    const dispatcher=createGuardedRenewalDispatcher({db,provider,assertRuntime:assertOwned,mode,clock})
    // Recover a lost queue acknowledgement by validating the task's durable
    // receipt. A checkpoint alone cannot establish that billing completed.
    async function execute(t,receiptOnly=false){
      await assertOwned(t.uid)
      const request=(await db.collection('accountDeletionRequests').doc(t.uid).get()).data();binding(request,t)
      if(receiptOnly){const task=(await db.collection('accountDeletionRenewalTasks').doc(`${t.uid}_${t.revision}`).get()).data();if(task?.dispatchState!=='completed')throw fail('RENEWAL_QUEUE_RECEIPT_MISSING')}
      return dispatcher.execute({uid:t.uid,revision:t.revision})
    }
    try {
      for(let i=0;i<cursor;i++)if((await execute(targets[i],true)).status!=='completed')throw fail('RENEWAL_QUEUE_RECEIPT_MISSING')
      const end=Math.min(cursor+limit,targets.length)
      while(cursor<end){
        const result=await execute(targets[cursor])
        if(result.status!=='completed'){
          await db.runTransaction(async tx=>{const q=await owned(tx);tx.update(ref,{renewalQueue:{...q,state:'idle',leaseUntil:0}})})
          return {status:'blocked',cursor,total:targets.length,taskStatus:result.status}
        }
        await db.runTransaction(async tx=>{const q=await owned(tx),next=cursor+1;tx.update(ref,{renewalQueue:{...q,cursor:next,state:next===targets.length?'completed':'processing',leaseUntil:now()+60000}})})
        cursor++
      }
      await db.runTransaction(async tx=>{const q=await owned(tx);tx.update(ref,{renewalQueue:{...q,state:cursor===targets.length?'completed':'idle',leaseUntil:0}})})
      return {status:cursor===targets.length?'completed':'page_completed',cursor,total:targets.length}
    } catch(error){
      // Do not advance a cursor or overwrite a replacement lease on failure.
      // Its expiry permits a new operator to recover using per-task receipts.
      throw error
    }
  }
  return {run,mode}
}
