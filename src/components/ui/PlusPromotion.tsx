import { useEffect, useState } from 'react'
import { isPlusPromotionActive, PLUS_PROMOTION_TERMS } from '../../../shared/plus-promotion.js'

export function usePlusPromotion() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return isPlusPromotionActive(now)
}

export default function PlusPromotion() {
  return <div style={{ padding: '20px 0', color: 'var(--forest, var(--green))' }}>
    <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', margin: '0 0 12px' }}>Limited-time Plus offer</p>
    <div aria-label="Normally A$7, now A$0 per month" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' }}>
      <del style={{ fontSize: 30, color: '#747b76' }}>A$7</del>
      <strong style={{ fontSize: 54, lineHeight: 1.1 }}>A$0</strong>
      <span style={{ fontSize: 15 }}>/month</span>
    </div>
    <p style={{ margin: '12px 0 6px', fontWeight: 700 }}>Enjoy iDogs Plus free through 31 January 2027</p>
    <p style={{ fontSize: 13, lineHeight: 1.65, margin: 0 }}>{PLUS_PROMOTION_TERMS}</p>
  </div>
}
