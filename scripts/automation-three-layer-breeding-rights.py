from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    data = p.read_text(encoding='utf-8')
    if old not in data:
        raise SystemExit(f'Anchor not found in {path}: {old[:120]!r}')
    p.write_text(data.replace(old, new, 1), encoding='utf-8')


def replace_all_required(path: str, replacements):
    p = Path(path)
    data = p.read_text(encoding='utf-8')
    for old, new in replacements:
        if old not in data:
            raise SystemExit(f'Anchor not found in {path}: {old[:120]!r}')
        data = data.replace(old, new)
    p.write_text(data, encoding='utf-8')


def replace_between(path: str, start_marker: str, end_marker: str, new_block: str):
    p = Path(path)
    data = p.read_text(encoding='utf-8')
    start = data.find(start_marker)
    if start < 0:
        raise SystemExit(f'Start marker not found in {path}: {start_marker!r}')
    end = data.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'End marker not found in {path}: {end_marker!r}')
    p.write_text(data[:start] + new_block + data[end:], encoding='utf-8')


# ---------------------------------------------------------------------------
# 1) Canonical domain model: Registration -> Breeding rights -> Compliance
# ---------------------------------------------------------------------------
replace_once(
    'src/lib/breedingCompliance.ts',
    "export type BreedingEligibilityStatus = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'UNKNOWN'\n",
    "export type BreedingEligibilityStatus = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'UNKNOWN'\n"
    "export type BreedingRightsValue = 'eligible' | 'not_eligible' | 'unknown'\n",
)

rights_helpers = r'''
/**
 * UI/storage adapter for the explicit breeder-controlled layer between
 * pedigree registration and actual compliance. We keep the existing
 * Firestore field name `breedingEligibility` for backwards compatibility,
 * but user-facing copy calls it "Breeding rights" so it cannot be confused
 * with the final compliance result.
 */
export function initialBreedingRightsValue(
  dog: { pedigreeRegister?: string; breedingEligibility?: string },
): BreedingRightsValue {
  const status = resolveBreedingEligibility(dog)
  if (status === 'ELIGIBLE') return 'eligible'
  if (status === 'NOT_ELIGIBLE') return 'not_eligible'
  return 'unknown'
}

export function breedingRightsLabel(value: BreedingRightsValue | BreedingEligibilityStatus): string {
  switch (value) {
    case 'eligible':
    case 'ELIGIBLE':
      return 'Breeding permitted'
    case 'not_eligible':
    case 'NOT_ELIGIBLE':
      return 'Not permitted'
    default:
      return 'Not confirmed'
  }
}

/**
 * Canonical write rule for the Breeding rights control.
 * - LIMITED always forces not_eligible.
 * - MAIN may be explicitly confirmed as permitted, not permitted, or unknown.
 * - Any other registration state cannot be promoted to permitted through the
 *   rights control; it resolves to unknown until registration is authoritative.
 */
export function nextBreedingRightsUpdate(
  pedigreeRegisterRaw: string | undefined,
  nextRightsRaw: BreedingRightsValue,
): { breedingEligibility: BreedingRightsValue } {
  const register = resolvePedigreeRegister(pedigreeRegisterRaw)
  if (register === 'LIMITED') return { breedingEligibility: 'not_eligible' }
  if (register !== 'MAIN') return { breedingEligibility: 'unknown' }
  return { breedingEligibility: nextRightsRaw }
}

'''
replace_once(
    'src/lib/breedingCompliance.ts',
    "/**\n * Canonical patch to write whenever a user sets pedigree/registration —",
    rights_helpers + "/**\n * Canonical patch to write whenever a user sets pedigree/registration —",
)

replace_all_required('src/lib/breedingCompliance.ts', [
    ('Limited Register — not eligible to breed under Dogs Australia rules', 'Limited Register — breeding rights do not permit breeding'),
    ('Registration not recorded — breeding eligibility unknown', 'Registration not recorded — breeding rights not confirmed'),
    ('Main Register — breeding eligibility not confirmed', 'Main Register — breeding rights not confirmed'),
    ('Marked not eligible for breeding', 'Breeding rights marked not permitted'),
    (' — not eligible for breeding`', ' — breeding rights do not permit breeding`'),
    (' — breeding eligibility unknown`', ' — breeding rights not confirmed`'),
    (' — breeding eligibility not confirmed`', ' — breeding rights not confirmed`'),
    (' is marked not eligible for breeding`', ' has breeding rights marked not permitted`'),
    (": '✓ Currently eligible to breed'", ": '✓ Actual breeding compliance checks passed'"),
])

