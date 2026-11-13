// Owner decision 13 Nov 2026: customers can also reach iDogs Support on
// WhatsApp; the Owner answers from his own WhatsApp. We only build a wa.me
// link — nothing is sent automatically, and no account details (email, uid)
// are put in the link. The customer presses Send in WhatsApp themselves.
export const SUPPORT_WHATSAPP_NUMBER = '61470545393'
export const SUPPORT_WHATSAPP_DISPLAY = '+61 470 545 393'

const GREETING = 'Hi iDogs Support,'
const MAX_QUESTION_CHARS = 500

// Owner decision 13 Nov 2026: pre-fill a short message about the topic the
// customer is asking about. FREE GIFT wording is the Owner's exact text.
const TOPICS: { message: string; pattern: RegExp }[] = [
  { message: "Hi iDogs Support, I'd like to ask about the FREE Gift Voucher.", pattern: /\b(gift|voucher|free\s*year|free\s*plus|qu[aà]\s*t[aặ]ng|claim)\b/i },
  { message: "Hi iDogs Support, I'd like to ask about my plan or billing.", pattern: /\b(billing|bill|plan|plus|price|pricing|pay|payment|paid|subscri\w*|refund|charge\w*|invoice|cancel\w*)\b/i },
  { message: "Hi iDogs Support, I'd like to ask about the QR Passport.", pattern: /\b(qr|passport)\b/i },
  { message: "Hi iDogs Support, I'd like to ask about transferring a dog.", pattern: /\b(transfer\w*|new\s+owner|buyer)\b/i },
  { message: "Hi iDogs Support, I'd like to ask about iDogs Scan.", pattern: /\b(scan\w*|vaccination\s+book)\b/i },
]

export function whatsappSupportMessage(question?: string, category?: string): string {
  const q = (question || '').replace(/\s+/g, ' ').trim()
  const haystack = `${q} ${category || ''}`
  const topic = TOPICS.find(t => t.pattern.test(haystack))
  if (topic) return topic.message
  if (q) return `${GREETING} ${q.slice(0, MAX_QUESTION_CHARS)}`
  const cat = (category || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (cat) return `${GREETING} I'd like to ask about ${cat}.`
  return `${GREETING} I need help with iDogs.`
}

export function whatsappSupportUrl(question?: string, category?: string): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(whatsappSupportMessage(question, category))}`
}
