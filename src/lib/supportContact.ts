// Owner decision 13 Nov 2026: customers can also reach iDogs Support on
// WhatsApp; the Owner answers from his own WhatsApp. We only build a wa.me
// link — nothing is sent automatically, and no account details (email, uid)
// are put in the link. The customer decides what to send.
export const SUPPORT_WHATSAPP_NUMBER = '61470545393'
export const SUPPORT_WHATSAPP_DISPLAY = '+61 470 545 393'

const GREETING = 'Hi iDogs Support,'
const MAX_QUESTION_CHARS = 500

export function whatsappSupportUrl(question?: string): string {
  const q = (question || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_CHARS)
  const text = q ? `${GREETING} ${q}` : `${GREETING} I need help with iDogs.`
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`
}
