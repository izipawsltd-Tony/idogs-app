import { Link } from 'react-router-dom'

export default function TermsPage() {
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
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, color: 'var(--dark)', marginBottom: 8, letterSpacing: '-0.02em' }}>Terms of Service</h1>
          <p style={{ fontSize: 14, color: 'var(--light)' }}>Last updated: {lastUpdated} · iziPaws Pty Ltd ABN 42 693 563 745</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <LegalSection title="1. Acceptance of Terms">
            <p>By accessing or using iDogs ("the Service"), operated by iziPaws Pty Ltd ABN 42 693 563 745 ("we", "us", "our"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
            <p>These Terms apply to all users including breeders, pet owners, and visitors.</p>
          </LegalSection>

          <LegalSection title="2. Description of Service">
            <p>iDogs is a SaaS platform that enables Australian dog breeders and pet owners to manage dog health records, vaccination history, pedigree documentation, and compliance reporting. Key features include:</p>
            <ul>
              <li>Digital dog health profiles and QR passports</li>
              <li>AI-powered document scanning</li>
              <li>Vaccination and worming reminders</li>
              <li>Ownership transfer management</li>
              <li>Compliance export reports for Dogs Australia and Australian state regulations</li>
            </ul>
          </LegalSection>

          <LegalSection title="3. Accounts and Registration">
            <p>You must provide accurate, current, and complete information when creating an account. You are responsible for maintaining the confidentiality of your login credentials and for all activities under your account.</p>
            <p>You must be at least 18 years of age to create an account. By registering, you represent that you are 18 or older.</p>
            <p>We reserve the right to suspend or terminate accounts that violate these Terms.</p>
          </LegalSection>

          <LegalSection title="4. Subscription Plans and Billing">
            <p>iDogs offers the following subscription plans (AUD, per month):</p>
            <ul>
              <li><strong>Free:</strong> Up to 2 dogs, QR passport, health records, email reminders — free forever</li>
              <li><strong>Basic — $5/month:</strong> Up to 10 dogs, AI Document Scan, documents, ownership transfer, export</li>
              <li><strong>Pro — $12/month:</strong> Up to 20 dogs, litter management, audit trail, SMS reminders add-on</li>
              <li><strong>Kennel — $29/month:</strong> Unlimited dogs, full compliance export, priority support</li>
              <li><strong>SMS Add-on — $3/month:</strong> SMS reminders on any paid plan</li>
            </ul>
            <p>All plans include a 30-day free trial. No credit card is required to start a trial. After the trial period, a payment method is required to continue using paid features.</p>
            <p>Payments are processed by Stripe. We do not store your payment card details. Subscriptions are billed monthly and renew automatically unless cancelled.</p>
            <p>You may cancel at any time. Cancellation takes effect at the end of the current billing period. No refunds are provided for partial months.</p>
          </LegalSection>

          <LegalSection title="5. Acceptable Use">
            <p>You agree not to use the Service to:</p>
            <ul>
              <li>Upload false, misleading, or fraudulent dog health records</li>
              <li>Violate any applicable Australian state or federal laws</li>
              <li>Attempt to gain unauthorised access to other users' accounts or data</li>
              <li>Transmit malware, viruses, or other harmful code</li>
              <li>Scrape, copy, or redistribute content from the Service without permission</li>
              <li>Use the Service for any purpose that violates animal welfare legislation</li>
            </ul>
          </LegalSection>

          <LegalSection title="6. Data and Privacy">
            <p>Your use of the Service is also governed by our <Link to="/privacy" style={{ color: 'var(--green)' }}>Privacy Policy</Link>, which is incorporated into these Terms by reference.</p>
            <p>All data is stored securely in Asia-Pacific in compliance with the Australian Privacy Act 1988 (Cth).</p>
            <p>You retain ownership of all data you upload to the Service. By uploading data, you grant us a limited licence to store, process, and display it solely for the purpose of providing the Service to you.</p>
          </LegalSection>

          <LegalSection title="7. Intellectual Property">
            <p>The iDogs platform software and design is owned by iziPaws Pty Ltd. The iDogs trademark is owned by NN Global Pty Ltd as trustee for NN Investment Trust. All rights are protected by Australian copyright and trademark law.</p>
            <p>You retain ownership of all data you upload. You may not copy, modify, distribute, or create derivative works of our platform without prior written consent.</p>
          </LegalSection>

          <LegalSection title="8. Disclaimers and Limitation of Liability">
            <p>The Service is provided "as is" without warranties of any kind. We do not warrant that the Service will be uninterrupted, error-free, or that all data will be preserved indefinitely.</p>
            <p>iDogs is a record-keeping tool. It does not provide veterinary, legal, or compliance advice. Users are responsible for ensuring their records meet all applicable regulatory requirements.</p>
            <p>To the maximum extent permitted by Australian law, our liability to you for any loss or damage is limited to the amount you paid us in the 12 months preceding the claim.</p>
          </LegalSection>

          <LegalSection title="9. Termination">
            <p>We may terminate or suspend your account at any time for violation of these Terms, with or without notice.</p>
            <p>Upon termination, your access to the Service ceases. Your data is retained for 30 days after termination, during which you may export it. After 30 days, data may be permanently deleted.</p>
          </LegalSection>

          <LegalSection title="10. Changes to Terms">
            <p>We may update these Terms from time to time. We will notify you of significant changes via email or in-app notice. Continued use of the Service after changes constitutes acceptance of the updated Terms.</p>
          </LegalSection>

          <LegalSection title="11. Governing Law">
            <p>These Terms are governed by the laws of South Australia, Australia. Any disputes shall be subject to the exclusive jurisdiction of the courts of South Australia.</p>
          </LegalSection>

          <LegalSection title="12. Contact">
            <p>For questions about these Terms, contact us at:</p>
            <p><strong>iziPaws Pty Ltd</strong><br />ABN: 42 693 563 745<br />Adelaide, South Australia<br />Email: info@izipaws.com.au</p>
          </LegalSection>
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: 'var(--dark)', padding: '24px', textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
        © 2026 iDogs · iziPaws Pty Ltd ABN 42 693 563 745 ·{' '}
        <Link to="/privacy" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>Privacy Policy</Link>
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
