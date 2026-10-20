import { useState } from 'react'
import { addReminder } from '../../lib/db'
import type { Dog, Reminder } from '../../types'

export const REMINDER_TYPES: { value: Reminder['type']; label: string }[] = [
  { value: 'worming', label: 'Worming' }, { value: 'vaccination', label: 'Vaccination' },
  { value: 'flea_tick', label: 'Flea & tick' }, { value: 'medication', label: 'Medication' },
  { value: 'vet_appointment', label: 'Vet appointment' }, { value: 'custom', label: 'Other' },
  { value: 'grooming', label: 'Grooming' }, { value: 'weight_check', label: 'Weight check' },
  { value: 'dental_care', label: 'Dental care' }, { value: 'nail_trim', label: 'Nail trim' },
]

export default function ReminderForm({ dogs, tenantId, onSaved, onCancel }: {
  dogs: Pick<Dog, 'id' | 'name'>[]; tenantId: string; onSaved: () => void | Promise<void>; onCancel: () => void
}) {
  const [dogId, setDogId] = useState(dogs.length === 1 ? dogs[0].id : '')
  const [type, setType] = useState<Reminder['type']>('custom')
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notifyDaysBefore, setNotifyDaysBefore] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving || !dogs.some(d => d.id === dogId) || !title.trim() || !dueDate) return
    setSaving(true); setError('')
    try {
      await addReminder({ dogId, tenantId, type, title: title.trim(), dueDate, notifyDaysBefore, status: 'pending', source: 'manual' })
      await onSaved()
    } catch { setError('Could not save reminder. Please try again.') }
    finally { setSaving(false) }
  }
  return <form className="card" onSubmit={save} style={{ padding: 20, marginBottom: 16 }}>
    <h3>Add reminder</h3>
    <div className="form-group"><label className="form-label" htmlFor="reminder-dog">Dog</label>
      <select id="reminder-dog" className="form-input" required value={dogId} onChange={e => setDogId(e.target.value)} disabled={saving}>
        <option value="">Select a dog</option>{dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select></div>
    <div className="form-group"><label className="form-label" htmlFor="reminder-type">Type</label>
      <select id="reminder-type" className="form-input" value={type} disabled={saving} onChange={e => { const value = e.target.value as Reminder['type']; setType(value); if (!title || REMINDER_TYPES.some(t => t.label === title)) setTitle(value === 'custom' ? '' : REMINDER_TYPES.find(t => t.value === value)?.label || '') }}>
        {REMINDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select></div>
    <div className="form-group"><label className="form-label" htmlFor="reminder-title">{type === 'custom' ? 'Reminder details' : 'Title'}</label><input id="reminder-title" className="form-input" placeholder={type === 'custom' ? 'Enter your reminder, e.g. renew dog registration' : undefined} required maxLength={200} value={title} disabled={saving} onChange={e => setTitle(e.target.value)} /></div>
    <div className="form-group"><label className="form-label" htmlFor="reminder-date">Due date</label><input id="reminder-date" className="form-input" type="date" required value={dueDate} disabled={saving} onChange={e => setDueDate(e.target.value)} /></div>
    <div className="form-group"><label className="form-label" htmlFor="reminder-alert">Alert lead time</label><select id="reminder-alert" className="form-input" value={notifyDaysBefore} disabled={saving} onChange={e => setNotifyDaysBefore(Number(e.target.value))}>{[0,1,3,7,14].map(n => <option key={n} value={n}>{n === 0 ? 'On the due date' : `${n} days before`}</option>)}</select></div>
    <p style={{ fontSize: 12 }}>Choose dates using your product instructions or veterinary advice. This saves a reminder in iDogs.</p>
    {error && <p role="alert">{error}</p>}
    <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save reminder'}</button><button className="btn btn-secondary btn-sm" type="button" disabled={saving} onClick={onCancel}>Cancel</button></div>
  </form>
}
