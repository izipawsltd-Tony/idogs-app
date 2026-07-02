import { useState } from 'react'
import { Link } from 'react-router-dom'

export default function SurveyPage() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState<false | 'success' | 'duplicate'>(false)
  const [userType, setUserType] = useState<'breeder' | 'owner' | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [form, setForm] = useState({
    name: '', email: '', state: 'NSW', ankc: '',
    dogCount: '', litterCount: '', tools: [] as string[], toolsOther: '',
    headache: '', missingRecords: '', wtp: '', softwareBefore: '', softwareWhich: '',
    // Pet owner fields
    ownerDogCount: '', vaccineTracks: [] as string[], vaccineTrackOther: '',
    askedForRecords: '', ownerWtp: '', ownerWish: '', ownerAnything: '',
    // Shared
    anything: '',
  })

  function set(field: string, value: string) {
    setForm(p => ({ ...p, [field]: value }))
  }

  function toggleTool(tool: string) {
    setForm(p => ({
      ...p,
      tools: p.tools.includes(tool) ? p.tools.filter(t => t !== tool) : [...p.tools, tool]
    }))
  }

  function validateStep(s: number): boolean {
    const errs: string[] = []
    if (userType === 'breeder') {
      if (s === 1) {
        if (!form.dogCount) errs.push('Please select how many dogs you own/breed (Q1)')
        if (!form.litterCount) errs.push('Please select litters per year (Q2)')
      }
      if (s === 2) {
        if (form.tools.length === 0) errs.push('Please select at least one tool you use (Q3)')
      }
      if (s === 3) {
        if (!form.headache.trim()) errs.push('Please describe your biggest admin headache (Q6)')
        if (!form.wtp) errs.push('Please select your willingness to pay (Q8)')
      }
    }
    if (userType === 'owner') {
      if (!form.ownerDogCount) errs.push('Please select how many dogs you own (Q1)')
      if (form.vaccineTracks.length === 0 && !form.vaccineTrackOther.trim()) errs.push('Please select how you track vaccine records (Q2)')
      if (!form.ownerWish.trim()) errs.push('Please answer what would make managing your dog easier (Q5)')
    }
    setErrors(errs)
    return errs.length === 0
  }

  async function handleSubmit() {
    setLoading(true)
    try {
      const res = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, userType, source: 'survey_page' }),
      })
      if (res.status === 409) {
        setSubmitted('duplicate')
        return
      }
      setSubmitted('success')
    } catch {
      setSubmitted('success')
    } finally {
      setLoading(false)
    }
  }

  const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']

  function toggleVaccineTrack(tool: string) {
    setForm(p => ({
      ...p,
      vaccineTracks: p.vaccineTracks.includes(tool) ? p.vaccineTracks.filter(t => t !== tool) : [...p.vaccineTracks, tool]
    }))
  }

  if (submitted === 'duplicate') return (
    <div style={{ minHeight: '100vh', background: 'var(--sand)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <div style={{ background: 'var(--white)', borderRadius: 20, padding: '48px 32px', border: '1px solid var(--border)', boxShadow: '0 4px 20px rgba(8,80,65,0.08)' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>📬</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--dark)', marginBottom: 12 }}>Already submitted!</h1>
          <p style={{ fontSize: 15, color: 'var(--mid)', lineHeight: 1.7, marginBottom: 20 }}>
            This email has already submitted a survey response. Check your inbox for your promo code.
          </p>
          <p style={{ fontSize: 14, color: 'var(--light)' }}>Questions? Contact <a href="mailto:info@izipaws.com.au" style={{ color: 'var(--green)' }}>info@izipaws.com.au</a></p>
          <div style={{ marginTop: 24 }}><Link to="/" style={{ fontSize: 14, color: 'var(--light)', textDecoration: 'none' }}>← Back to iDogs</Link></div>
        </div>
      </div>
    </div>
  )

  if (submitted === 'success') return (
    <div style={{ minHeight: '100vh', background: 'var(--sand)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <div style={{ background: 'var(--white)', borderRadius: 20, padding: '48px 32px', border: '1px solid var(--border)', boxShadow: '0 4px 20px rgba(8,80,65,0.08)' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--dark)', marginBottom: 12 }}>Thank you!</h1>
          <p style={{ fontSize: 15, color: 'var(--mid)', lineHeight: 1.7, marginBottom: 24 }}>
            We have received your feedback. Our team at iDogs will review your responses and send your <strong>3-month free promo code</strong> within 24 hours.
          </p>
          <div style={{ background: 'var(--green-light)', borderRadius: 12, padding: '16px 20px', marginBottom: 24, fontSize: 14, color: 'var(--green)' }}>
            💡 Start now — <a href="/signup" style={{ color: 'var(--green)', fontWeight: 600 }}>create your free account</a> while you wait. No credit card required.
          </div>
          <Link to="/" style={{ fontSize: 14, color: 'var(--light)', textDecoration: 'none' }}>← Back to iDogs</Link>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sand)' }}>
      {/* Nav */}
      <nav style={{ background: 'var(--white)', borderBottom: '1px solid var(--border)', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <div style={{ width: 28, height: 28, background: 'var(--green)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🐾</div>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--dark)' }}>iDogs</span>
        </Link>
        <span style={{ fontSize: 13, color: 'var(--light)' }}>Breeder Feedback Survey</span>
      </nav>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px 80px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-block', background: 'var(--gold-light)', color: 'var(--gold)', fontSize: 13, fontWeight: 600, padding: '6px 16px', borderRadius: 20, marginBottom: 16 }}>
            🎁 Complete this survey → get 3 months free (valued at $36 AUD)
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--dark)', marginBottom: 8, letterSpacing: '-0.02em' }}>
            Every dog deserves a story — help us tell it better
          </h1>
          <p style={{ fontSize: 15, color: 'var(--mid)', lineHeight: 1.6 }}>
            {userType ? (step <= 3 ? `${userType === 'breeder' ? '10' : '5'} quick questions · 3 minutes · No spam` : '') : 'First, tell us about yourself'}
          </p>
        </div>

        {/* User type selector */}
        {!userType && (
          <div style={{ background: 'var(--white)', borderRadius: 20, padding: '36px 32px', border: '1px solid var(--border)', boxShadow: '0 4px 20px rgba(8,80,65,0.06)', textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--dark)', marginBottom: 8 }}>I am a...</h2>
            <p style={{ fontSize: 14, color: 'var(--light)', marginBottom: 28 }}>This helps us ask the right questions</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 400, margin: '0 auto' }}>
              <button onClick={() => setUserType('breeder')} style={{
                padding: '28px 20px', borderRadius: 16, border: '2px solid var(--border)',
                background: 'var(--white)', cursor: 'pointer', transition: 'all 0.15s',
                textAlign: 'center',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--green)'; e.currentTarget.style.background = 'var(--green-light)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--white)' }}
              >
                <div style={{ fontSize: 40, marginBottom: 10 }}>🏆</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--dark)', marginBottom: 4 }}>Breeder</div>
                <div style={{ fontSize: 12, color: 'var(--light)' }}>I breed and sell dogs</div>
              </button>
              <button onClick={() => setUserType('owner')} style={{
                padding: '28px 20px', borderRadius: 16, border: '2px solid var(--border)',
                background: 'var(--white)', cursor: 'pointer', transition: 'all 0.15s',
                textAlign: 'center',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--green)'; e.currentTarget.style.background = 'var(--green-light)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--white)' }}
              >
                <div style={{ fontSize: 40, marginBottom: 10 }}>🐾</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--dark)', marginBottom: 4 }}>Pet Owner</div>
                <div style={{ fontSize: 12, color: 'var(--light)' }}>I own 1-2 dogs as pets</div>
              </button>
            </div>
          </div>
        )}

        {/* Progress — only show after userType selected */}
        {userType && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 32 }}>
            {[1, 2, 3].map(s => (
              <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= step ? 'var(--green)' : 'var(--border)', transition: 'background 0.3s' }} />
            ))}
          </div>
        )}

        {userType === 'breeder' && <div style={{ background: 'var(--white)', borderRadius: 20, padding: '36px 32px', border: '1px solid var(--border)', boxShadow: '0 4px 20px rgba(8,80,65,0.06)' }}>

          {/* Step 1 — About you */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>About you</h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Your name *</label>
                  <input className="form-input" type="text" placeholder="Sarah Mitchell" value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email address *</label>
                  <input className="form-input" type="email" placeholder="you@email.com.au" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">State</label>
                  <select className="form-select" value={form.state} onChange={e => set('state', e.target.value)}>
                    {AU_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Registered with Dogs Australia?</label>
                  <select className="form-select" value={form.ankc} onChange={e => set('ankc', e.target.value)}>
                    <option value="">Select...</option>
                    <option>Yes</option>
                    <option>No</option>
                    <option>Applied / In progress</option>
                  </select>
                </div>
              </div>

              {/* Q1 */}
              <div className="form-group">
                <label className="form-label">Q1. How many dogs do you currently own or breed?</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {['1-2', '3-5', '6-10', '10+'].map(opt => (
                    <button key={opt} type="button" onClick={() => set('dogCount', opt)}
                      style={{ padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                        border: `1.5px solid ${form.dogCount === opt ? 'var(--green)' : 'var(--border)'}`,
                        background: form.dogCount === opt ? 'var(--green-light)' : 'var(--white)',
                        color: form.dogCount === opt ? 'var(--green)' : 'var(--mid)' }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Q8 */}
              <div className="form-group">
                <label className="form-label">Q2. How many litters do you produce per year?</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {['0', '1-2', '3-5', '6-10', '10+'].map(opt => (
                    <button key={opt} type="button" onClick={() => set('litterCount', opt)}
                      style={{ padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                        border: `1.5px solid ${form.litterCount === opt ? 'var(--green)' : 'var(--border)'}`,
                        background: form.litterCount === opt ? 'var(--green-light)' : 'var(--white)',
                        color: form.litterCount === opt ? 'var(--green)' : 'var(--mid)' }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {errors.length > 0 && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px' }}>
                  {errors.map((e, i) => <div key={i} style={{ fontSize: 13, color: 'var(--error)' }}>⚠ {e}</div>)}
                </div>
              )}
              <button className="btn btn-primary" style={{ width: '100%', height: 48, fontSize: 15 }}
                onClick={() => { if (validateStep(1)) { setErrors([]); setStep(2) } }} disabled={!form.name || !form.email}>
                Next →
              </button>
            </div>
          )}

          {/* Step 2 — Current workflow */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>Your current workflow</h2>

              {/* Q2 */}
              <div className="form-group">
                <label className="form-label">Q3. What tools do you use to track health and vaccine records? <span style={{ color: 'var(--light)', fontWeight: 400 }}>(select all that apply)</span></label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {['Spreadsheet', 'Paper records', 'Software', 'Nothing', 'Other'].map(opt => (
                    <button key={opt} type="button" onClick={() => toggleTool(opt)}
                      style={{ padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                        border: `1.5px solid ${form.tools.includes(opt) ? 'var(--green)' : 'var(--border)'}`,
                        background: form.tools.includes(opt) ? 'var(--green-light)' : 'var(--white)',
                        color: form.tools.includes(opt) ? 'var(--green)' : 'var(--mid)' }}>
                      {opt}
                    </button>
                  ))}
                </div>
                {(form.tools.includes('Software') || form.tools.includes('Other')) && (
                  <input className="form-input" style={{ marginTop: 10 }} placeholder="Which software or tool?" value={form.toolsOther} onChange={e => set('toolsOther', e.target.value)} />
                )}
              </div>

              {/* Q9 */}
              <div className="form-group">
                <label className="form-label">Q4. Have you used breeding management software before?</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {['Never', 'Tried but stopped', 'Currently using'].map(opt => (
                    <button key={opt} type="button" onClick={() => set('softwareBefore', opt)}
                      style={{ padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                        border: `1.5px solid ${form.softwareBefore === opt ? 'var(--green)' : 'var(--border)'}`,
                        background: form.softwareBefore === opt ? 'var(--green-light)' : 'var(--white)',
                        color: form.softwareBefore === opt ? 'var(--green)' : 'var(--mid)' }}>
                      {opt}
                    </button>
                  ))}
                </div>
                {(form.softwareBefore === 'Tried but stopped' || form.softwareBefore === 'Currently using') && (
                  <input className="form-input" style={{ marginTop: 10 }} placeholder="Which software? What did you like/dislike?" value={form.softwareWhich} onChange={e => set('softwareWhich', e.target.value)} />
                )}
              </div>

              {/* Q4 */}
              <div className="form-group">
                <label className="form-label">Q5. Have you ever had an issue with missing vaccine or health records?</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {['Yes', 'No'].map(opt => (
                    <button key={opt} type="button" onClick={() => set('missingRecords', opt)}
                      style={{ padding: '8px 24px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                        border: `1.5px solid ${form.missingRecords === opt ? 'var(--green)' : 'var(--border)'}`,
                        background: form.missingRecords === opt ? 'var(--green-light)' : 'var(--white)',
                        color: form.missingRecords === opt ? 'var(--green)' : 'var(--mid)' }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {errors.length > 0 && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px' }}>
                  {errors.map((e, i) => <div key={i} style={{ fontSize: 13, color: 'var(--error)' }}>⚠ {e}</div>)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-secondary" style={{ height: 48, fontSize: 15, flex: 1 }} onClick={() => { setErrors([]); setStep(1) }}>← Back</button>
                <button className="btn btn-primary" style={{ height: 48, fontSize: 15, flex: 2 }} onClick={() => { if (validateStep(2)) { setErrors([]); setStep(3) } }}>Next →</button>
              </div>
            </div>
          )}

          {/* Step 3 — Pain points + WTP */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>Pain points & preferences</h2>

              {/* Q3 */}
              <div className="form-group">
                <label className="form-label">Q6. What is your biggest admin headache as a breeder?</label>
                <textarea className="form-input" rows={3} placeholder="e.g. Keeping track of vaccine due dates across multiple dogs, paperwork before vet visits..."
                  value={form.headache} onChange={e => set('headache', e.target.value)}
                  style={{ resize: 'vertical', lineHeight: 1.6 }} />
              </div>

              {/* Q5 */}
              <div className="form-group">
                <label className="form-label">Q7. What would make you pay for a dog management app?</label>
                <textarea className="form-input" rows={3} placeholder="e.g. If it saved me time on paperwork, if it worked on mobile, if it helped with compliance..."
                  value={form.wtp} onChange={e => set('wtp', e.target.value)}
                  style={{ resize: 'vertical', lineHeight: 1.6 }} />
              </div>

              {/* Q10 */}
              <div className="form-group">
                <label className="form-label">Q8. If a tool saved you 2 hours per week on admin, what would you pay per month?</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {['$0 — free only', '$1–5', '$6–15', '$16–30', '$30+'].map(opt => (
                    <button key={opt} type="button" onClick={() => set('wtp', opt)}
                      style={{ padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                        border: `1.5px solid ${form.wtp === opt ? 'var(--green)' : 'var(--border)'}`,
                        background: form.wtp === opt ? 'var(--green-light)' : 'var(--white)',
                        color: form.wtp === opt ? 'var(--green)' : 'var(--mid)' }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Q10. Anything else you'd like us to know? <span style={{ color: 'var(--light)', fontWeight: 400 }}>(optional)</span></label>
                <textarea className="form-input" rows={3} placeholder="Any other thoughts, pain points, or ideas you'd like to share..."
                  value={form.anything} onChange={e => set('anything', e.target.value)}
                  style={{ resize: 'vertical', lineHeight: 1.6 }} />
              </div>

              {/* Promo reminder */}
              <div style={{ background: 'var(--gold-light)', borderRadius: 12, padding: '14px 18px', fontSize: 13, color: 'var(--gold)', fontWeight: 500 }}>
                🎁 After submitting — Our team at iDogs will review your answers and send your <strong>3-month free promo code</strong> within 24 hours.
              </div>

              {errors.length > 0 && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px' }}>
                  {errors.map((e, i) => <div key={i} style={{ fontSize: 13, color: 'var(--error)' }}>⚠ {e}</div>)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-secondary" style={{ height: 48, fontSize: 15, flex: 1 }} onClick={() => { setErrors([]); setStep(2) }}>← Back</button>
                <button className="btn btn-primary" style={{ height: 48, fontSize: 15, flex: 2 }} onClick={() => { if (validateStep(3)) handleSubmit() }} disabled={loading}>
                  {loading ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Submit & claim 3 months free 🎉'}
                </button>
              </div>
            </div>
          )}
        </div>}

        {/* ── PET OWNER PATH ── */}
        {userType === 'owner' && step === 1 && (
          <div style={{ background: 'var(--white)', borderRadius: 20, padding: '36px 32px', border: '1px solid var(--border)', boxShadow: '0 4px 20px rgba(8,80,65,0.06)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>About you & your dog</h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Your name *</label>
                  <input className="form-input" type="text" placeholder="Sarah Mitchell" value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email address *</label>
                  <input className="form-input" type="email" placeholder="you@email.com.au" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">State</label>
                  <select className="form-select" value={form.state} onChange={e => set('state', e.target.value)}>
                    {AU_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Q1. How many dogs do you own?</label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {['1', '2', '3+'].map(opt => (
                      <button key={opt} type="button" onClick={() => set('ownerDogCount', opt)}
                        style={{ flex: 1, padding: '8px', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                          border: `1.5px solid ${form.ownerDogCount === opt ? 'var(--green)' : 'var(--border)'}`,
                          background: form.ownerDogCount === opt ? 'var(--green-light)' : 'var(--white)',
                          color: form.ownerDogCount === opt ? 'var(--green)' : 'var(--mid)' }}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Q2. How do you currently track your dog's vaccine records?</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {['📄 Paper records', '📱 Phone notes / photos', '💻 App', '🤷 Nothing'].map(opt => (
                    <button key={opt} type="button" onClick={() => toggleVaccineTrack(opt)}
                      style={{ padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        border: `1.5px solid ${form.vaccineTracks.includes(opt) ? 'var(--green)' : 'var(--border)'}`,
                        background: form.vaccineTracks.includes(opt) ? 'var(--green-light)' : 'var(--white)',
                        color: form.vaccineTracks.includes(opt) ? 'var(--green)' : 'var(--mid)' }}>
                      {opt}
                    </button>
                  ))}
                </div>
                <input className="form-input" style={{ marginTop: 10 }} placeholder="Other: please describe..." value={form.vaccineTrackOther} onChange={e => set('vaccineTrackOther', e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label">Q3. Have you ever been asked for vaccine records by a vet or boarding kennel?</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {['Yes', 'No'].map(opt => (
                    <button key={opt} type="button" onClick={() => set('askedForRecords', opt)}
                      style={{ padding: '8px 24px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        border: `1.5px solid ${form.askedForRecords === opt ? 'var(--green)' : 'var(--border)'}`,
                        background: form.askedForRecords === opt ? 'var(--green-light)' : 'var(--white)',
                        color: form.askedForRecords === opt ? 'var(--green)' : 'var(--mid)' }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Q4. Would you pay for an app that keeps all your dog's records in one place?</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {['Yes — $1-5/month', 'Yes — $6-15/month', 'Free only', 'No'].map(opt => (
                    <button key={opt} type="button" onClick={() => set('ownerWtp', opt)}
                      style={{ padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        border: `1.5px solid ${form.ownerWtp === opt ? 'var(--green)' : 'var(--border)'}`,
                        background: form.ownerWtp === opt ? 'var(--green-light)' : 'var(--white)',
                        color: form.ownerWtp === opt ? 'var(--green)' : 'var(--mid)' }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Q5. What would make managing your dog's health easier?</label>
                <textarea className="form-input" rows={3} placeholder="e.g. Reminders for vaccine due dates, easy access at the vet, sharing records with boarding..."
                  value={form.ownerWish} onChange={e => set('ownerWish', e.target.value)}
                  style={{ resize: 'vertical', lineHeight: 1.6 }} />
              </div>

              <div className="form-group">
                <label className="form-label">Anything else you'd like us to know? <span style={{ color: 'var(--light)', fontWeight: 400 }}>(optional)</span></label>
                <textarea className="form-input" rows={2} placeholder="Any other thoughts, ideas, or things we should know..."
                  value={form.ownerAnything} onChange={e => set('ownerAnything', e.target.value)}
                  style={{ resize: 'vertical', lineHeight: 1.6 }} />
              </div>

              <div style={{ background: 'var(--gold-light)', borderRadius: 12, padding: '14px 18px', fontSize: 13, color: 'var(--gold)', fontWeight: 500 }}>
                🎁 After submitting — Our team at iDogs will review your answers and send your <strong>3-month free promo code</strong> within 24 hours.
              </div>

              {errors.length > 0 && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px' }}>
                  {errors.map((e, i) => <div key={i} style={{ fontSize: 13, color: 'var(--error)' }}>⚠ {e}</div>)}
                </div>
              )}
              <button className="btn btn-primary" style={{ width: '100%', height: 48, fontSize: 15 }}
                onClick={() => { if (validateStep(1)) handleSubmit() }} disabled={loading || !form.name || !form.email}>
                {loading ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Submit & claim 3 months free 🎉'}
              </button>
            </div>
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--light)' }}>
          Your responses are confidential and used only to improve iDogs. <Link to="/privacy" style={{ color: 'var(--light)' }}>Privacy Policy</Link>
        </p>
      </div>
    </div>
  )
}
