import { useEffect, useState } from 'react'
import { isPlusPromotionActive } from '../../../shared/plus-promotion.js'
import { PLUS_MONTHLY_PRICE_AUD } from '../../lib/pricingCopy'

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
    <div className="plus-promotion-price" aria-label={'A>
      <del className="plus-promotion-original-price" aria-label={'Regular price A>{'A</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{'A</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month crossed out; A$0 per month during the promotion'}>
      <del className="plus-promotion-original-price" aria-label={`Regular price A${PLUS_MONTHLY_PRICE_AUD} per month`}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month'}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month crossed out; A$0 per month during the promotion'}>
      <del className="plus-promotion-original-price" aria-label={`Regular price A${PLUS_MONTHLY_PRICE_AUD} per month`}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month crossed out; A$0 per month during the promotion'}>
      <del className="plus-promotion-original-price" aria-label={`Regular price A${PLUS_MONTHLY_PRICE_AUD} per month`}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month'}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month crossed out; A$0 per month during the promotion'}>
      <del className="plus-promotion-original-price" aria-label={`Regular price A${PLUS_MONTHLY_PRICE_AUD} per month`}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + '/month'}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month crossed out; A$0 per month during the promotion'}>
      <del className="plus-promotion-original-price" aria-label={`Regular price A${PLUS_MONTHLY_PRICE_AUD} per month`}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month'}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month crossed out; A$0 per month during the promotion'}>
      <del className="plus-promotion-original-price" aria-label={`Regular price A${PLUS_MONTHLY_PRICE_AUD} per month`}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month crossed out; A$0 per month during the promotion'}>
      <del className="plus-promotion-original-price" aria-label={`Regular price A${PLUS_MONTHLY_PRICE_AUD} per month`}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month'}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
 + PLUS_MONTHLY_PRICE_AUD + ' per month crossed out; A$0 per month during the promotion'}>
      <del className="plus-promotion-original-price" aria-label={`Regular price A${PLUS_MONTHLY_PRICE_AUD} per month`}>{`A${PLUS_MONTHLY_PRICE_AUD}`}</del>
      <strong>A$0</strong><span>/month</span>
    </div>
    <p className="plus-promotion-dates">Through <strong>31 January 2027</strong> (Adelaide time)</p>
    <p className="plus-promotion-renewal">Then <strong>{`A${PLUS_MONTHLY_PRICE_AUD}/month`}</strong> from 1 February 2027, including GST.</p>
    <p className="plus-promotion-terms">Payment details required. Renews automatically unless cancelled before renewal. SMS and extra litters are not included.</p>
  </section>
}
