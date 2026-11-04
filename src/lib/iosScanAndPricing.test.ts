import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AIScan from '../components/ui/AIScan'
import PlusPromotion from '../components/ui/PlusPromotion'
import { PLUS_PROMOTION_TERMS } from '../../shared/plus-promotion.js'
import { plusFeatureList, showInformationalPlanPrices, showPlanPricingUI, nativeIosBillingIntroCopy } from './billingPageAndroidGate'
import { dogLimitReachedBody } from './nativeUpgradeCopy'

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({
  user: { getIdToken: async () => 'synthetic-token' }, profile: { plan: 'free' },
}) }))

afterEach(() => vi.unstubAllGlobals())

const text = (node: unknown) => JSON.stringify(node)
const billingPage = readFileSync(fileURLToPath(new URL('../pages/BillingPage.tsx', import.meta.url)), 'utf8')

describe('iOS iDogs Scan picker', () => {
  it('opens through a native label and never forces camera-only capture', () => {
    const r = create(createElement(AIScan, { onResult: vi.fn(), toast: vi.fn() }))
    const input = r.root.findByType('input')
    expect(input.props.capture).toBeUndefined()
    expect(input.props.accept).toBe('image/*,application/pdf')
    expect(input.props.style?.display).not.toBe('none')
    const label = r.root.findByType('label')
    expect(label.props.htmlFor).toBe(input.props.id)
    expect(label.props.onClick).toBeUndefined()
    expect(label.props.onMouseEnter).toBeUndefined()
    act(() => r.unmount())
  })

  it('reports a failed scan on Add Dog instead of staying silent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Claude API error' }), { status: 500 })))
    vi.stubGlobal('FileReader', class {
      result = 'data:application/pdf;base64,c3ludGhldGlj'
      onload: (() => void) | null = null
      readAsDataURL() { this.onload?.() }
    })
    const toast = vi.fn()
    const onResult = vi.fn()
    const r = create(createElement(AIScan, { onResult, toast }))
    act(() => r.root.findByType('input').props.onChange({ target: { files: [{ name: 's.pdf', type: 'application/pdf' }], value: 'x' } }))
    const allow = r.root.findAllByType('button').find(b => b.children.join('').startsWith('Allow'))!
    await act(async () => { await allow.props.onClick() })
    expect(toast).toHaveBeenCalledWith('iDogs Scan failed: Claude API error', 'error')
    expect(onResult).toHaveBeenCalledTimes(1)
    act(() => r.unmount())
  })
})

describe('iOS Free/Plus parity with idogs.com.au', () => {
  it('shows the website promotion: struck-through A$7, A$0 through 31 Jan 2027, then A$7 incl. GST and terms', () => {
    const out = text(create(createElement(PlusPromotion)).toJSON())
    expect(out).toContain('"type":"del"')
    expect(out).toContain('A$7')
    expect(out).toContain('A$0')
    expect(out).toContain('31 January 2027')
    expect(out).toContain('from 1 February 2027, including GST.')
    expect(PLUS_PROMOTION_TERMS).toContain('Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.')
  })

  it('iOS gets informational prices and the full Plus list; Android stays price-free; no plan picker in any app', () => {
    expect(showInformationalPlanPrices(false)).toBe(true)
    expect(showInformationalPlanPrices(true)).toBe(false)
    expect(showPlanPricingUI(true)).toBe(false)
    expect(plusFeatureList(false)).toEqual([
      'Up to 5 dogs', 'Everything in Free', '10 iDogs Document Scans / month',
      '2 litters per rolling 12 months', 'Extra litters A$39 each', 'PDF & CSV report export',
    ])
    expect(nativeIosBillingIntroCopy()).toContain('include GST')
    expect(nativeIosBillingIntroCopy()).not.toMatch(/idogs\.com\.au|website|web/i)
  })

  it('BillingPage keeps every purchase control (button, consent, portal) web-only', () => {
    expect(billingPage).toContain("{promotionActive && interval === 'plus_monthly' && !isPlus && !nativePurchasesUnavailable && <label className=\"plus-promotion-consent\">")
    expect(billingPage).toMatch(/\) : nativePurchasesUnavailable \? \(\s*<div[^>]*>\{androidPlanUnavailableNotice\(\)\}/)
    expect(billingPage).toContain('{showInformationalPlanPrices(isAndroidApp) && <>')
    expect(billingPage).toContain('plusFeatureList(isAndroidApp)')
    for (const f of ['Up to 2 dogs', 'Permanent Dog ID & QR Passport', 'Health records & email reminders', 'Ownership transfer', '2 free iDogs Scan — one-time']) {
      expect(billingPage).toContain(`'${f}'`)
    }
  })

  it('dog-limit copy no longer claims free features need Plus', () => {
    for (const copy of [dogLimitReachedBody(true), dogLimitReachedBody(false)]) {
      expect(copy).toContain('documents, QR Passports, reminders and ownership transfer stay free')
      expect(copy).not.toMatch(/unlock iDogs Scan|documents, and ownership transfer are Plus/)
    }
  })
})
