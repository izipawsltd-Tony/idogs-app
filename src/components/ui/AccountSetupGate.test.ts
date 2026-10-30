import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const s=vi.hoisted(()=>({user:{uid:'phone-user',email:null,emailVerified:false},request:vi.fn(),enabled:true}))
vi.mock('../../hooks/useAuth',()=>({useAuth:()=>({user:s.user})}))
vi.mock('../../lib/accountOnboarding',()=>({onboardingQaEnabled:()=>s.enabled,accountSetupRequest:s.request}))
import AccountSetupGate from './AccountSetupGate'
let tree:ReactTestRenderer
function Destination(){const l=useLocation();return createElement('output',{},l.pathname+l.search)}
async function render(){await act(async()=>{tree=create(createElement(MemoryRouter,{initialEntries:['/app/settings?from=QR']},createElement(Routes,null,createElement(Route,{path:'/app/settings',element:createElement(AccountSetupGate,null,createElement('strong',{},'Protected settings'))}),createElement(Route,{path:'*',element:createElement(Destination)}))))})}
beforeEach(()=>{s.enabled=true;s.request.mockReset().mockResolvedValue({ready:false,required:true})})
afterEach(()=>{if(tree)act(()=>tree.unmount())})
it('redirects an incomplete account before rendering management and preserves destination',async()=>{await render();expect(tree.root.findAllByType('strong')).toHaveLength(0);expect(tree.root.findByType('output').children.join('')).toBe('/complete-account?next=%2Fapp%2Fsettings%3Ffrom%3DQR')})
it('opens management only after the server confirms readiness',async()=>{s.request.mockResolvedValue({ready:true});await render();expect(tree.root.findByType('strong').children).toContain('Protected settings')})
it('fails closed when status cannot be loaded and offers the completion retry path',async()=>{s.request.mockRejectedValue(new Error('offline'));await render();expect(tree.root.findAllByType('strong')).toHaveLength(0);expect(tree.root.findByType('output').children.join('')).toContain('&retry=1')})
it('leaves existing deployments unchanged with the QA flag off',async()=>{s.enabled=false;await render();expect(s.request).not.toHaveBeenCalled();expect(tree.root.findByType('strong')).toBeTruthy()})
