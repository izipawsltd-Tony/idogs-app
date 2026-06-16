import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Landing page uses the static HTML design from idogs_landing.html
// Converted to React with proper navigation hooks

export default function LandingPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  // Redirect logged-in users to dashboard
  useEffect(() => {
    if (!loading && user) navigate('/app/dashboard')
  }, [user, loading])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sand)', fontFamily: 'var(--font-body)' }}>

      {/* ── NAV ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, background: 'var(--green)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🐾</div>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, color: 'var(--dark)' }}>iDogs</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 20, background: 'var(--gold-light)', color: 'var(--gold)', border: '1px solid rgba(200,151,31,0.25)' }}>🇦🇺 Built for Australia</span>
          <button onClick={() => navigate('/login')} style={{ fontSize: 13, color: 'var(--mid)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 6 }}>Sign in</button>
          <button onClick={() => navigate('/signup')} className="btn btn-primary" style={{ fontSize: 13, padding: '8px 16px', height: 36 }}>Start free</button>
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

        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 'clamp(38px,6vw,64px)', fontWeight: 600,
          lineHeight: 1.1, letterSpacing: '-0.03em', color: 'var(--dark)',
          maxWidth: 780, margin: '0 auto 20px',
        }}>
          Every dog's story,<br />
          <span style={{ color: 'var(--green)' }}>forever</span>
        </h1>

        <p style={{ fontSize: 'clamp(15px,2vw,18px)', color: 'var(--mid)', maxWidth: 520, margin: '0 auto 40px', lineHeight: 1.65 }}>
          From the day they're born to the day they're remembered — one QR passport that follows your dog through every owner, every vet, every chapter of their life.
        </p>

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
                  transition: 'border-color .3s, transform .3s',
                }}>{stage.emoji}</div>
                <span style={{ fontSize: 10, color: stage.highlight ? 'var(--green)' : 'var(--light)', fontWeight: 500, letterSpacing: '.04em', textTransform: 'uppercase' }}>{stage.label}</span>
              </div>
              {i < arr.length - 1 && (
                <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg,var(--green-light),var(--green-mid),var(--green-light))', marginBottom: 16 }} />
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <button onClick={() => navigate('/signup')} className="btn btn-primary btn-lg">Start free — 30 days</button>
          <button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} className="btn btn-secondary btn-lg">See how it works →</button>
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
            { num: '2,400+', label: 'dog profiles created' },
            { num: '98%', label: 'continue after trial' },
            { num: '4.5 hrs', label: 'saved per litter avg' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, color: 'var(--dark)' }}>{s.num}</div>
              <div style={{ fontSize: 12, color: 'var(--light)' }}>{s.label}</div>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--light)' }}>Trusted by members of</span>
            {['GR Club NSW', 'Lab Club VIC', 'Dogs Australia'].map(c => (
              <span key={c} className="badge badge-green" style={{ fontSize: 11 }}>{c}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── PAIN ── */}
      <section style={{ background: 'var(--white)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12, textAlign: 'center' }}>How it works</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px,4vw,36px)', fontWeight: 600, color: 'var(--dark)', marginBottom: 12, lineHeight: 1.2, letterSpacing: '-0.02em', textAlign: 'center' }}>
            Everything in one place — always ready
          </h2>
          <p style={{ fontSize: 16, color: 'var(--mid)', maxWidth: 500, margin: '0 auto 56px', textAlign: 'center', lineHeight: 1.6 }}>
            From vaccination cards to pedigree certificates — iDogs captures, stores, and shares everything automatically.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24 }}>
            {[
              {
                step: '01',
                icon: '📸',
                title: 'Scan your documents',
                desc: 'Photograph vaccine cards, pedigree certs, or health test results. Our AI extracts all fields automatically — dates, vaccines, vet clinic names.',
              },
              {
                step: '02',
                icon: '🐾',
                title: "Build your dog's digital passport",
                desc: 'Every record in one place, accessible anywhere. Each dog gets a unique QR code for instant sharing with vets, buyers, and boarding kennels.',
              },
              {
                step: '03',
                icon: '🔔',
                title: 'Never miss a due date',
                desc: 'Automatic email reminders before vaccines and worming treatments expire — for every dog in your kennel, across every breed.',
              },
              {
                step: '04',
                icon: '📄',
                title: 'Export when you need it',
                desc: 'One-click PDF or CSV report for Dogs Australia / ANKC inspections, ownership transfers, or personal records. Covers all Australian state requirements.',
              },
            ].map((item, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', letterSpacing: '0.08em', marginBottom: 12 }}>STEP {item.step}</div>
                <div style={{ fontSize: 36, marginBottom: 14 }}>{item.icon}</div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)', marginBottom: 10, lineHeight: 1.3 }}>{item.title}</h3>
                <p style={{ fontSize: 14, color: 'var(--mid)', lineHeight: 1.7 }}>{item.desc}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div style={{ textAlign: 'center', marginTop: 56 }}>
            <button
              onClick={() => navigate('/signup')}
              className="btn btn-primary"
              style={{ fontSize: 16, padding: '16px 40px', borderRadius: 12, height: 'auto' }}
            >
              Start free — no credit card required →
            </button>
            <p style={{ fontSize: 13, color: 'var(--light)', marginTop: 12 }}>Free forever for 1-2 dogs · Paid plans from $5/month</p>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" style={{ background: 'var(--white)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          {/* Feature 1: AI Scan */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center', marginBottom: 80 }}>
            <div style={{ background: 'var(--sand)', borderRadius: 24, padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 360 }}>
              <AIScanMockup />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12 }}>AI document scan</div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px,3vw,32px)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--dark)', marginBottom: 12, lineHeight: 1.25 }}>Photograph a vet card.<br />Done.</h3>
              <p style={{ fontSize: 15, color: 'var(--mid)', lineHeight: 1.7, marginBottom: 24 }}>Point your phone at any vet card, pedigree certificate, or OFA document. iDogs reads it and fills in the profile automatically.</p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {['Vaccination cards, worming records, vet notes', 'OFA/PennHIP certificates, eye tests, DNA results', 'ANKC pedigree certificates', 'Uncertain dates highlighted for your review'].map(item => (
                  <li key={item} style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--mid)', alignItems: 'flex-start' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--green-light)', border: '2px solid var(--green-mid)', flexShrink: 0, marginTop: 1 }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Feature 2: QR Passport */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12 }}>QR passport</div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(20px,3vw,32px)', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--dark)', marginBottom: 12, lineHeight: 1.25 }}>Every puppy leaves<br />with a digital passport.</h3>
              <p style={{ fontSize: 15, color: 'var(--mid)', lineHeight: 1.7, marginBottom: 24 }}>When your puppy goes to their new home, you hand over their entire story — in a QR code that lives in their owner's phone wallet.</p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {['Vet scans QR before consult — no re-taking history', 'Kennel check-in auto-filled — no paper forms', 'Emergency info visible without login', 'Record lives forever — even after the dog passes'].map(item => (
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

      {/* ── HOW IT WORKS ── */}
      <section style={{ background: 'var(--sand)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12 }}>How it works</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px,4vw,40px)', fontWeight: 600, color: 'var(--dark)', marginBottom: 48, lineHeight: 1.2, letterSpacing: '-0.02em' }}>Up and running in 15 minutes</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 2, background: 'var(--border)', borderRadius: 16, overflow: 'hidden' }}>
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

      {/* ── PRICING ── */}
      <section id="pricing" style={{ background: 'var(--white)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12 }}>Pricing</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px,4vw,40px)', fontWeight: 600, color: 'var(--dark)', marginBottom: 12, letterSpacing: '-0.02em' }}>Simple, transparent pricing</h2>
          <p style={{ fontSize: 16, color: 'var(--mid)', maxWidth: 500, margin: '0 auto 48px' }}>30-day free trial on all plans. No credit card required. Cancel anytime.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, maxWidth: 1000, margin: '0 auto 24px' }}>
            <PricingCard plan="Free" price={0} desc="Pet owners with 1-2 dogs" features={['Up to 2 dogs — forever free','QR Passport for each dog','Vaccination & health records','Email reminders','Public passport page']} onStart={() => navigate('/signup')} isFree />
            <PricingCard plan="Basic" price={5} desc="Casual breeders & growing families" features={['Up to 10 dogs','Everything in Free','AI Document Scan','Document storage','Export PDF & CSV','Ownership transfer']} onStart={() => navigate('/signup')} />
            <PricingCard plan="Pro" price={12} desc="Active breeders & growing kennels" featured features={['Up to 20 dogs','Everything in Basic','Litter management','Audit trail','SMS reminders +$3/mo','Priority support']} onStart={() => navigate('/signup')} />
            <PricingCard plan="Kennel" price={29} desc="Professional kennels" features={['Unlimited dogs','Everything in Pro','Full compliance export','Multi-litter management','Advanced audit trail','Priority support']} onStart={() => navigate('/signup')} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--light)', marginBottom: 8 }}>All prices in AUD · Paid plans include 30-day free trial · Cancel anytime</p>
          <p style={{ fontSize: 12, color: 'var(--mid)' }}>🐾 <strong>1-2 dogs?</strong> iDogs is free forever — no credit card, no expiry. · 📱 SMS reminders available as $3/month add-on.</p>
        </div>
      </section>

      {/* ── BREEDER SURVEY CTA ── */}
      <section style={{ background: 'var(--sand)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 12 }}>For breeders</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px,4vw,36px)', fontWeight: 600, color: 'var(--dark)', marginBottom: 16, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
            Every dog deserves a story — help us tell it better
          </h2>
          <p style={{ fontSize: 16, color: 'var(--mid)', marginBottom: 32, lineHeight: 1.6 }}>
            We are talking to Australian breeders to understand what really matters. Share your experience in 3 minutes and receive a <strong>3-month free promo code</strong> as our thank you.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            <button onClick={() => navigate('/survey')} className="btn btn-primary"
              style={{ fontSize: 16, padding: '16px 40px', borderRadius: 12, height: 'auto' }}>
              Take the 3-minute survey — get 3 months free 🎁
            </button>
            <div style={{ display: 'flex', gap: 24, fontSize: 13, color: 'var(--light)' }}>
              <span>✓ 10 quick questions</span>
              <span>✓ No spam</span>
              <span>✓ No credit card</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section style={{ background: 'var(--white)', padding: '80px 24px' }}>
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
            Get started free →
          </button>
          <div style={{ marginTop: 20, fontSize: 12, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span>🇦🇺 Data in Australia</span><span>🔒 Privacy Act compliant</span><span>⚡ Cancel anytime</span>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: 'var(--dark)', padding: '48px 24px 32px', color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 40, flexWrap: 'wrap', marginBottom: 40 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 28, height: 28, background: 'var(--green)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🐾</div>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: '#fff' }}>iDogs</span>
              </div>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', maxWidth: 220, lineHeight: 1.6 }}>Every dog's story, forever. Built for Australian breeders and dog owners.</p>
            </div>
            {[
              { title: 'Product', links: ['Features', 'QR Passport', 'AI Document Scan', 'Pricing'] },
              { title: 'Support', links: ['NSW compliance guide', 'Migration from Excel', 'Onboarding support', 'Contact'] },
              { title: 'Legal', links: ['Privacy Policy', 'Terms of Service'] },
            ].map(group => (
              <div key={group.title}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 12 }}>{group.title}</div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {group.links.map(l => <li key={l}><a href={l === 'Privacy Policy' ? '/privacy' : l === 'Terms of Service' ? '/terms' : '#'} style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none', fontSize: 13 }}>{l}</a></li>)}
                </ul>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <span>© 2026 iDogs · iziPaws Pty Ltd ABN 42 693 563 745 · Adelaide, SA</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {['🇦🇺 AWS Sydney', '🔒 Privacy Act 1988'].map(b => (
                <span key={b} style={{ fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 5 }}>{b}</span>
              ))}
            </div>
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
        { done: false, label: 'Filling profile', sub: 'Matching to Luna\'s record', active: true },
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
              <rect x="0" y="0" width="18" height="18" fill="none" stroke="#085041" stroke-width="2"/>
              <rect x="3" y="3" width="12" height="12" fill="#085041"/>
              <rect x="42" y="0" width="18" height="18" fill="none" stroke="#085041" stroke-width="2"/>
              <rect x="45" y="3" width="12" height="12" fill="#085041"/>
              <rect x="0" y="42" width="18" height="18" fill="none" stroke="#085041" stroke-width="2"/>
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
