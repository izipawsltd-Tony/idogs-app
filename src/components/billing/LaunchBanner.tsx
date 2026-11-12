import { Link } from 'react-router-dom'
import { LaunchCountdownLine, useOfferStatus } from './LaunchOfferCard'

// Public landing banner for the launch campaign. Renders nothing unless the
// server says the campaign is open (real counter), and never in native apps.
export default function LaunchBanner() {
  const status = useOfferStatus()
  if (!status?.launch.active) return null
  return (
    <div data-testid="launch-banner" style={{ background: 'var(--green)', color: '#fff', padding: '10px 16px', textAlign: 'center', fontSize: 14 }}>
      <strong>100 free years of iDogs Plus</strong> — add your dog and claim yours. <LaunchCountdownLine status={status} />{' '}
      <Link to="/signup?next=%2Fapp%2Fbilling" style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}>Claim your free year</Link>
    </div>
  )
}
