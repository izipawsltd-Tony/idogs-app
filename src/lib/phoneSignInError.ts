// Maps a Firebase phone sign-in failure to customer text, and extracts the
// auth/... code for diagnostics (code only — never the number, OTP or token).
export function phoneSignInErrorCode(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err || '')
  const code = (err as { code?: unknown })?.code
  return typeof code === 'string' ? code : (text.match(/auth\/[a-z0-9-]+/)?.[0] || 'unknown')
}

export function phoneSignInErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err || '')
  const code = phoneSignInErrorCode(err)
  // The web address is not an authorized domain of this Firebase project:
  // reCAPTCHA is rejected server-side ("Hostname match not found"). Not a
  // cookie problem — telling the customer to change browser cannot help.
  if (code === 'auth/unauthorized-domain' || /hostname match not found|unauthorized-domain/i.test(msg)) {
    return 'Mobile sign-in isn’t available on this web address. Open iDogs at idogs.com.au, or sign in with email.'
  }
  if (msg.includes('invalid-verification-code')) return 'That code is not correct. Please try again.'
  if (msg.includes('invalid-phone-number')) return 'Please enter a valid mobile number, such as 0412 345 678 or +61 412 345 678.'
  if (msg.includes('captcha-check-failed') || msg.includes('invalid-app-credential')) return 'The browser security check could not finish. Open this page in Safari or Chrome with cookies enabled, then try again.'
  if (msg.includes('code-expired') || msg.includes('session-expired')) return 'That code has expired. Choose another method, then request a new code.'
  if (msg.includes('too-many-requests') || msg.includes('quota-exceeded')) return 'Too many requests. Please wait and try again, or use email.'
  if (msg.includes('billing-not-enabled') || msg.includes('operation-not-allowed')) return 'SMS sign-in is temporarily unavailable. Please use email and password.'
  if (msg.startsWith('Firebase:')) return 'Could not continue. Please try again or choose another sign-in method.'
  return msg || 'Could not continue. Please try again.'
}
