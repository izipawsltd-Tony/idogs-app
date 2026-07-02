import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// ── FEATURE FLAGS ──────────────────────────────────────────────
// Set SHOW_SOCIAL_PROOF = true when real data is available
const SHOW_SOCIAL_PROOF = false

export default function LandingPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [waitlistName, setWaitlistName] = useState('')
  const [waitlistEmail, setWaitlistEmail] = useState('')
  const [waitlistRole, setWaitlistRole] = useState('')
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false)
  const [waitlistDone, setWaitlistDone] = useState(false)
  const [waitlistError, setWaitlistError] = useState('')

  useEffect(() => {
    if (!loading && user) navigate('/app/dashboard')
  }, [user, loading])

  async function handleWaitlist(e: React.FormEvent) {
    e.preventDefault()
    if (!waitlistName || !waitlistEmail || !waitlistRole) return
    setWaitlistSubmitting(true)
    setWaitlistError('')
    try {
      const res = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: waitlistName, email: waitlistEmail, role: waitlistRole, source: 'waitlist' }),
      })
      if (!res.ok) throw new Error('Failed')
      setWaitlistDone(true)
    } catch {
      setWaitlistError('Something went wrong. Please try again or email hello@idogs.com.au')
    } finally {
      setWaitlistSubmitting(false)
    }
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sand)', fontFamily: 'var(--font-body)' }}>

      {/*
        SEO META (set in index.html or your React Helmet / Vite plugin):
        <title>iDogs | Every Dog's Story, Forever</title>
        <meta name="description" content="Australia's digital passport and record system for breeders, kennels and dog owners." />
      */}

      {/* Mobile responsive overrides */}
      <style>{`
        @media (max-width: 640px) {
          .hero-cta-group { flex-direction: column !important; align-items: stretch !important; }
          .hero-cta-group .btn { width: 100% !important; justify-content: center !important; }
          .features-grid { grid-template-columns: 1fr !important; }
          .pricing-grid { grid-template-columns: 1fr !important; }
          .footer-grid { flex-direction: column !important; gap: 32px !important; }
          .footer-grid > div { max-width: 100% !important; }
          .waitlist-form .form-group { margin-bottom: 4px; }
          .waitlist-form .form-input,
          .waitlist-form .form-select { height: 48px !important; font-size: 16px !important; }
        }
        @media (max-width: 900px) {
          .feature-split { grid-template-columns: 1fr !important; }
          .feature-split > div:first-child { min-height: 260px !important; }
        }
      `}</style>

      {/* ── NAV ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src="/logo.png" alt="iDogs" style={{ height: 50, width: 'auto', objectFit: 'contain' }} />
        </div>
        {/* Nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[
            { label: 'How it Works', id: 'how-it-works' },
            { label: 'Pricing', id: 'pricing' },
            { label: 'FAQ', id: 'faq' },
          ].map(link => (
            <button
              key={link.id}
              onClick={() => scrollTo(link.id)}
              style={{ fontSize: 13, color: 'var(--mid)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 6, fontFamily: 'var(--font-body)', fontWeight: 500 }}
            >
              {link.label}
            </button>
          ))}
          <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
          <button onClick={() => navigate('/login')} style={{ fontSize: 13, color: 'var(--mid)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 6, fontFamily: 'var(--font-body)', fontWeight: 500 }}>Sign In</button>
          <button onClick={() => navigate('/signup')} className="btn btn-primary" style={{ fontSize: 13, padding: '8px 16px', height: 36 }}>Start Free</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{
        minHeight: '100vh', paddingTop: 100, paddingBottom: 80,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '100px 24px 80px', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 60% at 50% 40%,rgba(29,158,117,0.07) 0%,transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: 20, background: 'var(--gold-light)', border: '1px solid rgba(200,151,31,0.25)', marginBottom: 28, fontSize: 12, fontWeight: 500, color: '#7A5A10' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block' }} />
          NSW Puppy Farm Act 2024 · Dogs Australia compliant
        </div>

        {/* SEO H1 */}
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 'clamp(38px,6vw,64px)', fontWeight: 600,
          lineHeight: 1.1, letterSpacing: '-0.03em', color: 'var(--dark)',
          maxWidth: 780, margin: '0 auto 36px',
        }}>
          Every dog's story,<br />
          <span style={{ color: 'var(--green)' }}>forever</span>
        </h1>

        {/* Primary subheading */}
        <p style={{ fontSize: 'clamp(16px,2.2vw,20px)', color: 'var(--dark)', maxWidth: 620, margin: '0 auto 12px', lineHeight: 1.55, fontWeight: 500 }}>
          Australia's digital passport and record system for breeders, kennels and dog owners.
        </p>

        {/* Brand positioning line */}
        <p style={{ fontSize: 'clamp(13px,1.6vw,15px)', color: 'var(--light)', maxWidth: 480, margin: '0 auto 28px', lineHeight: 1.65, fontStyle: 'italic' }}>
          From puppy to forever. Designed for every dog's lifetime journey.
        </p>

        {/* Audience badges — Breeders first */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 40 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--mid)', marginRight: 4 }}>Built for</span>
          {['✓ Breeders', '✓ Kennels', '✓ Dog Owners'].map(label => (
            <span key={label} style={{
              fontSize: 13, fontWeight: 600, padding: '5px 14px', borderRadius: 20,
              background: 'var(--green-light)', color: 'var(--green)',
              border: '1px solid rgba(8,80,65,0.12)',
            }}>{label}</span>
          ))}
        </div>

        {/* Life timeline */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth: 600, width: '100%', margin: '0 auto 48px', position: 'relative' }}>
          {[
            { emoji: '🐣', label: 'Born' },
            { emoji: '🐶', label: 'Puppy' },
            { emoji: '🏷️', label: 'Passport', highlight: true },
            { emoji: '🐕', label: 'Adult' },
            { emoji: '🌅', label: 'Senior' },
            { emoji: '🕊️', label: 'Forever' },
          ].map((stage, i, arr) => (
            <div key={stage.label} style={{ display: 'flex', alignItems: 'center', flex: i < arr.length - 1 ? 1 : undefined }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  border: `2px solid ${stage.highlight ? 'var(--green-mid)' : 'var(--border)'}`,
                  background: stage.highlight ? 'var(--green-light)' : 'var(--white)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, cursor: 'default',
                }}>
                  {stage.emoji}
                </div>
                <span style={{ fontSize: 10, color: stage.highlight ? 'var(--green)' : 'var(--light)', fontWeight: 500, letterSpacing: '.04em', textTransform: 'uppercase' }}>{stage.label}</span>
              </div>
              {i < arr.length - 1 && (
                <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg,var(--green-light),var(--green-mid),var(--green-light))', marginBottom: 16 }} />
              )}
            </div>
          ))}
        </div>

        {/* CTAs — mobile stack via flexWrap */}
        <div className="hero-cta-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <button onClick={() => navigate('/signup')} className="btn btn-primary btn-lg" style={{ minWidth: 240 }}>
            Create Your Dog's Passport Free
          </button>
          <button onClick={() => scrollTo('how-it-works')} className="btn btn-secondary btn-lg">
            See How It Works →
          </button>
          <button
            onClick={() => scrollTo('features')}
            className="btn btn-ghost btn-lg"
          >
            ▶ See iDogs in Action
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--light)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span>🔒 Data secured in Asia-Pacific</span>
          <span>🔒 Australian Privacy Act compliant</span>
          <span>⚡ No credit card required</span>
        </div>
      </section>

      {/* ── PROOF BAR ── */}
      <div style={{ background: 'var(--white)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '18px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          {[
            { icon: '🐾', label: 'Built for Dogs Australia breeders & owners' },
            { icon: '📋', label: 'Designed for NSW Puppy Farm Act 2024 compliance' },
            { icon: '🔒', label: 'Australian Privacy Act 1988 compliant' },
            { icon: '🇦🇺', label: 'Data secured in Asia-Pacific' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>{s.icon}</span>
              <div style={{ fontSize: 12, color: 'var(--mid)', fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SECTION 1: BREEDER SOFTWARE ── */}
      <section id="features" style={{ background: 'var(--white)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12, textAlign: 'center' }}>For breeders & kennels</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px,4vw,36px)', fontWeight: 600, color: 'var(--dark)', marginBottom: 12, lineHeight: 1.2, letterSpacing: '-0.02em', textAlign: 'center' }}>
            Breeder Software for Australian Dog Breeders
          </h2>
          <p style={{ fontSize: 16, color: 'var(--mid)', maxWidth: 560, margin: '0 auto 56px', textAlign: 'center', lineHeight: 1.6 }}>
            Everything breeders need to manage records, documents and puppy information in one place.
          </p>

          {/* AI Scan feature */}
          <div className="feature-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center', marginBottom: 80 }}>
            <div style={{ background: 'var(--sand)', borderRadius: 24, padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 360 }}>
              <AIScanMockup />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12 }}>AI document scan</div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px,3vw,32px)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--dark)', marginBottom: 12, lineHeight: 1.25 }}>Photograph a vet card.<br />Done.</h3>
              <p style={{ fontSize: 15, color: 'var(--mid)', lineHeight: 1.7, marginBottom: 24 }}>Point your phone at any vet card, pedigree certificate, or OFA document. iDogs reads it and fills in the profile automatically.</p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  'Vaccination cards, worming records, vet notes',
                  'OFA/PennHIP certificates, eye tests, DNA results',
                  'Dogs Australia pedigree certificates',
                  'Uncertain dates highlighted for your review',
                ].map(item => (
                  <li key={item} style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--mid)', alignItems: 'flex-start' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--green-light)', border: '2px solid var(--green-mid)', flexShrink: 0, marginTop: 1 }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Steps */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24, marginBottom: 48 }}>
            {[
              { step: '01', icon: '📸', title: 'Scan your documents', desc: 'Photograph vaccine cards, pedigree certs, or health test results. Our AI extracts all fields automatically — dates, vaccines, vet clinic names.' },
              { step: '02', icon: '🐾', title: "Build your dog's digital passport", desc: 'Every record in one place, accessible anywhere. Each dog gets a unique QR code for instant sharing with vets, buyers, and boarding kennels.' },
              { step: '03', icon: '🔔', title: 'Never miss a due date', desc: 'Automatic email reminders before vaccines and worming treatments expire — for every dog in your kennel, across every breed.' },
              { step: '04', icon: '📄', title: 'Export when you need it', desc: 'One-click PDF or CSV report for Dogs Australia inspections, ownership transfers, or personal records. Covers all Australian state requirements.' },
            ].map((item, i) => (
              <div key={i}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', letterSpacing: '0.08em', marginBottom: 12 }}>STEP {item.step}</div>
                <div style={{ fontSize: 36, marginBottom: 14 }}>{item.icon}</div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)', marginBottom: 10, lineHeight: 1.3 }}>{item.title}</h3>
                <p style={{ fontSize: 14, color: 'var(--mid)', lineHeight: 1.7 }}>{item.desc}</p>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center' }}>
            <button onClick={() => navigate('/signup')} className="btn btn-primary" style={{ fontSize: 16, padding: '16px 40px', borderRadius: 12, height: 'auto' }}>
              Start Free for 30 Days →
            </button>
            <p style={{ fontSize: 13, color: 'var(--light)', marginTop: 12 }}>Free forever for 1-2 dogs · Paid plans from $5/month</p>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: PERMANENT RECORDS ── */}
      <section style={{ background: 'var(--sand)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12, textAlign: 'center' }}>Records & documents</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px,4vw,36px)', fontWeight: 600, color: 'var(--dark)', marginBottom: 48, lineHeight: 1.2, letterSpacing: '-0.02em', textAlign: 'center' }}>
            Permanent Dog Records and Documents
          </h2>

          {/* How it works steps */}
          <div id="how-it-works" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 2, background: 'var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            {[
              { emoji: '🐾', num: '01', title: 'Create your account', desc: 'Sign up with your email in 60 seconds. No credit card required.' },
              { emoji: '📸', num: '02', title: 'Add your dogs', desc: 'Photograph vaccine cards and pedigree certs. AI fills in the details.' },
              { emoji: '🏷️', num: '03', title: 'Activate passports', desc: 'Each dog gets a QR passport automatically. Show it from your phone at every vet visit.' },
              { emoji: '🤝', num: '04', title: 'Hand over with confidence', desc: 'When you sell a puppy, the new owner gets their full history. Their story continues.' },
            ].map(step => (
              <div key={step.num} style={{ background: 'var(--white)', padding: '32px 28px' }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 20 }}>{step.emoji}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, fontWeight: 600, color: 'var(--sand-dark)', lineHeight: 1, marginBottom: 16, letterSpacing: '-0.04em' }}>{step.num}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--dark)', marginBottom: 8 }}>{step.title}</div>
                <p style={{ fontSize: 14, color: 'var(--mid)', lineHeight: 1.6 }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 3: DIGITAL PASSPORT (QR) ── */}
      <section style={{ background: 'var(--white)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div className="feature-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12 }}>QR passport</div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px,4vw,36px)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--dark)', marginBottom: 12, lineHeight: 1.25 }}>
                Every puppy leaves<br />with a digital passport.
              </h2>
              <p style={{ fontSize: 15, color: 'var(--mid)', lineHeight: 1.7, marginBottom: 24 }}>When your puppy goes to their new home, you hand over their entire story — in a QR code that lives in their owner's phone wallet.</p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  'Vet scans QR before consult — no re-taking history',
                  'Kennel check-in auto-filled — no paper forms',
                  'Emergency info visible without login',
                  'Record lives forever — even after the dog passes',
                ].map(item => (
                  <li key={item} style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--mid)', alignItems: 'flex-start' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--green-light)', border: '2px solid var(--green-mid)', flexShrink: 0, marginTop: 1 }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ background: 'var(--green)', borderRadius: 24, padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 360 }}>
              <PhoneMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ── MISSION ── */}
      <section style={{ background: 'var(--green)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px,4.5vw,44px)',
            fontWeight: 600, color: '#fff',
            lineHeight: 1.15, letterSpacing: '-0.03em',
            marginBottom: 24,
          }}>
            Every Dog Has an Identity.
          </h2>
          <p style={{ fontSize: 'clamp(15px,2vw,18px)', color: 'rgba(255,255,255,0.8)', lineHeight: 1.7, marginBottom: 16 }}>
            Too many dogs lose their records, vaccinations and history when they change hands, change vets, or are simply forgotten.
          </p>
          <p style={{ fontSize: 'clamp(15px,2vw,18px)', color: 'rgba(255,255,255,0.8)', lineHeight: 1.7, marginBottom: 40 }}>
            We built iDogs so every dog can have a permanent digital identity that stays with them for life — from their first day with a breeder to their last chapter with a loving owner.
          </p>
          <button onClick={() => navigate('/signup')} style={{
            height: 54, padding: '0 36px', borderRadius: 12,
            background: 'var(--white)', color: 'var(--green)',
            fontSize: 16, fontWeight: 600, border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-display)',
          }}>
            Create Your Dog's Passport Free →
          </button>
        </div>
      </section>

      {/* ── SOCIAL PROOF — hidden until real data, enable via SHOW_SOCIAL_PROOF flag ── */}
      {SHOW_SOCIAL_PROOF && (
        <section style={{ background: 'var(--white)', padding: '80px 24px', borderTop: '1px solid var(--border)' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12 }}>Trusted by</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px,4vw,36px)', fontWeight: 600, color: 'var(--dark)', marginBottom: 48, letterSpacing: '-0.02em' }}>
              Trusted by Australian breeders and dog owners.
            </h2>
            {/* Stats — replace 0s with real numbers before enabling */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 32, marginBottom: 64 }}>
              {[
                { number: '0', label: 'Dogs registered' },
                { number: '0', label: 'Active breeders' },
                { number: '0', label: 'Dog owners' },
              ].map(stat => (
                <div key={stat.label}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 700, color: 'var(--green)', letterSpacing: '-0.03em' }}>{stat.number}</div>
                  <div style={{ fontSize: 14, color: 'var(--mid)', marginTop: 4 }}>{stat.label}</div>
                </div>
              ))}
            </div>
            {/* Testimonials — add real ones before enabling */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 24 }}>
              {[
                { quote: 'Testimonial placeholder.', name: 'Breeder name', location: 'State', breed: 'Breed' },
                { quote: 'Testimonial placeholder.', name: 'Owner name', location: 'State', breed: '' },
              ].map((t, i) => (
                <div key={i} style={{ background: 'var(--sand)', borderRadius: 16, padding: 28, textAlign: 'left' }}>
                  <p style={{ fontSize: 15, color: 'var(--dark)', lineHeight: 1.7, marginBottom: 20, fontStyle: 'italic' }}>"{t.quote}"</p>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dark)' }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--light)' }}>{t.breed ? `${t.breed} breeder · ` : ''}{t.location}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── PRICING ── */}
      <section id="pricing" style={{ background: 'var(--sand)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12 }}>Pricing</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px,4vw,40px)', fontWeight: 600, color: 'var(--dark)', marginBottom: 12, letterSpacing: '-0.02em' }}>Simple, transparent pricing</h2>
          <p style={{ fontSize: 16, color: 'var(--mid)', maxWidth: 500, margin: '0 auto 48px' }}>30-day free trial on all plans. No credit card required. Cancel anytime.</p>
          <div className="pricing-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, maxWidth: 1000, margin: '0 auto 24px' }}>
            <PricingCard plan="Free" price={0} desc="Pet owners with 1-2 dogs" features={['Up to 2 dogs — forever free','QR Passport for each dog','Vaccination & health records','Email reminders','Public passport page']} onStart={() => navigate('/signup')} isFree />
            <PricingCard plan="Basic" price={5} desc="Casual breeders & growing families" features={['Up to 10 dogs','Everything in Free','AI Document Scan','Document storage','Export PDF & CSV','Ownership transfer']} onStart={() => navigate('/signup')} />
            <PricingCard plan="Pro" price={12} desc="Active breeders & growing kennels" featured features={['Up to 20 dogs','Everything in Basic','Litter management','Audit trail','SMS reminders +$3/mo','Priority support']} onStart={() => navigate('/signup')} />
            <PricingCard plan="Kennel" price={29} desc="Professional kennels" features={['Unlimited dogs','Everything in Pro','Full compliance export','Multi-litter management','Advanced audit trail','Priority support']} onStart={() => navigate('/signup')} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--light)', marginBottom: 8 }}>All prices in AUD · Paid plans include 30-day free trial · Cancel anytime</p>
          <p style={{ fontSize: 12, color: 'var(--mid)' }}>🐾 <strong>1-2 dogs?</strong> iDogs is free forever — no credit card, no expiry. · 📱 SMS reminders available as $3/month add-on.</p>
        </div>
      </section>

      {/* ── EARLY ACCESS WAITLIST ── */}
      <section style={{ background: 'var(--white)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12 }}>Early access</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px,4vw,36px)', fontWeight: 600, color: 'var(--dark)', marginBottom: 16, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
            Join the Early Access List.
          </h2>
          <p style={{ fontSize: 16, color: 'var(--mid)', marginBottom: 36, lineHeight: 1.6 }}>
            Help shape Australia's future digital passport for dogs.
          </p>

          {waitlistDone ? (
            <div style={{ background: 'var(--green-light)', border: '1.5px solid var(--green-mid)', borderRadius: 16, padding: '32px 24px' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🐾</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--green)', marginBottom: 8 }}>You're on the list!</div>
              <div style={{ fontSize: 14, color: 'var(--mid)' }}>We'll be in touch when early access opens. Thank you for helping build iDogs.</div>
            </div>
          ) : (
            <form onSubmit={handleWaitlist} className="waitlist-form" style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left' }}>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Your name"
                  value={waitlistName}
                  onChange={e => setWaitlistName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="your@email.com"
                  value={waitlistEmail}
                  onChange={e => setWaitlistEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">I am a…</label>
                <select
                  className="form-select"
                  value={waitlistRole}
                  onChange={e => setWaitlistRole(e.target.value)}
                  required
                  style={{ height: 48 }}
                >
                  <option value="">Select one</option>
                  <option value="breeder">Breeder</option>
                  <option value="kennel">Kennel</option>
                  <option value="owner">Dog Owner</option>
                  <option value="vet">Vet</option>
                </select>
              </div>
              {waitlistError && <div className="form-error">{waitlistError}</div>}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={waitlistSubmitting}
                style={{ fontSize: 16, padding: '14px', borderRadius: 10, height: 'auto', marginTop: 4 }}
              >
                {waitlistSubmitting ? 'Joining…' : 'Join Early Access →'}
              </button>
              <div style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--light)', justifyContent: 'center', flexWrap: 'wrap' }}>
                <span>✓ No spam</span>
                <span>✓ No credit card</span>
                <span>✓ Unsubscribe anytime</span>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" style={{ background: 'var(--sand)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12, textAlign: 'center' }}>FAQ</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px,4vw,36px)', fontWeight: 600, color: 'var(--dark)', marginBottom: 48, letterSpacing: '-0.02em', textAlign: 'center' }}>Common questions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              { q: "Where is my data stored?", a: "Your data is stored securely in Asia-Pacific, fully compliant with the Australian Privacy Act 1988." },
              { q: "Does it work for all dog breeds and states?", a: "Yes — iDogs works for all Dogs Australia / Dogs Australia registered breeds across all Australian states and territories. Our compliance export covers NSW, VIC, QLD, SA, WA, TAS, ACT, and NT requirements." },
              { q: "Can my vet or the new owner access my dog's records?", a: "The QR Passport is publicly accessible (no login required) showing vaccine status and basic health info. Full records are only accessible to the dog's registered owner." },
              { q: "What happens to my data if I cancel?", a: "Your data is kept for 30 days after cancellation. You can export everything as PDF or CSV before leaving. We never delete your dogs' stories without notice." },
              { q: "Can I migrate from Excel or another system?", a: "Yes — you can manually add records or use our AI Document Scan to photograph existing paperwork. Most breeders are fully migrated within a day." },
              { q: "Is the 30-day trial really free?", a: "Yes — no credit card required. You get full access to all features for 30 days. After that, choose a plan or your account switches to read-only." },
            ].map((item, i, arr) => (
              <div key={i} style={{ padding: '20px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--dark)', marginBottom: 8 }}>{item.q}</div>
                <div style={{ fontSize: 14, color: 'var(--mid)', lineHeight: 1.7 }}>{item.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section style={{ background: 'var(--green)', padding: '100px 24px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px,5vw,48px)', fontWeight: 600, color: '#fff', lineHeight: 1.15, letterSpacing: '-0.03em', marginBottom: 16 }}>Give every dog a passport today.</h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.7)', marginBottom: 40, lineHeight: 1.6 }}>Start free for 30 days. No credit card. Your dogs' stories start the moment you sign up.</p>
          <button onClick={() => navigate('/signup')} style={{ height: 54, padding: '0 36px', borderRadius: 12, background: 'var(--dark)', color: '#fff', fontSize: 16, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-display)' }}>
            Create Your Dog's Passport Free →
          </button>
          <div style={{ marginTop: 20, fontSize: 12, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span>🇦🇺 Asia-Pacific hosting</span><span>🔒 Privacy Act compliant</span><span>⚡ Cancel anytime</span>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: 'var(--dark)', padding: '48px 24px 32px', color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div className="footer-grid" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 40, flexWrap: 'wrap', marginBottom: 40 }}>
            {/* Brand */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <img src="/logo.png" alt="iDogs" style={{ height: 32, width: 110, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
              </div>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', maxWidth: 240, lineHeight: 1.9, margin: 0 }}>
                Every dog's story, forever.<br />
                Built for Australian breeders, kennels and dog owners.<br />
                <a href="mailto:hello@idogs.com.au" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>hello@idogs.com.au</a>
              </p>
            </div>
            {/* Footer nav columns */}
            {[
              {
                title: 'Company',
                links: [
                  { label: 'About', href: '#' },
                  { label: 'Contact', href: 'mailto:hello@idogs.com.au' },
                  { label: 'Roadmap', href: '#' },
                  { label: 'Blog', href: '#' },
                ],
              },
              {
                title: 'Product',
                links: [
                  { label: 'Features', href: '#features' },
                  { label: 'Pricing', href: '#pricing' },
                  { label: 'QR Passport', href: '#features' },
                  { label: 'AI Document Scan', href: '#features' },
                ],
              },
              {
                title: 'Legal',
                links: [
                  { label: 'Privacy Policy', href: '/privacy' },
                  { label: 'Terms of Service', href: '/terms' },
                ],
              },
            ].map(group => (
              <div key={group.title}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 12 }}>{group.title}</div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {group.links.map(l => (
                    <li key={l.label}>
                      <a href={l.href} style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none', fontSize: 13 }}>{l.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {/* Bottom bar */}
          <div style={{ paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', marginBottom: 4 }}>Every dog has an identity.</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 2 }}>© iDogs. All rights reserved.</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>Australia</div>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ── INLINE COMPONENTS ────────────────────────────────────────

function AIScanMockup() {
  return (
    <div style={{ background: 'var(--white)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', width: '100%', maxWidth: 320 }}>
      <div style={{ background: 'var(--dark)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>AI Document Scan</span>
        <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: 'rgba(29,158,117,0.25)', color: '#5DCAA5', fontWeight: 500 }}>Auto-filling…</span>
      </div>
      {[
        { done: true, label: 'Photo captured', sub: 'Vaccine_Card_Luna.jpg' },
        { done: true, label: 'Text extracted', sub: '12 fields detected' },
        { done: false, label: 'Filling profile', sub: "Matching to Luna's record", active: true },
      ].map(step => (
        <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0, background: step.done ? 'var(--green-light)' : step.active ? 'var(--green)' : 'var(--sand)', color: step.done ? 'var(--green)' : step.active ? '#fff' : 'var(--light)' }}>
            {step.done ? '✓' : step.active ? '→' : '·'}
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--dark)', fontWeight: 500 }}>{step.label}</div>
            <div style={{ fontSize: 11, color: 'var(--light)' }}>{step.sub}</div>
          </div>
        </div>
      ))}
      {[
        { label: 'Vaccine', value: 'C8 Distemper combo' },
        { label: 'Date given', value: '14 Mar 2026' },
        { label: 'Next due', value: '14 Mar 2027' },
        { label: 'Vet clinic', value: 'Paws & Claws, Adelaide' },
      ].map(f => (
        <div key={f.label} style={{ padding: '6px 16px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--sand-dark)', fontSize: 12 }}>
          <span style={{ color: 'var(--light)' }}>{f.label}</span>
          <span style={{ fontWeight: 500, color: 'var(--green)' }}>{f.value}</span>
        </div>
      ))}
      <div style={{ padding: '12px 16px', display: 'flex', gap: 8 }}>
        <button style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'var(--green)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Apply to profile</button>
        <button style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--sand)', color: 'var(--mid)', border: 'none', fontSize: 13, cursor: 'pointer' }}>Edit</button>
      </div>
    </div>
  )
}

function PhoneMockup() {
  return (
    <div style={{ background: '#111', borderRadius: 28, padding: 14, width: 200, boxShadow: '0 24px 60px rgba(8,80,65,0.2)' }}>
      <div style={{ background: 'var(--white)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ background: '#111', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 80, height: 18, background: '#222', borderRadius: '0 0 12px 12px' }} />
        </div>
        <div style={{ background: 'linear-gradient(135deg,#085041,#1D9E75)', padding: 16, color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🐕</div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: '#fff' }}>Luna</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)' }}>Golden Retriever · F · 4yr</div>
            </div>
          </div>
          <div style={{ background: '#fff', borderRadius: 8, padding: 10, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="80" height="80" viewBox="0 0 60 60">
              <rect x="0" y="0" width="18" height="18" fill="none" stroke="#085041" strokeWidth="2"/>
              <rect x="3" y="3" width="12" height="12" fill="#085041"/>
              <rect x="42" y="0" width="18" height="18" fill="none" stroke="#085041" strokeWidth="2"/>
              <rect x="45" y="3" width="12" height="12" fill="#085041"/>
              <rect x="0" y="42" width="18" height="18" fill="none" stroke="#085041" strokeWidth="2"/>
              <rect x="3" y="45" width="12" height="12" fill="#085041"/>
              <rect x="22" y="2" width="4" height="3" fill="#085041"/><rect x="27" y="2" width="6" height="3" fill="#085041"/>
              <rect x="35" y="2" width="5" height="3" fill="#085041"/><rect x="22" y="7" width="5" height="3" fill="#085041"/>
              <rect x="2" y="22" width="5" height="4" fill="#085041"/><rect x="9" y="22" width="3" height="7" fill="#085041"/>
              <rect x="22" y="22" width="5" height="4" fill="#085041"/><rect x="29" y="22" width="6" height="3" fill="#085041"/>
              <rect x="22" y="42" width="3" height="14" fill="#085041"/><rect x="27" y="42" width="7" height="3" fill="#085041"/>
              <rect x="42" y="42" width="3" height="6" fill="#085041"/><rect x="47" y="42" width="10" height="3" fill="#085041"/>
            </svg>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: 'rgba(159,225,203,.25)', color: '#9FE1CB', fontWeight: 500 }}>Vaccines ✓</span>
            <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: 'rgba(250,199,117,.25)', color: '#FAC775', fontWeight: 500 }}>Chicken ⚠</span>
          </div>
          <p style={{ fontSize: 9, color: 'rgba(255,255,255,.5)', textAlign: 'center', marginTop: 6 }}>Scan with any phone camera</p>
        </div>
        <div style={{ padding: '10px 12px', background: '#fff' }}>
          {[
            { name: 'C8 Distemper', date: 'Mar 2026', status: 'Current' },
            { name: 'Kennel cough', date: 'Mar 2026', status: 'Current' },
          ].map(v => (
            <div key={v.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f0ede8', fontSize: 11 }}>
              <span style={{ color: '#1A1917', fontWeight: 500 }}>{v.name}</span>
              <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 20, background: 'var(--green-light)', color: 'var(--green)' }}>{v.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PricingCard({ plan, desc, price, features, featured, isFree, onStart }: {
  plan: string; desc: string; price: number;
  features: string[]; featured?: boolean; isFree?: boolean; onStart: () => void
}) {
  return (
    <div style={{
      background: 'var(--white)',
      border: featured ? '2px solid var(--green)' : '1.5px solid var(--border)',
      borderRadius: 24, padding: 32,
      position: 'relative',
      boxShadow: featured ? '0 8px 32px rgba(8,80,65,0.12)' : 'none',
    }}>
      {featured && (
        <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', background: 'var(--green)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '4px 14px', borderRadius: 20, whiteSpace: 'nowrap', letterSpacing: '.04em' }}>Most popular</div>
      )}
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--dark)', marginBottom: 4 }}>{plan}</div>
      <div style={{ fontSize: 13, color: 'var(--light)', marginBottom: 16 }}>{desc}</div>
      {isFree ? (
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, color: 'var(--mid)' }}>Free</span>
          <div style={{ fontSize: 12, color: 'var(--green)', background: 'var(--green-light)', padding: '3px 10px', borderRadius: 20, display: 'inline-block', marginTop: 6, fontWeight: 500, marginLeft: 8 }}>forever</div>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, color: featured ? 'var(--green)' : 'var(--dark)' }}>${price}</span>
            <span style={{ fontSize: 13, color: 'var(--light)' }}>AUD/month</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--gold)', background: 'var(--gold-light)', padding: '3px 10px', borderRadius: 20, display: 'inline-block', fontWeight: 500 }}>🎉 30 days free — no card</div>
        </div>
      )}
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, margin: '0 0 24px' }}>
        {features.map(f => (
          <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, color: 'var(--mid)', lineHeight: 1.4 }}>
            <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--green-light)', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✓</span>
            {f}
          </li>
        ))}
      </ul>
      <button onClick={onStart} style={{
        display: 'block', width: '100%', textAlign: 'center',
        fontSize: 14, fontWeight: 600, padding: '13px',
        borderRadius: 10,
        background: isFree ? 'var(--white)' : featured ? 'var(--green)' : 'transparent',
        color: isFree ? 'var(--mid)' : featured ? '#fff' : 'var(--green)',
        border: isFree ? '1.5px solid var(--border)' : featured ? 'none' : '1.5px solid var(--green)',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}>{isFree ? 'Get started free →' : 'Start free trial →'}</button>
    </div>
  )
}
