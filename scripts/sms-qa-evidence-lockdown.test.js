import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
const handler=readFileSync(new URL('../api/qa-clicksend-one-shot.js',import.meta.url),'utf8')
const settings=readFileSync(new URL('../src/pages/SettingsPage.tsx',import.meta.url),'utf8')
describe('one-shot QA retrospective evidence guard',()=>{
 it('always closes POST on diagnostic branch, no provider send or lock creation path',()=>{
   expect(handler).toContain("return res.status(410).json({ error:'QA_ONE_SHOT_CLOSED'")
   expect(handler).not.toContain('sendClickSendSms(')
   expect(handler).not.toContain('ref.create(')
 })
 it('readback distinguishes absent Firestore lock from confirmed provider delivery',()=>{
   expect(handler).toContain("firestoreLock:'ABSENT'")
   expect(handler).toContain("providerMessageIdStored:false")
   expect(handler).toContain("deliveryVerified:delivery.status==='DELIVERED'")
 })
 it('user cannot trigger a second approved SMS through Settings',()=>{
   expect(settings).not.toContain('runSingleClickSendQa')
   expect(settings).not.toContain('Send one approved SMS test')
   expect(settings).toContain('Check delivery (no resend)')
 })
})
