import { describe, expect, it } from 'vitest'
import { SUPPORT_WHATSAPP_NUMBER, whatsappSupportMessage, whatsappSupportUrl } from './supportContact'

const textOf = (url: string) => new URL(url).searchParams.get('text')

describe('WhatsApp support link', () => {
  it('opens the Owner WhatsApp number with a default greeting', () => {
    expect(SUPPORT_WHATSAPP_NUMBER).toBe('61470545393')
    const url = new URL(whatsappSupportUrl())
    expect(url.origin + url.pathname).toBe('https://wa.me/61470545393')
    expect(url.searchParams.get('text')).toBe('Hi iDogs Support, I need help with iDogs.')
  })

  it('uses the Owner wording for FREE GIFT questions (English or Vietnamese)', () => {
    const want = "Hi iDogs Support, I'd like to ask about the FREE Gift Voucher."
    expect(textOf(whatsappSupportUrl('toi muon hoi ve chuong trinh FREE GIFT'))).toBe(want)
    expect(whatsappSupportMessage('How do I claim my voucher?')).toBe(want)
    expect(whatsappSupportMessage('is the free year really free')).toBe(want)
  })

  it('pre-fills a short topic message for other common topics', () => {
    expect(whatsappSupportMessage('Why was my card charged?')).toBe("Hi iDogs Support, I'd like to ask about my plan or billing.")
    expect(whatsappSupportMessage('My QR code does not open')).toBe("Hi iDogs Support, I'd like to ask about the QR Passport.")
    expect(whatsappSupportMessage('how to transfer puppy to buyer')).toBe("Hi iDogs Support, I'd like to ask about transferring a dog.")
    expect(whatsappSupportMessage('Scanning failed')).toBe("Hi iDogs Support, I'd like to ask about iDogs Scan.")
  })

  it('falls back to the question itself, then the chosen topic', () => {
    expect(whatsappSupportMessage('  My  dog\n photo is wrong ')).toBe('Hi iDogs Support, My dog photo is wrong')
    expect(whatsappSupportMessage('', 'complaint')).toBe("Hi iDogs Support, I'd like to ask about complaint.")
    expect(whatsappSupportUrl('a&b #1')).toContain('text=Hi%20iDogs%20Support%2C%20a%26b%20%231')
    expect((textOf(whatsappSupportUrl('x'.repeat(2000))) || '').length).toBe('Hi iDogs Support, '.length + 500)
  })
})
