type Props = {
  title: string
  section: string
  description: string
}

export default function SuperAdminModulePlaceholderPage({ title, section, description }: Props) {
  return (
    <div className="super-admin-page">
      <section className="super-admin-page-title">
        <p className="super-admin-kicker">{section}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </section>

      <section className="super-admin-panel super-admin-placeholder">
        <span>Coming in next implementation phase</span>
        <h3>No live data connected</h3>
        <p>
          This route is reserved so the Super Admin architecture can grow without changing the shell.
        </p>
      </section>
    </div>
  )
}
