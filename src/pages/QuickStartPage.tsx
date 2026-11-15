import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
export default function QuickStartPage() {
  const { profile } = useAuth()
  return <section style={{ maxWidth: 700, margin: '24px auto' }}><h1>Welcome{profile?.firstName ? `, ${profile.firstName}` : ''}!</h1><p>Start with what matters to you. You can add more details later.</p><div style={{ display: 'grid', gap: 16 }}>
    <Link className="card" to="/app/following-puppies"><h2>Following puppies</h2><p>Keep the puppies you love in one place. Scan a puppy’s QR or open its link to follow their story.</p></Link>
    <Link className="card" to="/app/dogs/new"><h2>Add my dog</h2><p>Start a home for your dog’s photos, records and milestones.</p></Link>
    <Link className="card" to="/app/settings"><h2>Manage my breeding</h2><p>Set up your breeder workspace when you’re ready.</p></Link>
    <Link to="/">Explore iDogs →</Link>
  </div></section>
}
