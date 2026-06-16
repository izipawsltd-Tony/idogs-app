import { Link } from 'react-router-dom'

export default function PrivacyPage() {
  const lastUpdated = '15 June 2026'
  return (
    <div style={{ minHeight: '100vh', background: 'var(--sand)', fontFamily: 'var(--font-body)' }}>
      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <div style={{ width: 28, height: 28, background: 'var(--green)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🐾</div>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--dark)' }}>iDogs</span>
        </Link>
        <Link to="/signup" className="btn btn-primary btn-sm">Start free</Link>
      </nav>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, color: 'var(--dark)', marginBottom: 8, letterSpacing: '-0.02em' }}>Privacy Policy</h1>
          <p style={{ fontSize: 14, color: 'var(--light)' }}>Last updated: {lastUpdated} · iziPaws Pty Ltd ABN 42 693 563 745</p>
          <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--green-light)', borderRadius: 10, fontSize: 13, color: '#0F6E56' }}>
            🇦🇺 iDogs is compliant with the <strong>Australian Privacy Act 1988 (Cth)</strong> and the 13 Australian Privacy Principles (APPs).
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <LegalSection title="1. Who We Are">
            <p>iziPaws Pty Ltd (ABN 42 693 563 745), trading as iDogs, is the operator of idogs.com.au ("the Service"). We are based in Adelaide, South Australia.</p>
            <p>Contact: info@izipaws.com.au</p>
          </LegalSection>

          <LegalSection title="2. Information We Collect">
            <p><strong>Account information:</strong> Name, email address, kennel name, state, phone number when you register.</p>
            <p><strong>Dog records:</strong> Dog profiles, vaccination records, health test results, pedigree information, microchip numbers, photographs, and documents you upload.</p>
            <p><strong>Payment information:</strong> Subscription plan and billing history. Payment card details are processed and stored by Stripe — we never see or store your full card number.</p>
            <p><strong>Usage data:</strong> Log files, IP addresses, browser type, pages visited, and actions taken within the Service (for security and improvement purposes).</p>
            <p><strong>QR scan logs:</strong> When a dog's QR passport is scanned, we log the timestamp and result (not the scanner's identity).</p>
          </LegalSection>

          <LegalSection title="3. How We Use Your Information">
            <p>We use your information to:</p>
            <ul>
              <li>Provide and improve the iDogs Service</li>
              <li>Send vaccine and health reminders you've opted into</li>
              <li>Process subscription payments via Stripe</li>
              <li>Generate compliance export reports</li>
              <li>Respond to support requests</li>
              <li>Comply with legal obligations</li>
            </ul>
            <p>We do <strong>not</strong> sell your personal information to third parties. We do not use your data for advertising purposes.</p>
          </LegalSection>

          <LegalSection title="4. Data Storage and Security">
            <p><strong>Location:</strong> All data is stored securely in Asia-Pacific in compliance with the Australian Privacy Act 1988. Full Australian data sovereignty is available via iziPaws — our professional breeder platform hosted on AWS Sydney.</p>
            <p><strong>Security measures:</strong> Data is encrypted in transit (TLS/HTTPS) and at rest. Access is protected by Firebase Authentication. We conduct regular security reviews.</p>
            <p><strong>File storage:</strong> Documents and photos uploaded via the Service are stored in Firebase Storage with the same security standards.</p>
          </LegalSection>

          <LegalSection title="5. Sharing Your Information">
            <p>We share your information only in these limited circumstances:</p>
            <ul>
              <li><strong>Ownership transfer:</strong> When you transfer a dog to a new owner, their contact details and the dog's records are shared with that owner as you direct</li>
              <li><strong>Service providers:</strong> Stripe (payments), Resend (email notifications), Firebase/Google (infrastructure) — all under strict data processing agreements</li>
              <li><strong>Legal requirements:</strong> If required by Australian law, court order, or government authority</li>
              <li><strong>Public passport:</strong> Information displayed on a dog's public QR passport page is visible to anyone with the link</li>
            </ul>
          </LegalSection>

          <LegalSection title="6. Your Rights (Australian Privacy Principles)">
            <p>Under the Australian Privacy Act, you have the right to:</p>
            <ul>
              <li><strong>Access</strong> your personal information held by us</li>
              <li><strong>Correct</strong> inaccurate or incomplete information</li>
              <li><strong>Delete</strong> your account and associated data</li>
              <li><strong>Export</strong> your data at any time via PDF or CSV</li>
              <li><strong>Opt out</strong> of marketing communications</li>
              <li><strong>Complain</strong> to the Office of the Australian Information Commissioner (OAIC) if you believe we've breached your privacy</li>
            </ul>
            <p>To exercise these rights, contact us at info@izipaws.com.au.</p>
          </LegalSection>

          <LegalSection title="7. Data Retention">
            <p>We retain your data for as long as your account is active. After account cancellation:</p>
            <ul>
              <li>Your data is kept for 30 days, during which you can export it</li>
              <li>After 30 days, data is permanently deleted from our systems</li>
              <li>Stripe may retain payment records as required by Australian financial regulations</li>
            </ul>
          </LegalSection>

          <LegalSection title="8. Cookies">
            <p>iDogs uses essential cookies for authentication (Firebase Auth session cookies). We do not use advertising or tracking cookies.</p>
            <p>You can disable cookies in your browser, but this will prevent you from logging in to the Service.</p>
          </LegalSection>

          <LegalSection title="9. Children's Privacy">
            <p>iDogs is not directed at children under 18. We do not knowingly collect personal information from anyone under 18. If you believe a child has provided us with personal information, contact us immediately.</p>
          </LegalSection>

          <LegalSection title="10. Changes to This Policy">
            <p>We may update this Privacy Policy from time to time. We will notify you of material changes via email or in-app notice at least 14 days before they take effect.</p>
          </LegalSection>

          <LegalSection title="11. Contact and Complaints">
            <p>For privacy questions or complaints:</p>
            <p><strong>iziPaws Pty Ltd</strong><br />ABN: 42 693 563 745<br />Adelaide, South Australia<br />Email: info@izipaws.com.au</p>
            <p>If you are not satisfied with our response, you may lodge a complaint with the <strong>Office of the Australian Information Commissioner (OAIC)</strong> at oaic.gov.au or call 1300 363 992.</p>
          </LegalSection>
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: 'var(--dark)', padding: '24px', textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
        © 2026 iDogs · iziPaws Pty Ltd ABN 42 693 563 745 ·{' '}
        <Link to="/terms" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>Terms of Service</Link>
      </div>
    </div>
  )
}

function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--white)', borderRadius: 12, padding: '28px 32px', border: '1px solid var(--border)' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)', marginBottom: 16 }}>{title}</h2>
      <div style={{ fontSize: 14, color: 'var(--mid)', lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  )
}
