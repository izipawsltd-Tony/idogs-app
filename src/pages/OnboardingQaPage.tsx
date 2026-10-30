import { useState } from 'react'
import { Navigate, Link, useNavigate } from 'react-router-dom'
import { signInWithCustomToken } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
export default function OnboardingQaPage({ management = false }: { management?: boolean }) {
  const { user } = useAuth(), navigate = useNavigate()
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[mail,setMail]=useState<{label:string;url:string}[]>([])
  if (!import.meta.env.DEV || import.meta.env.VITE_ACCOUNT_ONBOARDING_QA!=='1' || import.meta.env.VITE_FIREBASE_PROJECT_ID!=='demo-idogs-account-onboarding') return <Navigate to="/" replace />
  async function action(kind:'start'|'mailbox'|'manage') {
    setBusy(true);setMessage('')
    try {
      const r=await fetch(`/api/qa-onboarding/${kind}`,{method:kind==='start'?'POST':'GET',headers:user?{Authorization:`Bearer ${await user.getIdToken(true)}`}:{},cache:'no-store'})
      if(!r.ok)throw new Error()
      const data=await r.json()
      if(kind==='start'){await signInWithCustomToken(auth,data.token);navigate('/app/onboarding-check')}
      else if(kind==='mailbox')setMail(data.messages)
      else setMessage(`Account ready. Your saved dog is ${data.dogName}. Your plan is still ${data.plan}.`)
    }catch{setMessage('Could not complete this QA step. Check account setup and try again.')}
    finally{setBusy(false)}
  }
  return <main className="idogs-auth"><section className="idogs-auth-card" style={{maxWidth:620}}>
    <h1>{management?'Your account is ready':'Account setup — local QA'}</h1>
    <p className="idogs-auth-small" style={{margin:'16px 0'}}>Synthetic account only. No real email/SMS is sent. Use a made-up email ending in @example.invalid and a test password.</p>
    <div className="idogs-auth-form">
      {!management && <><p>This opens an existing phone account at the stage just after OTP. It does not create a new identity.</p><button className="btn btn-primary" disabled={busy} onClick={()=>void action('start')}>Open phone account demo</button></>}
      {management && <button className="btn btn-primary" disabled={busy} onClick={()=>void action('manage')}>Check saved dog and plan</button>}
      {user && <><button className="btn btn-secondary" disabled={busy} onClick={()=>void action('mailbox')}>Open simulated email inbox</button>{mail.map((m,i)=><a key={i} href={m.url} target="_blank" rel="noreferrer">{m.label}</a>)}<Link to="/complete-account?next=%2Fapp%2Fonboarding-check">Continue account setup</Link></>}
      {message && <p role="status">{message}</p>}
      <Link to="/p/ONBOARDING-DEMO">View public QR profile</Link>
    </div>
  </section></main>
}
