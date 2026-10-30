import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const s=vi.hoisted(()=>({request:vi.fn(),setup:vi.fn()}))
vi.mock('../../hooks/useAuth',()=>({useAuth:()=>({user:{uid:'incomplete-phone'},loading:false})}))
vi.mock('../../lib/accountOnboarding',()=>({accountSetupRequest:s.setup}))
vi.mock('../../lib/puppyUpdates',()=>({puppyUpdates:s.request,puppyPath:(id:string)=>`/p/${id}`}))
import PuppyStoryPanel from './PuppyStoryPanel'
let tree:ReactTestRenderer
function Destination(){const l=useLocation();return createElement('output',{},l.pathname+l.search)}
beforeEach(()=>{vi.stubEnv('VITE_ACCOUNT_ONBOARDING_QA','1');s.setup.mockReset().mockResolvedValue({ready:false});s.request.mockReset().mockResolvedValue({dog:{name:'Ruby',passportId:'QR-DEMO'},role:'public',following:false,updates:[]})})
afterEach(()=>{if(tree)act(()=>tree.unmount());vi.unstubAllEnvs()})
async function render(query=''){await act(async()=>{tree=create(createElement(MemoryRouter,{initialEntries:['/p/QR-DEMO'+query]},createElement(Routes,null,createElement(Route,{path:'/p/:id',element:createElement(PuppyStoryPanel,{passportId:'QR-DEMO'})}),createElement(Route,{path:'*',element:createElement(Destination)}))))})}
it('takes a phone customer to setup instead of failing Follow, retaining the exact puppy intent',async()=>{
 await render();await act(async()=>{await tree.root.findAllByType('button').find(b=>b.children.includes('Follow this puppy'))!.props.onClick()})
 expect(tree.root.findByType('output').children.join('')).toBe('/complete-account?next=%2Fp%2FQR-DEMO%3Ffollow%3D1')
 expect(s.request).not.toHaveBeenCalledWith({passportId:'QR-DEMO',action:'follow'})
})
it('preserves automatic follow intent across the registration/completion route',async()=>{
 await render('?follow=1');expect(tree.root.findByType('output').children.join('')).toBe('/complete-account?next=%2Fp%2FQR-DEMO%3Ffollow%3D1')
 expect(s.request).not.toHaveBeenCalledWith({passportId:'QR-DEMO',action:'follow'})
})
it('allows following after setup is confirmed',async()=>{
 s.setup.mockResolvedValue({ready:true});await render();await act(async()=>{await tree.root.findAllByType('button').find(b=>b.children.includes('Follow this puppy'))!.props.onClick()})
 expect(s.request).toHaveBeenCalledWith({passportId:'QR-DEMO',action:'follow'})
})
