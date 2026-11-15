import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ profile: { role: 'owner', emailReminders: true, manualReminderEmails: false, careEmailTypes: {} } as any, update: vi.fn(), refresh: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'qa' }, profile: state.profile, refreshProfile: state.refresh }) }))
vi.mock('../lib/db', () => ({ updateUserProfile: state.update, addReminder: vi.fn() }))
vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDocFromServer: vi.fn() }))
import SettingsPage from './SettingsPage'

beforeEach(() => { state.update.mockReset().mockResolvedValue(undefined); state.refresh.mockReset().mockResolvedValue(undefined); state.profile = { role: 'owner', emailReminders: true, manualReminderEmails: false, careEmailTypes: {} } })
describe('notification settings interactions', () => {
  it('starts collapsed, opens and closes without changing saved preferences', async () => {
    const page = create(createElement(SettingsPage, { toast: vi.fn() }))
    const section = () => page.root.findByProps({ 'aria-controls': 'manual-reminder-types' })
    expect(section().props['aria-expanded']).toBe(false)
    expect(page.root.findAllByProps({ 'aria-label': 'Worming' })).toHaveLength(0)
    await act(async () => { section().props.onClick() })
    expect(section().props['aria-expanded']).toBe(true)
    expect(page.root.findAllByProps({ 'aria-label': 'Worming' })).toHaveLength(1)
    await act(async () => { section().props.onClick() })
    expect(page.root.findAllByProps({ 'aria-label': 'Worming' })).toHaveLength(0)
    expect(state.update).not.toHaveBeenCalled()
  })
  it('actually toggles the master email preference off and back on', async () => {
    const page = create(createElement(SettingsPage, { toast: vi.fn() }))
    const toggle = () => page.root.findByProps({ 'aria-label': 'Email Reminders' })
    expect(toggle().props['aria-checked']).toBe(true)
    await act(async () => { toggle().props.onClick() })
    expect(state.update).toHaveBeenLastCalledWith('qa', { emailReminders: false })
    state.profile.emailReminders = false; page.update(createElement(SettingsPage, { toast: vi.fn() }))
    await act(async () => { toggle().props.onClick() })
    expect(state.update).toHaveBeenLastCalledWith('qa', { emailReminders: true })
  })
  it('requires manual opt-in and saves a single category without overwriting others', async () => {
    const page = create(createElement(SettingsPage, { toast: vi.fn() }))
    expect(page.root.findByProps({ 'aria-label': 'Manual reminder emails' }).props['aria-checked']).toBe(false)
    await act(async () => { page.root.findByProps({ 'aria-label': 'Manual reminder emails' }).props.onClick() })
    expect(state.update).toHaveBeenLastCalledWith('qa', { manualReminderEmails: true })
    await act(async () => { page.root.findByProps({ 'aria-controls': 'manual-reminder-types' }).props.onClick() })
    await act(async () => { page.root.findByProps({ 'aria-label': 'Worming' }).props.onClick() })
    expect(state.update).toHaveBeenLastCalledWith('qa', { careEmailTypes: { worming: false } })
    expect(page.root.findAllByProps({ role: 'switch' }).filter(n => ['Worming', 'Vaccination', 'Flea & tick', 'Medication', 'Vet appointment', 'Other', 'Grooming', 'Weight check', 'Dental care', 'Nail trim'].includes(n.props['aria-label']))).toHaveLength(10)
  })
  it('disables dependent controls when master is off and reports save errors honestly', async () => {
    state.profile.emailReminders = false
    const toast = vi.fn(); const page = create(createElement(SettingsPage, { toast }))
    expect(page.root.findByProps({ 'aria-label': 'Manual reminder emails' }).props.disabled).toBe(true)
    await act(async () => { page.root.findByProps({ 'aria-controls': 'manual-reminder-types' }).props.onClick() })
    expect(page.root.findByProps({ 'aria-label': 'Worming' }).props.disabled).toBe(true)
    state.update.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { page.root.findByProps({ 'aria-label': 'Email Reminders' }).props.onClick() })
    expect(toast).toHaveBeenCalledWith('Failed to save setting', 'error')
  })
})
