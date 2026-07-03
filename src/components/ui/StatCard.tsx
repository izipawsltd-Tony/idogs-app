import { Link } from 'react-router-dom'

interface Props {
  value: number | string
  label: string
  icon?: string
  color?: string
  href?: string
}

export default function StatCard({ value, label, icon, color, href }: Props) {
  return (
    <div className="card card-shadow" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        {icon ? (
          <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
        ) : (
          <span />
        )}
        {href && (
          <Link
            to={href}
            style={{ fontSize: 12, color: 'var(--brand-600)', textDecoration: 'none', fontWeight: 500 }}
          >
            View all →
          </Link>
        )}
      </div>
      <div style={{
        fontSize: 30, fontWeight: 700, fontFamily: 'var(--font-display)',
        color: color ?? 'var(--dark)', lineHeight: 1, marginBottom: 4,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 13, color: 'var(--mid)' }}>{label}</div>
    </div>
  )
}
