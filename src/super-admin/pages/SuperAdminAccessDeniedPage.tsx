import { Link } from 'react-router-dom'

export default function SuperAdminAccessDeniedPage() {
  return (
    <div className="super-admin-denied">
      <div className="super-admin-denied-card">
        <img src="/logo.png" alt="iDogs" />
        <p className="super-admin-kicker">Super SaaS Admin</p>
        <h1>Access restricted</h1>
        <p>
          This console is only available to approved iDogs Super Admin accounts.
        </p>
        <Link className="btn btn-secondary" to="/app/dashboard">
          Return to iDogs
        </Link>
      </div>
    </div>
  )
}
