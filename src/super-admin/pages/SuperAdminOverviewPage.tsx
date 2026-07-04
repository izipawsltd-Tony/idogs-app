import { SUPER_ADMIN_NAV } from '../superAdminConfig'

const PRINCIPLES = [
  'Super Admin is isolated from the Breeder Workspace.',
  'No cross-tenant browser reads are connected in this foundation batch.',
  'Future data APIs must verify Firebase ID tokens and admin authorization server-side.',
]

export default function SuperAdminOverviewPage() {
  const futureModules = SUPER_ADMIN_NAV.flatMap(section =>
    section.items.map(item => ({ ...item, section: section.label }))
  )

  return (
    <div className="super-admin-page">
      <section className="super-admin-page-title">
        <p className="super-admin-kicker">Overview</p>
        <h2>Dashboard shell</h2>
        <p>
          Foundation for the iDogs Super SaaS Admin V1. Live platform data is not connected in this batch.
        </p>
      </section>

      <section className="super-admin-panel">
        <div className="super-admin-panel-header">
          <div>
            <p className="super-admin-kicker">Architecture status</p>
            <h3>Ready for future modules</h3>
          </div>
          <span className="super-admin-status">Shell only</span>
        </div>
        <div className="super-admin-principles">
          {PRINCIPLES.map(item => (
            <div key={item}>
              <span />
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="super-admin-module-grid">
        {futureModules.map(module => (
          <article key={module.path} className="super-admin-module-card">
            <span>{module.section}</span>
            <h3>{module.label}</h3>
            <p>{module.description}</p>
          </article>
        ))}
      </section>
    </div>
  )
}
