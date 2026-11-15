import { describe, expect, it, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import LaunchOfferCard from './LaunchOfferCard'

const status = {
  promotionSuperseded: true,
  launch: { active: true, remaining: 80, endsAt: '2026-12-31T13:30:00.000Z', showRemaining: false },
  pass: { active: false, endsAt: '2026-12-31T13:30:00.000Z' },
}

function render(props: Record<string, unknown>) {
  const card = createElement(LaunchOfferCard as never, { status, user: null, hasPass: false, toast: () => undefined, ...props })
  return renderToStaticMarkup(createElement(MemoryRouter, null, card))
}

describe('Gift Voucher card on Billing', () => {
  beforeAll(() => { (globalThis as { window?: unknown }).window ??= {} })

  it('offers the voucher to an account without a paid plan', () => {
    const markup = render({})
    expect(markup).toContain('data-testid="launch-offer-card"')
    expect(markup).toContain('Claim your Gift Voucher')
  })

  it('is hidden for an account with a live Plus subscription', () => {
    expect(render({ hasSubscription: true })).toBe('')
  })

  it('is hidden for an account that already holds a pass', () => {
    expect(render({ hasPass: true })).toBe('')
  })
})
