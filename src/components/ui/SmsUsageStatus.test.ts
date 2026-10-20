import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import SmsUsageStatus from './SmsUsageStatus'

afterEach(() => { vi.useRealTimers() })
it('updates the expired-period warning while the page remains open', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T00:59:30Z'))
  const sms = { status: 'active', creditsLimit: 1, creditsUsed: 0, phone: '+61400000000',
    periodStart: '2026-10-21T00:00:00Z', periodEnd: '2026-10-21T01:00:00Z' }
  let page: ReturnType<typeof create>
  await act(async () => { page = create(createElement(SmsUsageStatus, { sms })) })
  expect(page!.root.findByProps({ role: 'progressbar' }).props['aria-valuetext']).toBe('0 of 1 credits used')
  expect(page!.root.findByProps({ role: 'status' }).children.join('')).toContain('Eligible scheduled reminders')
  await act(async () => { vi.advanceTimersByTime(60_000) })
  expect(page!.root.findByProps({ role: 'status' }).children.join('')).toContain('period has ended')
  await act(async () => { page!.unmount() })
  expect(vi.getTimerCount()).toBe(0)
})

it('renders exhausted usage and a clamped accessible progress bar', () => {
  const page = create(createElement(SmsUsageStatus, { sms: { status: 'active', creditsUsed: 2,
    creditsLimit: 1, periodStart: '2020-01-01', periodEnd: '2100-01-01', phone: '+61400000000' } }))
  const bar = page.root.findByProps({ role: 'progressbar' })
  expect(bar.props['aria-valuenow']).toBe(1)
  expect(bar.props['aria-valuetext']).toBe('2 of 1 credits used')
  expect(page.root.findByProps({ role: 'status' }).children.join('')).toContain('no credits remain')
  act(() => page.unmount())
})
