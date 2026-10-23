import { describe, it, expect } from 'vitest'
import { evaluateConsent, PROJECT_ID } from './qa-firestore-marketing-consent.mjs'
const at = new Date(Date.now() - 1000).toISOString()
const make = (choice = 'opt_out') => ({marketingConsent: {
 channel:'email_marketing',checkboxDefault:false,choice,source:'account_settings',
 policyVersion:'marketing-v1-2026-10', evidenceRef:choice === 'opt_out'?'settings-opt-out-v1':'settings-opt-in-v1',
 optedInAt:at,revokedAt:choice === 'opt_out'?at:null
}})
describe('read only single-user staging QA', () => {
 it('pins Firebase project to staging',()=>expect(PROJECT_ID).toBe('idogs-app-staging'))
 it.each(['opt_out','opt_in'])('accepts confirmed %s',choice=>expect(evaluateConsent(make(choice),choice).result).toBe('PASS'))
 it('rejects signup record instead of claiming settings QA',()=>expect(()=>evaluateConsent({...make(),marketingConsent:{...make().marketingConsent,source:'explicit_checkbox'}},'opt_out')).toThrow())
 it('rejects UI OFF when database is ON',()=>expect(()=>evaluateConsent(make('opt_in'),'opt_out')).toThrow())
 it('rejects missing revoke timestamp',()=>{const x=make();x.marketingConsent.revokedAt=null;expect(()=>evaluateConsent(x,'opt_out')).toThrow()})
 it('rejects absent user consent',()=>expect(()=>evaluateConsent({},'opt_in')).toThrow())
})
