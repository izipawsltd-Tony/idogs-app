import { describe, it, expect } from 'vitest'
import { createBuyersHandler, validateBuyer } from '../api/_lib/buyers-handler.js'

function setup() {
 const data = new Map([['dogs/ruby', { tenantId: 'breeder', currentOwnerId: 'breeder', status: 'active', availabilityStatus: 'available' }], ['dogs/foreign', { tenantId: 'other', currentOwnerId: 'other', status: 'active' }], ['dogs/sold', { tenantId: 'breeder', currentOwnerId: 'buyer', status: 'transferred' }]])
 const snapshot = path => ({ id: path.split('/').at(-1), exists: data.has(path), data: () => data.get(path) })
 const doc = path => ({ path, get: async () => snapshot(path) })
 const col = (path, filters = [], max = Infinity) => ({ doc: id => doc(`${path}/${id}`), where: (key, op, value) => col(path, [...filters, [key,value]], max), limit: n => col(path,filters,n), get: async () => ({ docs: [...data.keys()].filter(k => k.startsWith(path+'/') && filters.every(([f,v])=>data.get(k)[f]===v)).slice(0,max).map(snapshot) }) })
 const db = { collection: col, runTransaction: async fn => { const writes=[]; let written=false; const result=await fn({ get: ref => { if(written) throw Error('read after write'); return ref.get() }, set: (r,v)=>{written=true;writes.push([r.path,v])}, update:(r,v)=>{written=true;writes.push([r.path,{...data.get(r.path),...v}])} }); writes.forEach(([k,v])=>data.set(k,v)); return result } }
 const handler=createBuyersHandler({db,verifyToken:async token=>{if(!token)throw Error('auth');return {uid:token}},timestamp:()=> '2026-10-29T00:00:00Z'})
 async function call(body,who='breeder') { const res={code:200,setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};try{await handler({method:'POST',body,headers:{authorization:who?`Bearer ${who}`:''}},res)}catch(e){res.code=e.status||500;res.body={error:e.message}};return res }
 return {data,call}
}
const form=(extra={})=>({action:'save',name:'QA Buyer',email:'BUYER@example.invalid',phone:'',notes:'Private note',status:'waiting',dogId:'',amount:'',...extra})
describe('Buyer contact lifecycle and isolation',()=>{
 it('stores waiting-list buyer without a dog and deduplicates normalised email',async()=>{const {call}=setup();expect((await call(form())).code).toBe(200);expect((await call(form({name:'Updated'}))).code).toBe(200);const list=await call({action:'list'});expect(list.body.buyers).toHaveLength(1);expect(list.body.buyers[0]).toMatchObject({name:'Updated',email:'buyer@example.invalid',status:'waiting'})})
 it('requires authentication and scopes lists by owner instead of supplied ownerUid',async()=>{const {call}=setup();expect((await call(form(),null)).code).toBe(401);await call(form({ownerUid:'other'}));expect((await call({action:'list'},'other')).body.buyers).toHaveLength(0)})
 it('records deposit atomically in canonical dog fields and revokes an old mismatched grant',async()=>{const {call,data}=setup();data.set('dogPrivateAccess/ruby',{status:'active',buyerEmail:'previous@example.invalid'});expect((await call(form({status:'deposit',dogId:'ruby',amount:'500'}))).code).toBe(200);expect(data.get('dogs/ruby')).toMatchObject({depositStatus:'received',depositAmount:500,reservedForEmail:'buyer@example.invalid',availabilityStatus:'reserved'});expect(data.get('dogPrivateAccess/ruby').status).toBe('revoked')})
 it('does not automatically grant private access or transfer ownership',async()=>{const {call,data}=setup();await call(form({status:'deposit',dogId:'ruby'}));expect(data.has('dogPrivateAccess/ruby')).toBe(false);expect(data.get('dogs/ruby').currentOwnerId).toBe('breeder');expect((await call(form({status:'transferred',dogId:'ruby'}))).code).toBe(409)})
 it('blocks foreign or transferred puppies without partial writes',async()=>{const {call}=setup();for(const dogId of ['foreign','sold'])expect((await call(form({status:'deposit',dogId}))).code).toBe(403);expect((await call({action:'list'})).body.buyers).toHaveLength(0)})
 it('blocks replacing another buyer and keeps their reservation unchanged',async()=>{const {call,data}=setup();data.set('dogs/ruby',{...data.get('dogs/ruby'),availabilityStatus:'reserved',reservedForEmail:'other@example.invalid'});expect((await call(form({status:'deposit',dogId:'ruby'}))).code).toBe(409);expect(data.get('dogs/ruby').reservedForEmail).toBe('other@example.invalid')})
 it('requires releasing an active reservation before moving back to waiting list',async()=>{const {call}=setup();await call(form({status:'deposit',dogId:'ruby'}));expect((await call(form())).code).toBe(409)})
 it('records historical transferred contact without modifying a dog',async()=>{const {call,data}=setup();expect((await call(form({status:'transferred'}))).code).toBe(200);expect(data.get('dogs/ruby').availabilityStatus).toBe('available')})
 it('validates email, amount and linked deposit',()=>{for(const input of [{email:'bad'},{amount:-1},{amount:'NaN'},{status:'deposit'},{name:''},{notes:'x'.repeat(2001)}])expect(()=>validateBuyer(form(input))).toThrow()})
})