# ---------------------------------------------------------------------------
# 2) Dog Detail: explicit three-layer UI + breeder rights confirmation
# ---------------------------------------------------------------------------
replace_once(
    'src/pages/DogDetailPage.tsx',
    "import { resolvePedigreeRegister, resolveBreedingEligibility, nextPedigreeRegisterUpdate, initialTransferPedigreeRegister, pedigreeRegisterLabel } from '../lib/breedingCompliance'",
    "import { resolvePedigreeRegister, resolveBreedingEligibility, nextPedigreeRegisterUpdate, nextBreedingRightsUpdate, initialTransferPedigreeRegister, initialBreedingRightsValue, pedigreeRegisterLabel, breedingRightsLabel, type BreedingRightsValue } from '../lib/breedingCompliance'",
)

replace_once(
    'src/pages/DogDetailPage.tsx',
    "async function handleTransfer(buyerName: string, buyerEmail: string, buyerPhone: string | undefined, pedigreeRegister: string) {",
    "async function handleTransfer(buyerName: string, buyerEmail: string, buyerPhone: string | undefined, pedigreeRegister: string, breedingRights: BreedingRightsValue) {",
)
replace_once(
    'src/pages/DogDetailPage.tsx',
    "    const pedigreeUpdate = nextPedigreeRegisterUpdate((dog as any).pedigreeRegister, pedigreeRegister)\n",
    "    const pedigreeUpdate = nextPedigreeRegisterUpdate((dog as any).pedigreeRegister, pedigreeRegister)\n"
    "    const rightsUpdate = nextBreedingRightsUpdate(pedigreeRegister, breedingRights)\n",
)
replace_once(
    'src/pages/DogDetailPage.tsx',
    "      breedingEligibility: pedigreeUpdate.breedingEligibility,",
    "      breedingEligibility: rightsUpdate.breedingEligibility,",
)
replace_once(
    'src/pages/DogDetailPage.tsx',
    "    setDog(prev => prev ? { ...prev, status: 'transferred', transferStatus: 'pendingClaim', buyerName, buyerEmail, buyerPhone, ...pedigreeUpdate } as any : prev)",
    "    setDog(prev => prev ? { ...prev, status: 'transferred', transferStatus: 'pendingClaim', buyerName, buyerEmail, buyerPhone, ...pedigreeUpdate, ...rightsUpdate } as any : prev)",
)

replace_once(
    'src/pages/DogDetailPage.tsx',
    "          initialPedigreeRegister={initialTransferPedigreeRegister((dog as any).pedigreeRegister)}\n",
    "          initialPedigreeRegister={initialTransferPedigreeRegister((dog as any).pedigreeRegister)}\n"
    "          initialBreedingRights={initialBreedingRightsValue(dog as any)}\n",
)
replace_once(
    'src/pages/DogDetailPage.tsx',
    "  initialPedigreeRegister,\n  onClose,",
    "  initialPedigreeRegister,\n  initialBreedingRights,\n  onClose,",
)
replace_once(
    'src/pages/DogDetailPage.tsx',
    "  initialPedigreeRegister: string\n  onClose: () => void\n  onTransfer: (name: string, email: string, phone: string | undefined, pedigreeRegister: string) => Promise<void>",
    "  initialPedigreeRegister: string\n  initialBreedingRights: BreedingRightsValue\n  onClose: () => void\n  onTransfer: (name: string, email: string, phone: string | undefined, pedigreeRegister: string, breedingRights: BreedingRightsValue) => Promise<void>",
)
replace_once(
    'src/pages/DogDetailPage.tsx',
    "  const [pedigreeRegister, setPedigreeRegister] = useState(initialPedigreeRegister)\n",
    "  const [pedigreeRegister, setPedigreeRegister] = useState(initialPedigreeRegister)\n"
    "  const [breedingRights, setBreedingRights] = useState<BreedingRightsValue>(initialBreedingRights)\n",
)
replace_once(
    'src/pages/DogDetailPage.tsx',
    "      await onTransfer(buyerName.trim(), buyerEmail.trim().toLowerCase(), buyerPhone.trim() || undefined, pedigreeRegister)",
    "      await onTransfer(buyerName.trim(), buyerEmail.trim().toLowerCase(), buyerPhone.trim() || undefined, pedigreeRegister, breedingRights)",
)
replace_once(
    'src/pages/DogDetailPage.tsx',
    "              onChange={e => setPedigreeRegister(e.target.value)}",
    "              onChange={e => {\n"
    "                const nextRegister = e.target.value\n"
    "                const patch = nextPedigreeRegisterUpdate(pedigreeRegister, nextRegister)\n"
    "                setPedigreeRegister(nextRegister)\n"
    "                if (patch.breedingEligibility) setBreedingRights(patch.breedingEligibility)\n"
    "                else if (resolvePedigreeRegister(nextRegister) !== 'MAIN') setBreedingRights('unknown')\n"
    "              }}",
)

