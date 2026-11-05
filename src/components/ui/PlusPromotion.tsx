import { useEffect, useState } from 'react'
import { isPlusPromotionActive } from '../../../shared/plus-promotion.js'

export function usePlusPromotion() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return isPlusPromotionActive(now)
}

export default function PlusPromotion() {
  return <section className="plus-promotion" aria-label="Plus A$0 offer">
    <p className="plus-promotion-badge">Plus promotion</p>
    <div className="plus-promotion-price" aria-label="A$0 per month during the promotion">
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>A$7/month</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
