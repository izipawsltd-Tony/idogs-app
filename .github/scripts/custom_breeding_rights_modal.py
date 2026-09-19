from pathlib import Path

p = Path('src/pages/DogDetailPage.tsx')
s = p.read_text(encoding='utf-8')

# Add pending/saving state to OverviewTab.
needle = "  const [savingBreederId, setSavingBreederId] = useState(false)\n  const pedigreeRegisterStatus = resolvePedigreeRegister((dog as any).pedigreeRegister)"
replacement = "  const [savingBreederId, setSavingBreederId] = useState(false)\n  const [pendingBreedingRights, setPendingBreedingRights] = useState<BreedingRightsValue | null>(null)\n  const [savingBreedingRights, setSavingBreedingRights] = useState(false)\n  const pedigreeRegisterStatus = resolvePedigreeRegister((dog as any).pedigreeRegister)"
if needle not in s:
    raise SystemExit('Overview state insertion point not found')
s = s.replace(needle, replacement, 1)

# Replace native browser confirm with custom modal trigger; ordinary non-eligible changes still save directly.
old = '''                onChange={async e => {
                  const next = e.target.value as BreedingRightsValue
                  if (next === 'eligible') {
                    const confirmed = window.confirm("Confirm breeding rights?\\n\\nI confirm this dog is on Main Register and I am recording that its breeding rights are not restricted.\\n\\nThis does NOT mean the dog automatically passes age, health or legal breeding compliance checks.")
                    if (!confirmed) { e.currentTarget.value = initialBreedingRightsValue(dog as any); return }
                  }
                  await onUpdateDogFields(nextBreedingRightsUpdate((dog as any).pedigreeRegister, next) as Partial<Dog>)
                  toast('Breeding rights updated')
                }}'''
new = '''                onChange={async e => {
                  const next = e.target.value as BreedingRightsValue
                  if (next === 'eligible') {
                    setPendingBreedingRights('eligible')
                    return
                  }
                  await onUpdateDogFields(nextBreedingRightsUpdate((dog as any).pedigreeRegister, next) as Partial<Dog>)
                  toast('Breeding rights updated')
                }}'''
if old not in s:
    raise SystemExit('Native breeding rights confirmation block not found')
s = s.replace(old, new, 1)

# Insert custom iDogs modal before the end of OverviewTab root grid (before SaleAvailabilityPanel block marker).
marker = "      <SaleAvailabilityPanel"
idx = s.find(marker, s.find('function OverviewTab'))
if idx < 0:
    raise SystemExit('SaleAvailabilityPanel marker not found')
modal = '''      {pendingBreedingRights === 'eligible' && (
        <div
          role="presentation"
          onMouseDown={e => { if (e.target === e.currentTarget && !savingBreedingRights) setPendingBreedingRights(null) }}
          style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(20, 33, 29, 0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-breeding-rights-title"
            style={{ width: 'min(100%, 460px)', background: '#fff', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(20,33,29,0.22)', overflow: 'hidden' }}
          >
            <div style={{ padding: '20px 22px 12px' }}>
              <div id="confirm-breeding-rights-title" style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--dark)', marginBottom: 10 }}>
                Confirm breeding rights
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.55, color: 'var(--mid)' }}>
                I confirm this dog is on <strong>Main Register</strong> and I am recording that its breeding rights are not restricted.
              </p>
              <div style={{ padding: '10px 12px', borderRadius: 10, background: '#FFF9EC', border: '1px solid #EBD9A8', fontSize: 12, lineHeight: 1.5, color: 'var(--mid)' }}>
                <strong style={{ color: 'var(--dark)' }}>Important:</strong> This does not mean the dog automatically passes age, health or legal breeding compliance checks. Review Actual Breeding Compliance separately before breeding.
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 22px 18px' }}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={savingBreedingRights} onClick={() => setPendingBreedingRights(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={savingBreedingRights}
                onClick={async () => {
                  setSavingBreedingRights(true)
                  try {
                    await onUpdateDogFields(nextBreedingRightsUpdate((dog as any).pedigreeRegister, 'eligible') as Partial<Dog>)
                    toast('Breeding rights confirmed')
                    setPendingBreedingRights(null)
                  } catch {
                    toast('Failed to update breeding rights', 'error')
                  } finally {
                    setSavingBreedingRights(false)
                  }
                }}
              >
                {savingBreedingRights ? 'Saving…' : 'Confirm breeding rights'}
              </button>
            </div>
          </div>
        </div>
      )}

'''
s = s[:idx] + modal + s[idx:]

p.write_text(s, encoding='utf-8')
