import { describe, it, expect, vi } from 'vitest'
import { sendClickSendSms } from '../api/_lib/clicksend-sms.js'
const env={CLICKSEND_USERNAME:'fake',CLICKSEND_API_KEY:'fake'}
const phone='+61412345678'
const make=(data,ok=true)=>vi.fn().mockResolvedValue({ok,json:async()=>data})
describe('ClickSend dry-run transport contract',()=>{
 it('rejects absent credentials before network',async()=>{const f=vi.fn();await expect(sendClickSendSms(phone,'hi',{env:{},fetchImpl:f})).rejects.toThrow();expect(f).not.toHaveBeenCalled()})
 it('builds approved iDogs sender request',async()=>{const f=make({response_code:'SUCCESS',data:{queued_count:1,blocked_count:0,messages:[{message_id:'synthetic',status:'SUCCESS'}]}});const v=await sendClickSendSms(phone,'QA',{env,fetchImpl:f});expect(v.MessageId).toBe('synthetic');const [url,p]=f.mock.calls[0];expect(url).toBe('https://rest.clicksend.com/v3/sms/send');expect(JSON.parse(p.body).messages[0].from).toBe('iDogs')})
 it('fails closed on HTTP 200 containing message failure',async()=>{const f=make({response_code:'SUCCESS',data:{queued_count:0,blocked_count:1,messages:[{status:'INVALID_SENDER_ID'}]}});await expect(sendClickSendSms(phone,'QA',{env,fetchImpl:f})).rejects.toThrow()})
 it('marks a network timeout ambiguous, preventing automatic retry',async()=>{
   const f=vi.fn().mockRejectedValue(new Error('timeout'))
   try { await sendClickSendSms(phone,'QA',{env,fetchImpl:f}); throw Error('expected rejection') }
   catch (error) { expect(error.ambiguous).toBe(true); expect(error.code).toBe('CLICKSEND_OUTCOME_UNKNOWN') }
 })
 it('marks a definitive provider rejection retryable after quota refund',async()=>{
   const f=make({response_code:'SUCCESS',data:{queued_count:0,blocked_count:1,messages:[{status:'INVALID_SENDER_ID'}]}})
   try { await sendClickSendSms(phone,'QA',{env,fetchImpl:f}); throw Error('expected rejection') }
   catch (error) { expect(error.ambiguous).toBe(false); expect(error.code).toBe('CLICKSEND_MESSAGE_REJECTED') }
 })
 it('keeps a successful response with no message id unresolved',async()=>{
   const f=make({response_code:'SUCCESS',data:{queued_count:1,blocked_count:0,messages:[{status:'SUCCESS'}]}})
   try { await sendClickSendSms(phone,'QA',{env,fetchImpl:f}); throw Error('expected rejection') }
   catch (error) { expect(error.ambiguous).toBe(true); expect(error.code).toBe('CLICKSEND_MISSING_MESSAGE_ID') }
 })

 it('rejects invalid mobile before fetch',async()=>{const f=vi.fn();await expect(sendClickSendSms('123','hi',{env,fetchImpl:f})).rejects.toThrow();expect(f).not.toHaveBeenCalled()})
})