transfer_rights_block = r'''          {/* Breeding rights — separate from pedigree registration and from
              the final compliance engine. Only Main Register can carry an
              explicit breeder-confirmed permitted/not-permitted decision. */}
          <div className="form-group">
            <label className="form-label">Breeding rights</label>
            {resolvePedigreeRegister(pedigreeRegister) === 'MAIN' ? (
              <select
                className="form-select"
                value={breedingRights}
                onChange={e => setBreedingRights(e.target.value as BreedingRightsValue)}
              >
                <option value="unknown">⚪ Not confirmed</option>
                <option value="eligible">🟢 Breeding permitted</option>
                <option value="not_eligible">🔴 Not permitted</option>
              </select>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--mid)', padding: '8px 10px', background: 'var(--sand)', borderRadius: 8 }}>
                {resolvePedigreeRegister(pedigreeRegister) === 'LIMITED'
                  ? '🔴 Not permitted — Limited Register'
                  : '⚪ Not confirmed — registration does not establish breeding rights'}
              </div>
            )}
            <p className="form-hint">Breeding rights are the breeder's recorded permission. Actual breeding compliance is checked separately against age, health and state/Dogs Australia rules.</p>
          </div>

'''
replace_once(
    'src/pages/DogDetailPage.tsx',
    "          {/* Warning */}\n",
    transfer_rights_block + "          {/* Warning */}\n",
)
replace_once(
    'src/pages/DogDetailPage.tsx',
    "            <span>I confirm I want to transfer <strong>{dogName}</strong> to this buyer as <strong>{pedigreeRegisterLabel(pedigreeRegister)}</strong>. This action cannot be undone.</span>",
    "            <span>I confirm I want to transfer <strong>{dogName}</strong> to this buyer as <strong>{pedigreeRegisterLabel(pedigreeRegister)}</strong>{resolvePedigreeRegister(pedigreeRegister) === 'MAIN' ? <> with breeding rights <strong>{breedingRightsLabel(breedingRights)}</strong></> : null}. This action cannot be undone.</span>",
)

replace_once(
    'src/pages/DogDetailPage.tsx',
    "function OverviewTab({ dog, vaccines, wormings, healthTests, scanCount, toast, isOwner, isCurrentEffectiveOwner, onUpdateBreederId, onUpdateSale, vaccinesError, wormingError, healthTestsError }: {",
    "function OverviewTab({ dog, vaccines, wormings, healthTests, scanCount, toast, isOwner, isCurrentEffectiveOwner, onUpdateDogFields, onOpenBreeding, onUpdateBreederId, onUpdateSale, vaccinesError, wormingError, healthTestsError }: {",
)
replace_once(
    'src/pages/DogDetailPage.tsx',
    "  isCurrentEffectiveOwner: boolean\n  onUpdateBreederId:",
    "  isCurrentEffectiveOwner: boolean\n  onUpdateDogFields: (updates: Partial<Dog>) => Promise<void>\n  onOpenBreeding?: () => void\n  onUpdateBreederId:",
)
replace_once(
    'src/pages/DogDetailPage.tsx',
    "  const [savingBreederId, setSavingBreederId] = useState(false)\n",
    "  const [savingBreederId, setSavingBreederId] = useState(false)\n"
    "  const pedigreeRegisterStatus = resolvePedigreeRegister((dog as any).pedigreeRegister)\n"
    "  const breedingRightsStatus = resolveBreedingEligibility(dog as any)\n"
    "  const canEditBreedingRights = profile?.role === 'breeder' && isCurrentEffectiveOwner && !isRestricted && pedigreeRegisterStatus === 'MAIN'\n",
)

