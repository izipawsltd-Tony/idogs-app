import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PlusPromotion from './PlusPromotion'
import { PLUS_MONTHLY_PRICE_AUD } from '../../lib/pricingCopy'

describe('Plus promotion pricing presentation', () => {
  it('shows regular A$7 crossed out before A$0 and preserves renewal disclosure', () => {
    const markup = renderToStaticMarkup(<PlusPromotion />)
    expect(PLUS_MONTHLY_PRICE_AUD).toBe(7)
    expect(markup).toContain('<del class="plus-promotion-original-price"')
    expect(markup).toContain('>A$7</del>')
    expect(markup).toContain('<strong>A$0</strong>')
    expect(markup.indexOf('>A$7</del>')).toBeLessThan(markup.indexOf('<strong>A$0</strong>'))
    expect(markup).toContain('31 January 2027')
    expect(markup).toContain('1 February 2027')
    expect(markup).toContain('A$7/month')
    expect(markup).toContain('Renews automatically unless cancelled')
  })
})
