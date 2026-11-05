import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AIScan, { scanFailureMessage } from '../components/ui/AIScan'
import PlusPromotion from '../components/ui/PlusPromotion'
import { PLUS_PROMOTION_TERMS } from '../../shared/plus-promotion.js'
import { plusFeatureList, showPlanPricingUI } from './billingPageAndroidGate'
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Claude API error', status: 400, details: { error: { message: 'SECRET PROVIDER TEXT' } } }), { status: 500 })))
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
    expect(toast).toHaveBeenCalledTimes(1)
    const [msg, kind] = toast.mock.calls[0]
    expect(kind).toBe('error')
    expect(msg).toContain('iDogs Scan is unavailable right now (code 400)')
    expect(msg).toContain('Your document is kept')
    expect(msg).not.toContain('SECRET PROVIDER TEXT')
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][3]).toEqual({ scanFailed: true })
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

  it('native apps (iOS and Android) get no plan prices or purchase UI; web keeps them', () => {
    expect(showPlanPricingUI(true)).toBe(false)
    expect(showPlanPricingUI(false)).toBe(true)
    expect(plusFeatureList(true)).not.toContain('Extra litters A$39 each')
    expect(plusFeatureList(false)).toContain('Extra litters A$39 each')
  })

  it('dog-limit copy no longer claims free features need Plus', () => {
    for (const copy of [dogLimitReachedBody(true), dogLimitReachedBody(false)]) {
      expect(copy).toContain('documents, QR Passports, reminders and ownership transfer stay free')
      expect(copy).not.toMatch(/unlock iDogs Scan|documents, and ownership transfer are Plus/)
    }
  })
})

describe('scan failure messages', () => {
  it('keeps quota and auth guidance, hides provider details', () => {
    // Server copy says "AI scans" + upgrade; the app now builds its own text.
    const plusNative = scanFailureMessage(403, { reason: 'SCAN_QUOTA_EXCEEDED', plan: 'plus', error: 'You have used all 10 AI scans for this billing period.' }, true)
    expect(plusNative).toBe("You've used all 10 iDogs Scans for this billing period — resets next period.")
    const freeNative = scanFailureMessage(403, { reason: 'SCAN_QUOTA_EXCEEDED', plan: 'free', error: 'You have used both of your free AI scans. Upgrade to Plus for 10 scans/month.' }, true)
    expect(freeNative).toBe('Free iDogs Scans used up for this account.')
    for (const m of [plusNative, freeNative]) { expect(m).not.toMatch(/\bAI scans\b|Upgrade/) }
    expect(scanFailureMessage(403, { reason: 'SCAN_QUOTA_EXCEEDED', plan: 'free' }, false)).toContain('upgrade to Plus')
    expect(scanFailureMessage(401, {})).toBe('Please sign in again to use iDogs Scan.')
    expect(scanFailureMessage(500, { error: 'Claude API error', status: 529 })).toBe('iDogs Scan is unavailable right now (code 529). Nothing was charged to your scan allowance.')
    expect(scanFailureMessage(502, {})).toContain('(code 502)')
  })

  it('Add Dog never shows a success toast after a failed scan', () => {
    const dogNew = readFileSync(fileURLToPath(new URL('../pages/DogNewPage.tsx', import.meta.url)), 'utf8')
    expect(dogNew).toContain("if (!meta?.scanFailed) toast(`Scanned!")
  })
})
