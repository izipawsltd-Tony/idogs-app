import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
const code=readFileSync(new URL('../api/send-reminders.js',import.meta.url),'utf8')
const getSection=(begin,end)=>{
 const i=code.indexOf(begin),j=code.indexOf(end,i+begin.length)
 expect(i).toBeGreaterThan(-1);expect(j).toBeGreaterThan(i)
 return code.slice(i,j)
}
describe('vaccination/worming scheduled SMS independence and fail-closed',()=>{
 it('turning off email never skips in-app or SMS reminder processing',()=>{
   expect(code).not.toContain('if (user.emailReminders === false) continue')
   expect(code).toContain('const emailEnabled = user.emailReminders !== false')
   expect(code).toContain('if (emailEnabled && user.email)')
   expect(code).toContain('if (emailEnabled && user.manualReminderEmails === true')
 })
 it('vaccination SMS is outside the email last-sent guard',()=>{
   const section=getSection("const blockedByFrequencyPref = reminderFrequency === 'once' ? hasSentBefore : sentWithinLast20h",
     "} else if (daysUntilDue > reminderDays)")
   const email=section.indexOf('if (!blockedByFrequencyPref)')
   const sms=section.indexOf("eventType: 'vaccination'")
   const emailClose=section.indexOf('// Each vaccine SMS is protected')
   expect(email).toBeGreaterThan(-1)
   expect(emailClose).toBeGreaterThan(email)
   expect(sms).toBeGreaterThan(emailClose)
   expect(section).toContain('idempotencyKey: `vaccination:')
 })
 it('worming SMS is independently keyed and outside shared email timestamp block',()=>{
   const section=getSection("const blockedByFrequencyPref = reminderFrequency === 'once' ? hasSentBefore : sentWithinLast20h",
      '// ── EXPLICIT BREEDING CYCLE REMINDERS')
   const worm=section.indexOf("eventType: 'worming'")
   const boundary=section.indexOf('// Each worming SMS is protected')
   expect(worm).toBeGreaterThan(boundary)
   expect(section).toContain('idempotencyKey: `worming:')
 })
 it('every reminder SMS provider call is subject to sender gate and quota',()=>{
   const fn=getSection('async function sendReminderSms({','function formatDate(')
   expect(fn).toContain('const gate = smsSendGate()')
   expect(fn).toContain('if (!gate.ready) return')
   expect(fn).toContain('return sendSmsWithQuota({')
 })
})
