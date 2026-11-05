import {describe,it,expect,vi} from 'vitest'
import {sendSmsWithQuota} from '../api/_lib/sms-addon.js'
import {sendClickSendSms} from '../api/_lib/clicksend-sms.js'

class Store {
 constructor(profile){this.tables={users:{qa:structuredClone(profile)},smsDeliveries:{}}}
 collection(table){return {doc:id=>({table,id})}}
 async runTransaction(run){
  const ops=[]
  const tx={
   get:async ref=>{const value=this.tables[ref.table]?.[ref.id];return {exists:value!==undefined,data:()=>structuredClone(value)}},
   set:(ref,data,{merge}={})=>ops.push({ref,data:structuredClone(data),merge})
  }
  const out=await run(tx)
  for(const o of ops){this.tables[o.ref.table]||={};this.tables[o.ref.table][o.ref.id]=
    o.merge?{...this.tables[o.ref.table][o.ref.id],...o.data}:o.data}
  return out
 }
}
const now=new Date('2026-10-23T11:00:00.000Z')
const profile=()=>({smsAddonStatus:'active',smsCreditsUsed:0,smsCreditsLimit:20,
 smsPeriodStart:'2026-10-01T00:00:00.000Z',smsPeriodEnd:'2026-11-01T00:00:00.000Z'})
const env={CLICKSEND_USERNAME:'synthetic',CLICKSEND_API_KEY:'synthetic'}
const request=(id,sendProvider)=>({db:id.db,tenantId:'qa',phone:'+61412345678',
 message:'iDogs vaccination reminder QA',eventType:'vaccine',
 sourceRecordId:'record-synthetic',milestoneKey:'2026-10-23',
 idempotencyKey:id.key,sendProvider,now})
describe('Staging preflight: reminder quota + ClickSend mock (never live)',()=>{
 it('queues one reminder, debits exactly one segment and prevents identical retry',async()=>{
   const db=new Store(profile())
   const fetchImpl=vi.fn().mockResolvedValue({ok:true,json:async()=>({
    response_code:'SUCCESS',data:{queued_count:1,blocked_count:0,
     messages:[{message_id:'synthetic-message-id',status:'SUCCESS'}]}})})
   const sendProvider=(phone,msg)=>sendClickSendSms(phone,msg,{env,fetchImpl})
   const first=await sendSmsWithQuota(request({db,key:'unique-reminder'},sendProvider))
   expect(first.sent).toBe(true)
   expect(db.tables.users.qa.smsCreditsUsed).toBe(1)
   expect(fetchImpl).toHaveBeenCalledTimes(1)
   expect(fetchImpl.mock.calls[0][1].method).toBe('POST')
   const second=await sendSmsWithQuota(request({db,key:'unique-reminder'},sendProvider))
   expect(second.sent).toBe(false)
   expect(second.reason).toBe('DUPLICATE')
   expect(db.tables.users.qa.smsCreditsUsed).toBe(1)
   expect(fetchImpl).toHaveBeenCalledTimes(1)
 })
 it('rejects reminder before provider when quota is exhausted',async()=>{
   const db=new Store({...profile(),smsCreditsUsed:20})
   const sendProvider=vi.fn()
   const result=await sendSmsWithQuota(request({db,key:'quota-full'},sendProvider))
   expect(result).toMatchObject({sent:false,reason:'SMS_QUOTA_EXHAUSTED'})
   expect(sendProvider).not.toHaveBeenCalled()
   expect(db.tables.users.qa.smsCreditsUsed).toBe(20)
 })
 it('does not refund or resend on ambiguous ClickSend timeout',async()=>{
   const db=new Store(profile())
   const fetchImpl=vi.fn().mockRejectedValue(new Error('synthetic timeout'))
   const sendProvider=(phone,msg)=>sendClickSendSms(phone,msg,{env,fetchImpl})
   const first=await sendSmsWithQuota(request({db,key:'timeout'},sendProvider))
   expect(first).toMatchObject({sent:false,reason:'PROVIDER_OUTCOME_UNKNOWN',reconciliationRequired:true})
   expect(db.tables.users.qa.smsCreditsUsed).toBe(1)
   const second=await sendSmsWithQuota(request({db,key:'timeout'},sendProvider))
   expect(second.reason).toBe('DUPLICATE')
   expect(fetchImpl).toHaveBeenCalledTimes(1)
 })
 it('definitive provider failure refunds and cannot count a delivered message',async()=>{
   const db=new Store(profile())
   const fetchImpl=vi.fn().mockResolvedValue({ok:true,json:async()=>({
     response_code:'SUCCESS',data:{queued_count:0,blocked_count:1,
      messages:[{status:'INVALID_SENDER_ID'}]}})})
   const sendProvider=(phone,msg)=>sendClickSendSms(phone,msg,{env,fetchImpl})
   const first=await sendSmsWithQuota(request({db,key:'rejected'},sendProvider))
   expect(first).toMatchObject({sent:false,reason:'PROVIDER_REJECTED'})
   expect(db.tables.users.qa.smsCreditsUsed).toBe(0)
 })
})
