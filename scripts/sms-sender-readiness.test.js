import { describe, it, expect } from 'vitest'
import { smsSendGate } from '../api/_lib/sms-sender-readiness.js'
const cfg=()=>({SMS_SENDING_ENABLED:'true',SMS_PROVIDER:'clicksend',SMS_SENDER_ID:'iDogs',SMS_PROVIDER_ACCOUNT_VERIFIED:'true',CLICKSEND_USERNAME:'qa',CLICKSEND_API_KEY:'test'})
describe('ClickSend sender readiness',()=>{
 it('disabled by default',()=>expect(smsSendGate({}).ready).toBe(false))
 it('rejects AWS SNS',()=>expect(smsSendGate({...cfg(),SMS_PROVIDER:'aws'}).ready).toBe(false))
 it('rejects unapproved sender',()=>expect(smsSendGate({...cfg(),SMS_SENDER_ID:'IZIPAWS'}).ready).toBe(false))
 it('rejects unverified account',()=>expect(smsSendGate({...cfg(),SMS_PROVIDER_ACCOUNT_VERIFIED:'false'}).ready).toBe(false))
 it('rejects missing keys',()=>expect(smsSendGate({...cfg(),CLICKSEND_API_KEY:''}).ready).toBe(false))
 it('permits verified ClickSend config',()=>expect(smsSendGate(cfg()).ready).toBe(true))
})