new_three_layer_block = r'''        {/* Layer 1 — Pedigree registration. Registration is descriptive only;
            it never silently decides breeding rights or actual compliance. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--light)', flexShrink: 0 }}>Pedigree registration</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: pedigreeRegisterStatus === 'MAIN' ? 'var(--brand-50)' : pedigreeRegisterStatus === 'LIMITED' ? '#FFF3E0' : 'var(--sand)', color: pedigreeRegisterStatus === 'MAIN' ? 'var(--brand-600)' : pedigreeRegisterStatus === 'LIMITED' ? '#E65100' : 'var(--mid)', border: pedigreeRegisterStatus === 'MAIN' ? '1px solid rgba(8,80,65,0.15)' : pedigreeRegisterStatus === 'LIMITED' ? '1px solid #FFCC80' : '1px solid transparent' }}>
              {pedigreeRegisterStatus === 'MAIN' ? '🔵 Main Register'
                : pedigreeRegisterStatus === 'LIMITED' ? '🟠 Limited Register'
                : pedigreeRegisterStatus === 'NO_PEDIGREE' ? 'No pedigree (purebred)'
                : pedigreeRegisterStatus === 'MIXED' ? 'Mixed breed'
                : pedigreeRegisterStatus === 'RESCUE' ? 'Rescue / unknown'
                : '⚪ Registration not recorded'}
            </span>
            <select
              className="form-select"
              value={(dog as any).pedigreeRegister || 'not_recorded'}
              disabled={isRestricted || !isCurrentEffectiveOwner}
              onChange={async e => {
                if (isRestricted || !isCurrentEffectiveOwner) return
                const updates = nextPedigreeRegisterUpdate((dog as any).pedigreeRegister, e.target.value)
                await onUpdateDogFields(updates as Partial<Dog>)
                toast('Pedigree registration updated')
              }}
              style={{ height: 28, fontSize: 12, padding: '0 28px 0 8px', minWidth: 100 }}
            >
              <option value="main">🔵 Main</option>
              <option value="limited">🟠 Limited</option>
              <option value="not_recorded">Not recorded</option>
              <option value="no_pedigree">No pedigree</option>
              <option value="mixed">Mixed breed</option>
              <option value="rescue">Rescue</option>
            </select>
          </div>
        </div>

        {/* Layer 2 — Breeding rights. This is an explicit breeder decision,
            not a conclusion from Main Register and not the compliance result. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--light)', flexShrink: 0 }}>Breeding rights</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: pedigreeRegisterStatus === 'LIMITED' || breedingRightsStatus === 'NOT_ELIGIBLE' ? '#FDEDED' : breedingRightsStatus === 'ELIGIBLE' ? 'var(--brand-50)' : 'var(--sand)', color: pedigreeRegisterStatus === 'LIMITED' || breedingRightsStatus === 'NOT_ELIGIBLE' ? 'var(--error)' : breedingRightsStatus === 'ELIGIBLE' ? 'var(--brand-600)' : 'var(--mid)' }}>
              {pedigreeRegisterStatus === 'LIMITED' ? '🔴 Not permitted — Limited Register'
                : pedigreeRegisterStatus !== 'MAIN' ? '⚪ Not confirmed'
                : breedingRightsStatus === 'ELIGIBLE' ? '🟢 Confirmed — breeding permitted'
                : breedingRightsStatus === 'NOT_ELIGIBLE' ? '🔴 Not permitted'
                : '⚪ Not confirmed'}
            </span>
            {canEditBreedingRights && (
              <select
                className="form-select"
                value={initialBreedingRightsValue(dog as any)}
                onChange={async e => {
                  const next = e.target.value as BreedingRightsValue
                  if (next === 'eligible') {
                    const confirmed = window.confirm("Confirm breeding rights?\n\nI confirm this dog is on Main Register and I am recording that its breeding rights are not restricted.\n\nThis does NOT mean the dog automatically passes age, health or legal breeding compliance checks.")
                    if (!confirmed) { e.currentTarget.value = initialBreedingRightsValue(dog as any); return }
                  }
                  await onUpdateDogFields(nextBreedingRightsUpdate((dog as any).pedigreeRegister, next) as Partial<Dog>)
                  toast('Breeding rights updated')
                }}
                style={{ height: 28, fontSize: 12, padding: '0 28px 0 8px', minWidth: 132 }}
              >
                <option value="unknown">Not confirmed</option>
                <option value="eligible">Breeding permitted</option>
                <option value="not_eligible">Not permitted</option>
              </select>
            )}
          </div>
        </div>

        {/* Layer 3 — Actual breeding compliance. Deliberately computed in
            the Breeding tab from age, state/Dogs Australia rules and breeding
            history; never inferred from registration or rights alone. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--light)', flexShrink: 0 }}>Actual breeding compliance</span>
          {onOpenBreeding ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenBreeding} style={{ fontSize: 12 }}>Review in Breeding tab →</button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--mid)', textAlign: 'right' }}>Checked separately when this dog is used for breeding</span>
          )}
        </div>
'''
replace_between(
    'src/pages/DogDetailPage.tsx',
    "        {/* Pedigree Register —",
    "        {editingBreederId ? (",
    new_three_layer_block,
)

