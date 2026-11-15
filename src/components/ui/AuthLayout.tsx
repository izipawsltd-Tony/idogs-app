import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './auth-layout.css'
export default function AuthLayout({ title, description, children, backTo = '/', backLabel = 'Back to iDogs' }: { title: string; description: string; children: ReactNode; backTo?: string; backLabel?: string }) {
  return <main className="idogs-auth"><header className="idogs-auth-header"><Link to="/" aria-label="iDogs home"><img src="/01_idogs_primary_horizontal_transparent.png" alt="iDogs" /></Link><Link to={backTo}>{backLabel}</Link></header><section className="idogs-auth-card"><div className="idogs-auth-heading"><span className="idogs-auth-eyebrow">YOUR DOG. THEIR STORY.</span><h1>{title}</h1><p>{description}</p></div>{children}</section><footer className="idogs-auth-footer">iDogs · Every dog’s story, forever</footer></main>
}
