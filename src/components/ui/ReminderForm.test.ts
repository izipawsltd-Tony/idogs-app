import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
vi.mock('../../lib/db', () => ({ addReminder: vi.fn().mockResolvedValue('synthetic-reminder') }))
import { addReminder } from '../../lib/db'
import ReminderForm from './ReminderForm'

it('Other requires user details and saves them using the existing custom category', async () => {
  const saved = vi.fn()
  const page = create(createElement(ReminderForm, { dogs: [{ id: 'qa-dog', name: 'Synthetic QA' }], tenantId: 'qa-owner', onSaved: saved, onCancel: vi.fn() }))
  expect(page.root.findAllByType('option').some(n => n.props.value === 'custom' && n.children.includes('Other'))).toBe(true)
  await act(async () => { page.root.findByProps({ id: 'reminder-date' }).props.onChange({ target: { value: '2026-11-01' } }) })
  await act(async () => { page.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(addReminder).not.toHaveBeenCalled()
  await act(async () => { page.root.findByProps({ id: 'reminder-title' }).props.onChange({ target: { value: '  Renew dog registration  ' } }) })
  await act(async () => { page.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(addReminder).toHaveBeenCalledWith(expect.objectContaining({ type: 'custom', title: 'Renew dog registration', source: 'manual' }))
  expect(saved).toHaveBeenCalledOnce()
})
