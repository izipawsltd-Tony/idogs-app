import {describe,it,expect,vi} from 'vitest'
import {getClickSendDeliveryStatus,findOwnerQaSmsInClickSendHistory} from '../api/_lib/clicksend-delivery-status.js'
const env={CLICKSEND_USERNAME:'synthetic',CLICKSEND_API_KEY:'synthetic'}
const id='12345678-aaaa-bbbb'
const mock=body=>({ok:true,json:async()=>body})
describe('read-only ClickSend queued message reconciliation',()=>{
 it('never makes a request without provider secrets',async()=>{
   const fetchImpl=vi.fn()
   expect((await getClickSendDeliveryStatus(id,{env:{},fetchImpl})).status).toBe('CONFIG_MISSING')
   expect(fetchImpl).not.toHaveBeenCalled()
 })
 it('reads delivered receipt without sending',async()=>{
   const fetchImpl=vi.fn().mockResolvedValue(mock({response_code:'SUCCESS',data:{message_id:id,status_code:'201'}}))
   expect((await getClickSendDeliveryStatus(id,{env,fetchImpl})).status).toBe('DELIVERED')
   expect(fetchImpl).toHaveBeenCalledTimes(1)
   expect(fetchImpl.mock.calls[0][1].method).toBe('GET')
 })
 it('uses read-only history when receipt unavailable',async()=>{
   const fetchImpl=vi.fn().mockResolvedValueOnce({ok:false,status:404})
      .mockResolvedValueOnce(mock({response_code:'SUCCESS',data:{data:[{message_id:id,status:'Sent',status_code:'200',from:'iDogs'}]}}))
   const result=await getClickSendDeliveryStatus(id,{env,fetchImpl})
   expect(result).toMatchObject({status:'PENDING',source:'HISTORY',senderMatch:true})
   expect(fetchImpl.mock.calls.every(call=>call[1].method==='GET')).toBe(true)
 })
 it('does not claim delivered for another message ID',async()=>{
   const fetchImpl=vi.fn().mockResolvedValueOnce(mock({response_code:'SUCCESS',data:{message_id:'someone-else',status_code:'201'}}))
     .mockResolvedValueOnce(mock({response_code:'SUCCESS',data:{data:[]}}))
   expect((await getClickSendDeliveryStatus(id,{env,fetchImpl})).status).toBe('NOT_FOUND_IN_RECENT_HISTORY')
 })
})

describe('read-only recovery of one prior owner-approved SMS',()=>{
 const qa={direction:'out',date:1792713600,from:'iDogs',body:'iDogs QA: test of registered Sender ID iDogs. No action required.',message_id:id,status:'Sent',status_code:'201'}
 it('identifies the exact approved message without POST',async()=>{
   const fetchImpl=vi.fn().mockResolvedValue(mock({response_code:'SUCCESS',data:[qa]}))
   const result=await findOwnerQaSmsInClickSendHistory({env,fetchImpl})
   expect(result).toMatchObject({status:'DELIVERED',source:'HISTORY_FALLBACK',lockFound:false})
   expect(fetchImpl.mock.calls[0][1].method).toBe('GET')
   expect(JSON.stringify(result)).not.toContain(qa.body)
 })
 it('does not mistake a message for another sender as the approved one',async()=>{
   const fetchImpl=vi.fn().mockResolvedValue(mock({response_code:'SUCCESS',data:[{...qa,from:'Other'}]}))
   expect((await findOwnerQaSmsInClickSendHistory({env,fetchImpl})).status).toBe('NOT_FOUND_IN_RECENT_HISTORY')
 })
 it('never reports one match when history contains duplicate QA sends',async()=>{
   const fetchImpl=vi.fn().mockResolvedValue(mock({response_code:'SUCCESS',data:[qa,{...qa,message_id:'different-id'}]}))
   expect((await findOwnerQaSmsInClickSendHistory({env,fetchImpl})).status).toBe('MULTIPLE_QA_MATCHES')
 })
})
