import {describe,it,expect,vi,beforeEach} from 'vitest'
const state=vi.hoisted(()=>({rows:new Map(),deliveries:new Set(),calls:[],enabled:true}))
vi.mock('firebase-admin/app',()=>({getApps:()=>[{}],initializeApp:vi.fn(),cert:vi.fn()}))
vi.mock('firebase-admin/firestore',()=>({getFirestore:()=>({
 collection:(name)=>({
  where:(field,operator,value)=>({
   get:async()=>({docs:[...state.rows.entries()].filter(([path,obj])=>
    path.startsWith(name+'/')&&obj[field]===value
   ).map(([path,obj])=>({id:path.slice(name.length+1),data:()=>obj}))}),
  }),
  get:async()=>({docs:[...state.rows.entries()].filter(([path])=>path.startsWith(name+'/')).map(([path,obj])=>({
    id:path.slice(name.length+1),data:()=>obj,
  }))}),
  doc:id=>({
   get:async()=>({exists:state.rows.has(name+'/'+id),data:()=>state.rows.get(name+'/'+id)}),
   set:async(data,options)=>state.rows.set(name+'/'+id,options?.merge?
     {...state.rows.get(name+'/'+id),...data}:data),
   update:async data=>state.rows.set(name+'/'+id,{...state.rows.get(name+'/'+id),...data}),
  }),
 }),
})}))
vi.mock('../api/_lib/sms-sender-readiness.js',()=>({
 smsSendGate:()=>state.enabled?{ready:true}:{ready:false,reason:'SMS_SENDING_DISABLED'},
}))
vi.mock('../api/_lib/sms-addon.js',()=>({
 sendSmsWithQuota:vi.fn(async(args)=>{
  state.calls.push({eventType:args.eventType,idempotencyKey:args.idempotencyKey})
  if(state.deliveries.has(args.idempotencyKey))return {sent:false,reason:'DUPLICATE'}
  state.deliveries.add(args.idempotencyKey)
  return {sent:true}
 }),
}))
vi.mock('../api/_lib/clicksend-sms.js',()=>({sendClickSendSms:vi.fn()}))
import handler from '../api/send-reminders.js'
const day=(n)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function response(){const out={};const res={status:v=>{out.code=v;return res},json:body=>{out.body=body;return out}};return {res,out}}
async function execute(){const {res,out}=response();await handler({method:'POST',headers:{'x-cron-secret':'qa-cron'}},res);return out}
beforeEach(()=>{
 state.rows.clear();state.deliveries.clear();state.calls=[];state.enabled=true
 vi.stubEnv('CRON_SECRET','qa-cron')
 vi.stubEnv('APP_URL','https://idogs-app-staging.vercel.app')
 vi.stubEnv('FIREBASE_PROJECT_ID','idogs-app-staging')
 vi.stubEnv('RESEND_API_KEY','')
 state.rows.set('users/owner',{emailReminders:false,phone:'0412345678',
  reminderDays:7,reminderFrequency:'once'})
 state.rows.set('dogs/qa-dog',{tenantId:'owner',currentOwnerId:'owner',name:'QA Dog'})
 state.rows.set('vaccineRecords/vac1',{dogId:'qa-dog',name:'C5',dateGiven:day(-300),nextDue:day(3),
  lastReminderSentAt:day(-1)})
 state.rows.set('wormingRecords/worm1',{dogId:'qa-dog',name:'worm',dateGiven:day(-30),
  nextDue:day(3),lastReminderSentAt:day(-1)})
})
describe('real scheduler handler — isolated vaccination/worming E2E',()=>{
 it('processes SMS while email disabled, skips former-owner data, rerun never delivers twice',async()=>{
  const first=await execute()
  expect(first.code).toBe(200)
  expect(first.body.smsSent).toBe(2)
  expect(first.body.emailSent).toBe(0)
  expect(state.calls.map(x=>x.eventType).sort()).toEqual(['vaccination','worming'])
  expect(state.rows.get('reminders/vaccine_qa-dog_vac1')?.type).toBe('vaccine')
  expect(state.rows.get('reminders/worming_qa-dog_worm1')?.type).toBe('worming')
  const second=await execute()
  expect(second.code).toBe(200)
  expect(second.body.smsSent).toBe(0)
  expect(state.deliveries.size).toBe(2)
 })
 it('fails closed at sender gate without counted sends',async()=>{
  state.enabled=false
  const result=await execute()
  expect(result.code).toBe(200)
  expect(result.body.smsSent).toBe(0)
  expect(state.deliveries.size).toBe(0)
 })
 it('never schedules a dog transferred to another owner',async()=>{
  state.rows.get('dogs/qa-dog').currentOwnerId='different-owner'
  const result=await execute()
  expect(result.code).toBe(200)
  expect(result.body.smsSent).toBe(0)
  expect(state.calls).toEqual([])
 })
})