replace_once(
    'src/pages/DogDetailPage.tsx',
    "healthTestsError={healthTestsError} onUpdateBreederId={async",
    "healthTestsError={healthTestsError} onUpdateDogFields={async (updates) => {\n"
    "        await updateDog(dogId!, updates)\n"
    "        setDog(prev => prev ? { ...prev, ...updates } : prev)\n"
    "      }} onOpenBreeding={dog.sex === 'female' && !isOwner ? () => setTab('breeding') : undefined} onUpdateBreederId={async",
)

# Breeding tab: distinguish registration, rights, and actual compliance.
replace_all_required('src/pages/DogDetailPage.tsx', [
    ("'❌ Limited Register — not eligible to breed under Dogs Australia rules'", "'❌ Limited Register — breeding rights do not permit breeding'"),
    ("'❌ Marked not eligible for breeding'", "'❌ Breeding rights marked not permitted'"),
    ("'ℹ️ Registration not recorded — breeding eligibility unknown'", "'ℹ️ Registration not recorded — breeding rights not confirmed'"),
    ("'ℹ️ Main Register — breeding eligibility not confirmed'", "'ℹ️ Main Register — breeding rights not confirmed'"),
    ("'✓ Currently eligible to breed'", "'✓ Actual breeding compliance checks passed'"),
])

rules_start = "  const rulesTable = [\n    { rule: 'Pedigree / Registration',"
rules_end = "    { rule: 'Minimum breeding age',"
p = Path('src/pages/DogDetailPage.tsx')
data = p.read_text(encoding='utf-8')
start = data.find(rules_start)
if start < 0:
    raise SystemExit('rules table start not found')
end = data.find(rules_end, start)
if end < 0:
    raise SystemExit('rules table end not found')
new_rules_head = r'''  const rulesTable = [
    { rule: 'Pedigree registration',
      value: pedigreeRegisterStatus === 'MAIN' ? '🔵 Main Register'
        : pedigreeRegisterStatus === 'LIMITED' ? '🟠 Limited Register'
        : isNotRecorded ? '⚪ Registration not recorded'
        : pedigreeRegisterStatus === 'NO_PEDIGREE' ? 'No pedigree (purebred without papers)'
        : pedigreeRegisterStatus === 'MIXED' ? 'Mixed breed'
        : 'Rescue / unknown',
      source: 'Dogs Australia Regulations Part 6',
      st: isNotRecorded ? 'info' : 'ok' },
    { rule: 'Breeding rights',
      value: isLimitedRegister ? '🔴 Not permitted — Limited Register'
        : isMarkedNotEligible ? '🔴 Not permitted'
        : isEligibilityUnconfirmed ? '⚪ Not confirmed'
        : '🟢 Confirmed — breeding permitted',
      source: 'Breeder-recorded rights',
      st: isLimitedRegister || isMarkedNotEligible ? 'fail' : isEligibilityUnconfirmed ? 'info' : 'ok' },
'''
p.write_text(data[:start] + new_rules_head + data[end:], encoding='utf-8')

replace_once(
    'src/pages/DogDetailPage.tsx',
    "              l: 'Register',\n              v: isLimitedRegister ? '🟠 Limited' : isNotRecorded ? '⚪ Not recorded' : '🔵 Main',\n              ok: !isLimitedRegister && !isNotRecorded && !isMarkedNotEligible && !isEligibilityUnconfirmed },",
    "              l: 'Registration',\n              v: isLimitedRegister ? '🟠 Limited' : isNotRecorded ? '⚪ Not recorded' : '🔵 Main',\n              ok: !isNotRecorded },\n            {\n              l: 'Breeding rights',\n              v: isLimitedRegister || isMarkedNotEligible ? '🔴 Not permitted' : isEligibilityUnconfirmed ? '⚪ Not confirmed' : '🟢 Confirmed',\n              ok: !isLimitedRegister && !isMarkedNotEligible && !isEligibilityUnconfirmed },",
)

