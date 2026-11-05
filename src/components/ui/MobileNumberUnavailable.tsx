// Mobile-number (SMS) sign-in needs a reCAPTCHA flow that the iOS app does
// not support yet. Show the same tab as idogs.com.au with an honest next
// step instead of a control that would fail.
export function MobileNumberUnavailable({ onUseEmail }: { onUseEmail: () => void }) {
  return <div className="idogs-auth-form" role="note">
    <p className="idogs-auth-small" style={{ margin: 0 }}>Mobile number sign-in isn’t available in the iPhone app yet.</p>
    <p className="idogs-auth-small" style={{ margin: 0 }}>If you joined iDogs with your mobile number, sign in at idogs.com.au and add an email and password in Settings. Then use them here — your dogs and records stay the same.</p>
    <button type="button" className="btn btn-primary" onClick={onUseEmail}>Use email instead</button>
  </div>
}
