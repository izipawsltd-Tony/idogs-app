import {createElement as h} from 'react'
import {act,create} from 'react-test-renderer'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {vi,it,expect,afterEach} from 'vitest'
const qa=vi.hoisted(()=>({user:{uid:'synthetic',email:'qa@example.invalid'},profile:{firstName:'QA',state:'SA',role:'breeder',plan:'free'},logout:vi.fn(),refreshProfile:vi.fn(),update:vi.fn()}))
vi.mock('../../src/hooks/useAuth',()=>({useAuth:()=>qa}))
vi.mock('../../src/lib/db',()=>({getAuditLogs:async()=>[],getDogs:async()=>[],getLitters:async()=>[],claimTransferredDogs:async()=>[],updateUserProfile:qa.update}))
vi.mock('../../src/components/SupportChatWidget',()=>({default:()=>null}))
import Layout from '../../src/components/layout/AppLayout'
import Settings from '../../src/pages/SettingsPage'
import Passport from '../../src/pages/PassportPublicPage'
import Audit from '../../src/pages/AuditPage'
import Litters from '../../src/pages/LittersPage'
vi.mock('../../src/lib/firebase',()=>({db:{},auth:{},storage:{}}))
afterEach(()=>vi.unstubAllGlobals())
function env(){vi.stubGlobal('document',{documentElement:{dataset:{idogsNativePlatform:'ios'}},addEventListener:vi.fn(),removeEventListener:vi.fn()})}
it('mobile Settings link navigates to the actual Settings screen and edit saves synthetic profile',async()=>{
 env();let r:any;
 await act(async()=>{r=create(h(MemoryRouter,{initialEntries:['/app/settings']},h(Routes,null,h(Route,{path:'/',element:h('h1',null,'Signed out')}),h(Route,{path:'/app',element:h(Layout,{toast:vi.fn()})},h(Route,{path:'settings',element:h(Settings,{toast:vi.fn()})})))))});
 const bar=r.root.findByProps({className:'mobile-topbar'});
 expect(bar.findAllByType('a').some((a:any)=>a.props.href==='/app/settings')).toBe(true);
 expect(r.root.findAllByType('h1').some((n:any)=>n.children.includes('Settings'))).toBe(true);
 const text=(n:any)=>n.children.filter((x:any)=>typeof x==='string').join('');
 act(()=>r.root.findAllByType('button').find((b:any)=>text(b).includes('Edit')).props.onClick());
 act(()=>r.root.findAllByType('input')[0].props.onChange({target:{value:'Synthetic QA'}}));
 await act(async()=>{await r.root.findAllByType('button').find((b:any)=>text(b).includes('Save')).props.onClick()});
 expect(qa.update).toHaveBeenCalledWith('synthetic',expect.objectContaining({firstName:'Synthetic QA'}));
 await act(async()=>{await bar.findByType('button').props.onClick()});
 expect(qa.logout).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(r.toJSON())).not.toContain('mobile-topbar');
 act(()=>r.unmount());
})
it('public passport requests encoded synthetic ID and handles missing passport safely',async()=>{
 env(); const f=vi.fn().mockResolvedValue(new Response('{}',{status:404}));vi.stubGlobal('fetch',f);let r:any;
 await act(async()=>{r=create(h(MemoryRouter,{initialEntries:['/p/QA%20synthetic']},h(Routes,null,h(Route,{path:'/p/:passportId',element:h(Passport)}))))});
 expect(f).toHaveBeenCalledWith('/api/passport?passportId=QA%20synthetic');
 expect(JSON.stringify(r.toJSON())).toMatch(/not found/i);
 act(()=>r.unmount());
})

it('Litters and Activity render empty synthetic accounts without crashing',async()=>{
 env();vi.stubGlobal('window',{});
 for(const Page of [Audit,Litters]){
 let r:any; await act(async()=>{r=create(h(MemoryRouter,null,h(Page as any,{toast:vi.fn(),dismissAll:vi.fn()})));await new Promise(resolve=>setTimeout(resolve,500))});
 expect(JSON.stringify(r.toJSON())).toMatch(Page===Audit?/Activity/:/Litters/);
 act(()=>r.unmount());
 }
})
it('public passport renders a synthetic dog and all public tabs',async()=>{
 env();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({dog:{id:'qa',name:'Synthetic QA Dog',breed:'Labrador',sex:'female',dateOfBirth:'2026-01-01',lifeStage:'young',passportId:'QA-ONLY'},vaccines:[],healthTests:[]}))));let r:any;
 await act(async()=>{r=create(h(MemoryRouter,{initialEntries:['/p/QA-ONLY']},h(Routes,null,h(Route,{path:'/p/:passportId',element:h(Passport)}))))});
 expect(JSON.stringify(r.toJSON())).toContain('Synthetic QA Dog');
 for(const label of ['Health','Info']){const b=r.root.findAllByType('button').find((b:any)=>JSON.stringify(b.children).includes(label));expect(b).toBeTruthy();act(()=>b!.props.onClick())}
 expect(JSON.stringify(r.toJSON())).toContain('QA-ONLY');act(()=>r.unmount());
})
