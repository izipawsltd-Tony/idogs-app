import { describe, expect, it } from 'vitest'
import { SUPPORT_WHATSAPP_NUMBER, whatsappSupportUrl } from './supportContact'

describe('WhatsApp support link', () => {
  it('opens the Owner WhatsApp number with a default greeting', () => {
    expect(SUPPORT_WHATSAPP_NUMBER).toBe('61470545393')
    const url = new URL(whatsappSupportUrl())
    expect(url.origin + url.pathname).toBe('https://wa.me/61470545393')
    expect(url.searchParams.get('text')).toBe('Hi iDogs Support, I need help with iDogs.')
  })

  it('pre-fills the customer question, tidied and safely encoded', () => {
    const url = new URL(whatsappSupportUrl('  How do I   transfer my puppy?\n& keep records #1 '))
    expect(url.searchParams.get('text')).toBe('Hi iDogs Support, How do I transfer my puppy? & keep records #1')
    expect(whatsappSupportUrl('a&b')).toContain('text=Hi%20iDogs%20Support%2C%20a%26b')
  })

  it('caps very long questions', () => {
    const text = new URL(whatsappSupportUrl('x'.repeat(2000))).searchParams.get('text') || ''
    expect(text.length).toBe('Hi iDogs Support, '.length + 500)
  })
})
