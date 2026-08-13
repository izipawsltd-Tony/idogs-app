import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { SUPER_ADMIN_NAV } from './superAdminConfig'
import './superAdmin.css'

export default function SuperAdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await logout()
    navigate('/')
  }

  return (
    <div className="super-admin-shell">
      <aside className="super-admin-sidebar" aria-label="Super Admin navigation">
        <div className="super-admin-brand">
          <img src="/logo.png" alt="iDogs" />
          <div>
            <span>Super SaaS Admin</span>
            <strong>Operations Console</strong>
          </div>
        </div>

        <nav className="super-admin-nav">
          {SUPER_ADMIN_NAV.map(section => (
            <section key={section.label}>
              <h2>{section.label}</h2>
              {section.items.map(item => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `super-admin-nav-link${isActive ? ' active' : ''}`}
                >
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </NavLink>
              ))}
            </section>
          ))}
        </nav>
      </aside>

      <div className="super-admin-main">
        <header className="super-admin-topbar">
          <div>
            <span className="super-admin-kicker">iDogs platform administration</span>
            <h1>Super SaaS Admin</h1>
          </div>
          <div className="super-admin-identity">
            <div>
              <span>Signed in as</span>
              <strong>{user?.email || 'Admin'}</strong>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </header>

        <main className="super-admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
