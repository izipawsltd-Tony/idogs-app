import { useParams, Link } from 'react-router-dom'
import PuppyStoryPanel from '../components/ui/PuppyStoryPanel'
import { puppyPath } from '../lib/puppyUpdates'

export default function PuppyUpdatesPage() {
  const { passportId } = useParams<{ passportId: string }>()
  if (!passportId) return <p>Invalid puppy link.</p>
  return <div style={{ maxWidth: 760, margin: '0 auto' }}><Link to="/app/following-puppies">← Following puppies</Link><PuppyStoryPanel key={passportId} passportId={passportId} /><Link to={puppyPath(passportId)}>Open QR profile and passport</Link></div>
}
