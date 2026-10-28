import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ directory: vi.fn(), dogs: vi.fn(), fetch: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'breeder', getIdToken: async () => 'test-token' }, profile: null }) }))
vi.mock('../lib/db', () => ({ getDogs: state.dogs }))
vi.mock('../lib/buyers', () => ({ buyerRequest: state.directory }))
import FinanceDocumentsPage from './FinanceDocumentsPage'
let screen: ReactTestRenderer
beforeEach(() => {
 state.dogs.mockResolvedValue([{ id: 'blue', tenantId: 'breeder', currentOwnerId: 'breeder', name: 'Blue', status: 'active' }])
 state.directory.mockResolvedValue({ buyers: [{ id: 'alice', name: 'Alice', email: 'alice@example.invalid', phone: '0400000000', status: 'waiting', dogId: '', notes: '', amount: null }] })
 state.fetch.mockResolvedValue({ ok: true, json: async () => ({ documents: [] }) })
 vi.stubGlobal('fetch',state.fetch); vi.stubGlobal('window',{addEventListener(){},removeEventListener(){}})
})
const button=(text:string)=>screen.root.findAllByType('button').find(b=>b.children.join('')===text)!
it('keeps an existing waiting buyer selected when an unreserved puppy is chosen',async()=>{
 await act(async()=>{screen=create(createElement(MemoryRouter,{},createElement(FinanceDocumentsPage,{toast:vi.fn()})))})
 await act(async()=>{button('＋ Invoice').props.onClick()})
 const picker=screen.root.findAllByType('select').find(s=>s.findAllByType('option').some(o=>o.props.value==='alice@example.invalid'))!
 await act(async()=>{picker.props.onChange({target:{value:'alice@example.invalid'}})})
 await act(async()=>{screen.root.findByProps({'aria-label':'Dog / Puppy'}).props.onChange({target:{value:'blue'}})})
 expect(screen.root.findByProps({'aria-label':'Buyer name'}).props.value).toBe('Alice')
 expect(screen.root.findByProps({'aria-label':'Buyer email'}).props.value).toBe('alice@example.invalid')
 expect(screen.root.findByProps({'aria-label':'Dog / Puppy'}).props.value).toBe('blue')
 await act(async()=>screen.unmount())
})