# ---------------------------------------------------------------------------
# 3) Litter puppy transfer flow: same rights control and canonical helpers
# ---------------------------------------------------------------------------
replace_once(
    'src/pages/LittersPage.tsx',
    "import { resolvePedigreeRegister, nextPedigreeRegisterUpdate, initialTransferPedigreeRegister, pedigreeRegisterLabel } from '../lib/breedingCompliance'",
    "import { resolvePedigreeRegister, nextPedigreeRegisterUpdate, nextBreedingRightsUpdate, initialTransferPedigreeRegister, initialBreedingRightsValue, pedigreeRegisterLabel, breedingRightsLabel, type BreedingRightsValue } from '../lib/breedingCompliance'",
)
replace_once(
    'src/pages/LittersPage.tsx',
    "  const [transferPedigreeRegister, setTransferPedigreeRegister] = useState('not_recorded')\n",
    "  const [transferPedigreeRegister, setTransferPedigreeRegister] = useState('not_recorded')\n"
    "  const [transferBreedingRights, setTransferBreedingRights] = useState<BreedingRightsValue>('unknown')\n",
)
replace_once(
    'src/pages/LittersPage.tsx',
    "      const pedigreeUpdate = nextPedigreeRegisterUpdate((transferPuppy as any).pedigreeRegister, transferPedigreeRegister)\n",
    "      const pedigreeUpdate = nextPedigreeRegisterUpdate((transferPuppy as any).pedigreeRegister, transferPedigreeRegister)\n"
    "      const rightsUpdate = nextBreedingRightsUpdate(transferPedigreeRegister, transferBreedingRights)\n",
)
replace_once(
    'src/pages/LittersPage.tsx',
    "        breedingEligibility: pedigreeUpdate.breedingEligibility,",
    "        breedingEligibility: rightsUpdate.breedingEligibility,",
)
replace_once(
    'src/pages/LittersPage.tsx',
    "      setTransferPedigreeRegister('not_recorded')\n      setTransferConfirm(false)",
    "      setTransferPedigreeRegister('not_recorded')\n      setTransferBreedingRights('unknown')\n      setTransferConfirm(false)",
)
replace_once(
    'src/pages/LittersPage.tsx',
    "                                          setTransferPedigreeRegister(initialTransferPedigreeRegister((puppy as any).pedigreeRegister))\n                                          setTransferError('')",
    "                                          setTransferPedigreeRegister(initialTransferPedigreeRegister((puppy as any).pedigreeRegister))\n                                          setTransferBreedingRights(initialBreedingRightsValue(puppy as any))\n                                          setTransferError('')",
)
replace_once(
    'src/pages/LittersPage.tsx',
    "                  onChange={e => setTransferPedigreeRegister(e.target.value)}",
    "                  onChange={e => {\n"
    "                    const nextRegister = e.target.value\n"
    "                    const patch = nextPedigreeRegisterUpdate(transferPedigreeRegister, nextRegister)\n"
    "                    setTransferPedigreeRegister(nextRegister)\n"
    "                    if (patch.breedingEligibility) setTransferBreedingRights(patch.breedingEligibility)\n"
    "                    else if (resolvePedigreeRegister(nextRegister) !== 'MAIN') setTransferBreedingRights('unknown')\n"
    "                  }}",
)

litter_rights_block = r'''              <div className="form-group">
                <label className="form-label">Breeding rights</label>
                {resolvePedigreeRegister(transferPedigreeRegister) === 'MAIN' ? (
                  <select className="form-select" value={transferBreedingRights} onChange={e => setTransferBreedingRights(e.target.value as BreedingRightsValue)}>
                    <option value="unknown">⚪ Not confirmed</option>
                    <option value="eligible">🟢 Breeding permitted</option>
                    <option value="not_eligible">🔴 Not permitted</option>
                  </select>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--mid)', padding: '8px 10px', background: 'var(--sand)', borderRadius: 8 }}>
                    {resolvePedigreeRegister(transferPedigreeRegister) === 'LIMITED' ? '🔴 Not permitted — Limited Register' : '⚪ Not confirmed — registration does not establish breeding rights'}
                  </div>
                )}
                <p className="form-hint">Breeding rights are recorded separately from actual breeding compliance.</p>
              </div>
'''
replace_once(
    'src/pages/LittersPage.tsx',
    "              <div style={{ fontSize: '0.85rem', color: 'var(--warning)', background: '#FBF3E4', border: '1px solid #EBD9A8', borderRadius: 8, padding: '0.75rem 1rem' }}>",
    litter_rights_block + "              <div style={{ fontSize: '0.85rem', color: 'var(--warning)', background: '#FBF3E4', border: '1px solid #EBD9A8', borderRadius: 8, padding: '0.75rem 1rem' }}>",
)
replace_once(
    'src/pages/LittersPage.tsx',
    "                <span>I confirm I want to transfer <strong>{transferPuppy.name}</strong> to this buyer as <strong>{pedigreeRegisterLabel(transferPedigreeRegister)}</strong>. This cannot be undone.</span>",
    "                <span>I confirm I want to transfer <strong>{transferPuppy.name}</strong> to this buyer as <strong>{pedigreeRegisterLabel(transferPedigreeRegister)}</strong>{resolvePedigreeRegister(transferPedigreeRegister) === 'MAIN' ? <> with breeding rights <strong>{breedingRightsLabel(transferBreedingRights)}</strong></> : null}. This cannot be undone.</span>",
)

