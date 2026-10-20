import { useEffect, useState } from 'react'
import { smsDeliveryStatus, type SmsDisplayState } from '../../lib/smsDeliveryStatus'

export default function SmsUsageStatus({ sms }: { sms: SmsDisplayState }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (sms.status !== 'active') return
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [sms.status])
  const summary = smsDeliveryStatus(sms, now)
  return <div style={{ marginTop: 8, fontSize: 13, color: 'var(--mid)', lineHeight: 1.55 }}>
    <div>Add-on status: <strong style={{ textTransform: 'capitalize' }}>{sms.status || 'inactive'}</strong></div>
    {sms.status === 'active' && <>
      <div>Usage: <strong>{summary.used} / {summary.limit}</strong> credits · {summary.remaining} remaining</div>
      <div role="progressbar" aria-label="SMS credits used" aria-valuemin={0}
        aria-valuemax={Math.max(1, summary.limit)} aria-valuenow={Math.min(summary.used, Math.max(1, summary.limit))}
        aria-valuetext={`${summary.used} of ${summary.limit} credits used`}
        style={{ height: 8, borderRadius: 999, background: 'var(--sand)', overflow: 'hidden', margin: '8px 0' }}>
        <div style={{ width: `${Math.min(100, summary.used / Math.max(1, summary.limit) * 100)}%`, height: '100%', background: 'var(--green)' }} />
      </div>
    </>}
    <p role="status" style={{ fontSize: 12, margin: '6px 0' }}>{summary.message}</p>
    {sms.status === 'active' && summary.eligible && summary.used >= summary.limit * 0.8 &&
      <p style={{ fontSize: 12, color: 'var(--gold)', margin: '6px 0' }}>You have used at least 80% of this period’s SMS credits.</p>}
    <p style={{ fontSize: 12, margin: '6px 0' }}>One long or Unicode SMS can use more than one credit. In-app reminders remain available; email follows your notification settings.</p>
  </div>
}
