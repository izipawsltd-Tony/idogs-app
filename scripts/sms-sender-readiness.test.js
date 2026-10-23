import { describe, it, expect } from 'vitest'
import { smsSendGate } from '../api/_lib/sms-sender-readiness.js'
const ready = () => ({
 SMS_SENDING_ENABLED:'true', SMS_SENDER_ID:'iDogs',
 SMS_PROVIDER_ACCOUNT_VERIFIED:'true', AWS_SNS_REGION:'ap-southeast-2'
})
describe('iDogs sender ID guarded SMS readiness', () => {
 it('is disabled by default',()=>expect(smsSendGate({}).ready).toBe(false))
 it('uses the ACMA-approved exact case',()=>expect(smsSendGate({...ready(),SMS_SENDER_ID:'IZIPAWS'}).ready).toBe(false))
 it('requires explicit AWS account verification',()=>expect(smsSendGate({...ready(),SMS_PROVIDER_ACCOUNT_VERIFIED:'false'}).ready).toBe(false))
 it('requires Sydney region',()=>expect(smsSendGate({...ready(),AWS_SNS_REGION:'us-east-1'}).ready).toBe(false))
 it('accepts fully verified configuration',()=>expect(smsSendGate(ready()).senderId).toBe('iDogs'))
})