# ---------------------------------------------------------------------------
# 4) PDF report wording: show the same three separate layers
# ---------------------------------------------------------------------------
p = Path('api/export-report.js')
data = p.read_text(encoding='utf-8')
for old, new in [
    ("'Limited Register — not eligible to breed'", "'Limited Register — breeding rights do not permit breeding'"),
    ("'Marked not eligible for breeding'", "'Breeding rights marked not permitted'"),
    ("'Registration not recorded — breeding eligibility unknown'", "'Registration not recorded — breeding rights not confirmed'"),
    ("'Main Register — breeding eligibility not confirmed'", "'Main Register — breeding rights not confirmed'"),
    ("'Currently eligible to breed'", "'Actual breeding compliance checks passed'"),
]:
    if old not in data:
        raise SystemExit(f'api/export-report.js missing {old!r}')
    data = data.replace(old, new)
old_label = """  const pedigreeLabel = {\n    main: isMarkedNotEligible ? '🔵 Main Register — not eligible to breed'\n      : isEligibilityUnconfirmed ? '🔵 Main Register — breeding eligibility not confirmed'\n      : '🔵 Main Register (Blue) — eligible to breed',\n    limited: '🟠 Limited Register (Orange) — NOT eligible to breed',\n    not_recorded: '⚪ Registration not recorded — breeding eligibility unknown',\n    no_pedigree: 'No pedigree (purebred without papers)',\n    mixed: 'Mixed breed / crossbreed',\n    rescue: 'Rescue / unknown background',\n  }[pedigreeRegister] || '—'\n"""
new_label = """  const pedigreeLabel = {\n    main: '🔵 Main Register (Blue)',\n    limited: '🟠 Limited Register (Orange)',\n    not_recorded: '⚪ Registration not recorded',\n    no_pedigree: 'No pedigree (purebred without papers)',\n    mixed: 'Mixed breed / crossbreed',\n    rescue: 'Rescue / unknown background',\n  }[pedigreeRegister] || '—'\n  const breedingRightsLabel = isLimited ? '🔴 Not permitted — Limited Register'\n    : pedigreeRegister !== 'main' ? '⚪ Not confirmed'\n    : isMarkedNotEligible ? '🔴 Not permitted'\n    : isEligibilityUnconfirmed ? '⚪ Not confirmed'\n    : '🟢 Confirmed — breeding permitted'\n"""
if old_label not in data:
    raise SystemExit('api export pedigree label block not found')
data = data.replace(old_label, new_label, 1)
old_row = """    <tr><th>Pedigree Register</th><td colspan=\"3\" class=\"${isLimited || isMarkedNotEligible ? 'fail' : isNoPedigree || isNotRecorded || isEligibilityUnconfirmed ? 'warn' : 'ok'}\">${pedigreeLabel}</td></tr>\n"""
new_row = """    <tr><th>Pedigree registration</th><td colspan=\"3\" class=\"${isNotRecorded ? 'warn' : 'ok'}\">${pedigreeLabel}</td></tr>\n    <tr><th>Breeding rights</th><td colspan=\"3\" class=\"${isLimited || isMarkedNotEligible ? 'fail' : isEligibilityUnconfirmed || pedigreeRegister !== 'main' ? 'warn' : 'ok'}\">${breedingRightsLabel}</td></tr>\n"""
if old_row not in data:
    raise SystemExit('api export pedigree table row not found')
data = data.replace(old_row, new_row, 1)
p.write_text(data, encoding='utf-8')

