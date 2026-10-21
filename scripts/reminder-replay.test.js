import { beforeEach, afterEach, it, expect, vi } from 'vitest'
const state = vi.hoisted(() => ({ records: new Map(), failStamp: false, sequence: 0, tail: Promise.resolve() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/firestore', () => {
  const ref = path => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path) })
  const snapshot = path => ({ exists: state.records.has(path), id: path.split('/').at(-1), ref: ref(path), data: () => state.records.get(path) })
  const collection = name => {
    const query = filters => ({
      where: (field, op, value) => { if (op !== '==') throw Error('unsupported mock query'); return query([...filters, [field, value]]) },
      get: async () => ({ docs: [...state.records].filter(([path, data]) => path.split('/').length === 2 && path.startsWith(`${name}/`) && filters.every(([field, value]) => data[field] === value)).map(([path]) => snapshot(path)) }),
      doc: id => ref(`${name}/${id || `synthetic-${++state.sequence}`}`),
    })
    return query([])
  }
  const runTransaction = cb => {
    const run = state.tail.then(async () => {
      const writes = []
      const update = (ref, data) => {
        if (state.failStamp && Object.keys(data).some(key => key === 'lastReminderSentAt' || key.startsWith('lastHeatReminderSentAt_'))) throw Error('synthetic lost source stamp')
        writes.push([ref.path, { ...state.records.get(ref.path), ...data }])
      }
      const result = await cb({ get: async ref => snapshot(ref.path), update, set: (ref, data, options) => writes.push([ref.path, options?.merge ? { ...state.records.get(ref.path), ...data } : data]) })
      writes.forEach(([path, data]) => state.records.set(path, data)); return result
    })
    state.tail = run.catch(() => {}); return run
  }
  return { getFirestore: () => ({ collection, runTransaction }) }
})
import handler from '../api/send-reminders.js'
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T08:00:00Z'))
  vi.stubEnv('CRON_SECRET', 'synthetic-cron')
  vi.stubEnv('APP_URL', 'https://idogs-app-staging.vercel.app')
  vi.stubEnv('FIREBASE_PROJECT_ID', 'idogs-app-staging')
  state.records.clear(); state.sequence = 0; state.tail = Promise.resolve(); state.failStamp = true
  state.records.set('users/owner', { email:'owner@example.invalid', reminderFrequency:'once' })
  state.records.set('dogs/dog', { tenantId:'owner', currentOwnerId:'owner', name:'Synthetic', status:'active', sex:'male' })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true, json:async()=>({success:true,id:'synthetic-message'}) }))
  vi.spyOn(console, 'error').mockImplementation(()=>{})
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function call() {
  const res={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}}
  await handler({method:'POST',headers:{'x-cron-secret':'synthetic-cron'}},res)
  expect(res.code).toBe(200);return res.body
}
function care(type) {
  const col=type==='vaccination'?'vaccineRecords':'wormingRecords'
  state.records.set(`${col}/care`,{dogId:'dog',tenantId:'owner',name:'Synthetic treatment',dateGiven:'2026-10-01',nextDue:'2026-10-25'})
}
for(const type of ['vaccination','worming']) it(`${type}: once-only email cannot repeat next day after source stamp fails`,async()=>{
  care(type)
  expect((await call()).emailSent).toBe(1)
  vi.setSystemTime(new Date('2026-10-22T08:00:00Z'))
  expect((await call()).emailSent).toBe(0)
  expect(fetch).toHaveBeenCalledTimes(1)
})
for(const type of ['vaccination','worming']) it(`${type}: ambiguous provider response cannot cause another send next day`,async()=>{
  care(type);fetch.mockRejectedValue(Error('synthetic lost provider response'))
  expect((await call()).emailSent).toBe(0)
  vi.setSystemTime(new Date('2026-10-22T08:00:00Z'))
  expect((await call()).emailSent).toBe(0)
  expect(fetch).toHaveBeenCalledTimes(1)
  const operations=[...state.records].filter(([path])=>path.startsWith('accountExternalOperations/'))
  expect(operations).toHaveLength(1);expect(operations[0][1].state).toBe('review_required')
})
it('daily care email sends once per day despite source stamp failures',async()=>{
  care('vaccination');state.records.get('users/owner').reminderFrequency='daily'
  expect((await call()).emailSent).toBe(1)
  expect((await call()).emailSent).toBe(0)
  vi.setSystemTime(new Date('2026-10-22T08:00:00Z'))
  expect((await call()).emailSent).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('the next recorded due date is a new care event, while content/email edits are not',async()=>{
  state.failStamp=false
  care('vaccination');expect((await call()).emailSent).toBe(1)
  state.records.get('users/owner').email='changed@example.invalid'
  state.records.get('dogs/dog').name='Changed'
  expect((await call()).emailSent).toBe(0)
  state.records.get('vaccineRecords/care').nextDue='2026-10-26'
  expect((await call()).emailSent).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('HTTP 200 without a provider receipt remains unconfirmed and is not counted as sent',async()=>{
  care('vaccination');fetch.mockResolvedValue({ok:true,json:async()=>({success:true})})
  expect((await call()).emailSent).toBe(0)
  const operations=[...state.records].filter(([path])=>path.startsWith('accountExternalOperations/'))
  expect(operations[0][1].state).toBe('review_required')
})
it('birthday keeps its once-per-dog-per-day behavior',async()=>{
  state.records.get('dogs/dog').dateOfBirth='2020-10-21T12:00:00Z'
  expect((await call()).emailSent).toBe(1)
  expect((await call()).emailSent).toBe(0)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('heat notifications retain their daily cadence when the care setting is once',async()=>{
  Object.assign(state.records.get('dogs/dog'),{sex:'female',breed:'Chihuahua',dateOfBirth:'2026-04-25'})
  expect((await call()).emailSent).toBe(1)
  expect((await call()).emailSent).toBe(0)
  vi.setSystemTime(new Date('2026-10-22T08:00:00Z'))
  expect((await call()).emailSent).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('a new owner gets their own event; the frozen former owner cannot receive later reminders',async()=>{
  state.failStamp=false
  care('vaccination');expect((await call()).emailSent).toBe(1)
  state.records.set('users/buyer',{email:'buyer@example.invalid',reminderFrequency:'once'})
  state.records.get('dogs/dog').currentOwnerId='buyer'
  state.records.set('accountDeletionFences/owner',{state:'frozen'})
  expect((await call()).emailSent).toBe(1)
  vi.setSystemTime(new Date('2026-10-22T08:00:00Z'))
  expect((await call()).emailSent).toBe(0)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetch.mock.calls[1][1].body).to_email).toBe('buyer@example.invalid')
})
