import {describe,it,expect,vi} from 'vitest'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
const state=vi.hoisted(()=>({profile:{role:'breeder',emailReminders:false,reminderDays:7,reminderFrequency:'once'}}))
vi.mock('../src/hooks/useAuth',()=>({useAuth:()=>({user:{uid:'synthetic',email:'qa@example.invalid'},profile:state.profile,refreshProfile:vi.fn()})}))
vi.mock('../src/lib/db',()=>({updateUserProfile:vi.fn()}))
vi.mock('../src/lib/firebase',()=>({db:{app:{options:{projectId:'idogs-app-staging'}}}}))
import SettingsPage from '../src/pages/SettingsPage'
describe('SMS settings remain usable without email',()=>{
 it('renders lead time and frequency with email off, without claiming SMS is paused',()=>{
  state.profile={role:'breeder',emailReminders:false,reminderDays:7,reminderFrequency:'once'}
  const html=renderToStaticMarkup(React.createElement(SettingsPage,{toast:vi.fn()}))
  expect(html).toContain('Reminder lead time')
  expect(html).toContain('Daily until due')
  expect(html).toContain('Heat cycle reminder lead time')
  expect(html).toContain('Turning this off does not disable SMS or in-app reminders.')
  expect(html).toContain('SMS is sent once per due date')
  expect(html).not.toContain('also pauses existing scheduled SMS')
 })
 it('keeps owner SMS preferences available while hiding breeder heat-cycle controls',()=>{
  state.profile={role:'owner',emailReminders:false}
  const html=renderToStaticMarkup(React.createElement(SettingsPage,{toast:vi.fn()}))
  expect(html).toContain('Reminder lead time')
  expect(html).not.toContain('Heat cycle reminder lead time')
 })
})
