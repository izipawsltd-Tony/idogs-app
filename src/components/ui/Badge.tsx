import type { ReactNode } from 'react'

type Variant = 'green' | 'gold' | 'red' | 'gray' | 'active' | 'closed'

interface Props {
  variant?: Variant
  dot?: boolean
  children: ReactNode
}

export default function Badge({ variant = 'gray', dot = false, children }: Props) {
  return (
    <span className={`badge badge-${variant}`}>
      {dot && (
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'currentColor', display: 'inline-block', flexShrink: 0,
        }} />
      )}
      {children}
    </span>
  )
}
