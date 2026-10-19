import { Link } from 'react-router-dom'
import { PolicyReviewNotice, POLICY_REVIEW_VERSION, DeletionPolicyDraft, BillingPolicyDraft, RetentionPolicyDraft, InternationalProcessingDraft, AIScanningDisclosure } from '../components/legal/PolicyReview'

export default function PrivacyPage() {
  const lastUpdated = POLICY_REVIEW_VERSION
  return (
    <div style={{ minHeight: '100vh', background: 'var(--sand)', fontFamily: 'var(--font-body)' }}>
      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src="/01_idogs_primary_horizontal_transparent.png" alt="iDogs" style={{ height: 34 }} />
        </Link>
        <Link to="/signup" className="btn btn-primary btn-sm">Start free</Link>
      </nav>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, color: 'var(--dark)', marginBottom: 8, letterSpacing: '-0.02em' }}>Privacy Policy</h1>
          <p style={{ fontSize: 14, color: 'var(--light)' }}>Review version: {lastUpdated} · iziPaws Pty Ltd ABN 42 693 563 745</p>
          <PolicyReviewNotice />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <LegalSection title="1. Who We Are">
            <p>iziPaws Pty Ltd (ABN 42 693 563 745), trading as iDogs, is the operator of idogs.com.au ("the Service"). We are based in Adelaide, South Australia.</p>
            <p>Contact: hello@idogs.com.au</p>
          </LegalSection>

          <LegalSection title="2. Information We Collect">
            <p><strong>Account information:</strong> Name, email address, kennel name, state, phone number when you register.</p>
            <p><strong>Dog records:</strong> Dog profiles, vaccination records, health test results, pedigree information, microchip numbers, photographs, and documents you upload.</p>
            <p><strong>Payment information:</strong> Subscription plan and billing history. Payment card details are processed and stored by Stripe — we never see or store your full card number.</p>
            <p><strong>Usage data:</strong> Log files, IP addresses, browser type, pages visited, and actions taken within the Service (for security and improvement purposes).</p>
            <p><strong>Public passport logs:</strong> Requests can produce service and security logs. Scanning a passport does not itself create an account for a visitor. Logged fields and retention must be verified before publication.</p>
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
            <p>This draft does not authorise sale of personal information or advertising use. Actual business practices and any third-party tracking must be verified before the policy becomes effective.</p>
          </LegalSection>

          <LegalSection title="4. Data Storage and Security">
            <InternationalProcessingDraft />
            <p><strong>Security:</strong> iDogs uses HTTPS and Firebase Authentication with access controls. Security, storage configuration and operational procedures must be assessed together; no system can guarantee absolute security.</p>
            <p><strong>File storage:</strong> Documents and photos uploaded via the Service are stored in Firebase Storage with the same security standards.</p>
          </LegalSection>

          <LegalSection title="5. Sharing Your Information">
            <p>We share your information only in these limited circumstances:</p>
            <ul>
              <li><strong>Ownership transfer:</strong> A transfer can share the dog records needed by its new owner. Former-owner access is limited to the available historical record; later current-owner updates are private</li>
              <li><strong>Service providers:</strong> Stripe (payments), Resend (email notifications), Firebase/Google (infrastructure); Vercel (hosting), Amazon Web Services/SNS (SMS where enabled) and Anthropic (optional AI scanning). Provider arrangements require verification before this draft becomes effective</li>
              <li><strong>Legal requirements:</strong> If required by Australian law, court order, or government authority</li>
              <li><strong>Public passport:</strong> Information displayed on a dog's public QR passport page is visible to anyone with the link</li>
            </ul>
          </LegalSection>

          <LegalSection title="Optional AI Document Scanning">
            <AIScanningDisclosure />
          </LegalSection>

          <LegalSection title="6. Requests and Privacy Choices">
            <p>You can ask us to access or correct personal information, request account deletion, and raise privacy concerns. Applicable legal rights depend on the circumstances; this draft does not certify the scope of the Privacy Act for our business.</p>
            <ul>
              <li><strong>Access</strong> your personal information held by us</li>
              <li><strong>Correct</strong> inaccurate or incomplete information</li>
              <li><strong>Request account deletion</strong> in Settings, subject to the scope and status explained below</li>
              <li><strong>Export</strong> records using the available export tools</li>
              <li><strong>Opt out</strong> of marketing communications</li>
              <li><strong>Complain</strong> to the Office of the Australian Information Commissioner (OAIC) if you believe we've breached your privacy</li>
            </ul>
            <p>Use Settings to initiate account deletion; no separate email or support chat is required to submit that request. For access, correction or privacy complaints, contact hello@idogs.com.au.</p>
            <DeletionPolicyDraft />
            <BillingPolicyDraft />
          </LegalSection>

          <LegalSection title="7. Data Retention">
            <RetentionPolicyDraft />
          </LegalSection>

          <LegalSection title="8. Cookies">
            <p>Firebase Authentication uses browser or device storage to maintain your sign-in session. The full cookie, analytics and SDK inventory must be verified before this draft becomes effective.</p>
            <p>Restricting storage required for authentication may prevent sign-in or session persistence.</p>
          </LegalSection>

          <LegalSection title="9. Children's Privacy">
            <p>iDogs is not directed at children under 18. We do not knowingly collect personal information from anyone under 18. If you believe a child has provided us with personal information, contact us immediately.</p>
          </LegalSection>

          <LegalSection title="10. Changes to This Policy">
            <p>We may update this Privacy Policy from time to time. We will notify you of material changes via email or in-app notice at least 14 days before they take effect.</p>
          </LegalSection>

          <LegalSection title="11. Contact and Complaints">
            <p>For privacy questions or complaints:</p>
            <p><strong>iziPaws Pty Ltd</strong><br />ABN: 42 693 563 745<br />Adelaide, South Australia<br />Email: hello@idogs.com.au</p>
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