# ---------------------------------------------------------------------------
# 5) Regression tests for the new explicit Breeding rights layer
# ---------------------------------------------------------------------------
replace_once(
    'src/lib/breedingCompliance.test.ts',
    "  nextPedigreeRegisterUpdate,\n  initialTransferPedigreeRegister,\n  pedigreeRegisterLabel,",
    "  nextPedigreeRegisterUpdate,\n  nextBreedingRightsUpdate,\n  initialTransferPedigreeRegister,\n  initialBreedingRightsValue,\n  pedigreeRegisterLabel,\n  breedingRightsLabel,",
)
replace_all_required('src/lib/breedingCompliance.test.ts', [
    ("expect(result.headline).toContain('not eligible')", "expect(result.headline).toContain('breeding rights do not permit')"),
    ("expect(result.headline).toContain('breeding eligibility not confirmed')", "expect(result.headline).toContain('breeding rights not confirmed')"),
    ("expect(result.headline).toBe('✓ Currently eligible to breed')", "expect(result.headline).toBe('✓ Actual breeding compliance checks passed')"),
])

test_append = r'''

describe('three-layer model — Pedigree registration → Breeding rights → Actual compliance', () => {
  it('maps stored eligibility into the breeder-facing Breeding rights layer', () => {
    expect(initialBreedingRightsValue({ pedigreeRegister: 'main' })).toBe('unknown')
    expect(initialBreedingRightsValue({ pedigreeRegister: 'main', breedingEligibility: 'eligible' })).toBe('eligible')
    expect(initialBreedingRightsValue({ pedigreeRegister: 'main', breedingEligibility: 'not_eligible' })).toBe('not_eligible')
  })

  it('labels rights without claiming actual compliance', () => {
    expect(breedingRightsLabel('eligible')).toBe('Breeding permitted')
    expect(breedingRightsLabel('not_eligible')).toBe('Not permitted')
    expect(breedingRightsLabel('unknown')).toBe('Not confirmed')
  })

  it('allows an explicit breeder decision only on Main Register', () => {
    expect(nextBreedingRightsUpdate('main', 'eligible')).toEqual({ breedingEligibility: 'eligible' })
    expect(nextBreedingRightsUpdate('main', 'not_eligible')).toEqual({ breedingEligibility: 'not_eligible' })
    expect(nextBreedingRightsUpdate('main', 'unknown')).toEqual({ breedingEligibility: 'unknown' })
  })

  it('Limited Register always forces Not permitted', () => {
    expect(nextBreedingRightsUpdate('limited', 'eligible')).toEqual({ breedingEligibility: 'not_eligible' })
  })

  it('non-authoritative registration states can never be promoted to permitted by the rights control', () => {
    expect(nextBreedingRightsUpdate(undefined, 'eligible')).toEqual({ breedingEligibility: 'unknown' })
    expect(nextBreedingRightsUpdate('not_recorded', 'eligible')).toEqual({ breedingEligibility: 'unknown' })
    expect(nextBreedingRightsUpdate('no_pedigree', 'eligible')).toEqual({ breedingEligibility: 'unknown' })
    expect(nextBreedingRightsUpdate('mixed', 'eligible')).toEqual({ breedingEligibility: 'unknown' })
    expect(nextBreedingRightsUpdate('rescue', 'eligible')).toEqual({ breedingEligibility: 'unknown' })
  })

  it('breeding rights confirmed still requires the separate compliance engine to pass', () => {
    const result = checkBreedingCompliance({
      dam: { name: 'Young Main Dog', breed: 'Labrador', dateOfBirth: new Date().toISOString().slice(0, 10), pedigreeRegister: 'main', breedingEligibility: 'eligible' },
      state: 'SA',
    })
    expect(result.overall).toBe('block')
    expect(result.headline).not.toContain('Actual breeding compliance checks passed')
  })

  it('an adult Main dog with confirmed rights can reach the distinct actual-compliance pass headline', () => {
    const result = checkBreedingCompliance({
      dam: { name: 'Adult Main Dog', breed: 'Poodle', dateOfBirth: '2020-01-01', pedigreeRegister: 'main', breedingEligibility: 'eligible' },
      state: 'SA',
    })
    expect(result.overall).not.toBe('block')
    expect(result.overall).not.toBe('warn')
    expect(result.headline).toBe('✓ Actual breeding compliance checks passed')
  })
})
'''
p = Path('src/lib/breedingCompliance.test.ts')
data = p.read_text(encoding='utf-8')
if "three-layer model — Pedigree registration" in data:
    raise SystemExit('three-layer tests already present')
p.write_text(data.rstrip() + test_append + '\n', encoding='utf-8')

print('Three-layer breeding rights patch applied successfully.')
