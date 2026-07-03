import type { CSSProperties, ReactNode } from 'react'

interface Props {
  children: ReactNode
  shadow?: boolean
  size?: 'sm' | 'md'
  className?: string
  style?: CSSProperties
}

export default function Card({ children, shadow = false, size = 'md', className = '', style }: Props) {
  const classes = ['card', size === 'sm' ? 'card-sm' : '', shadow ? 'card-shadow' : '', className]
    .filter(Boolean).join(' ')
  return (
    <div className={classes} style={style}>
      {children}
    </div>
  )
}
