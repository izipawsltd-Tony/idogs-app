import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Dog } from '../types';
import { getDogs } from '../lib/db';
import BuyerForm from '../components/ui/BuyerForm';
import { buyerRequest, buyerStageLabels, type BuyerContact, type BuyerStage } from '../lib/buyers';
import { useAuth } from '../hooks/useAuth';
import { useRequestGuard } from '../hooks/useRequestGuard';

type Relationship = 'reserved' | 'transferred';

interface BuyerDog {
  dog: Dog;
  relationship: Relationship;
  activity: number; // epoch ms, 0 when unknown
}

interface Buyer {
  key: string;
  name: string;
  email: string;
  phone: string;
  dogs: BuyerDog[];
  contact?: BuyerContact;
  reservedCount: number;
  transferredCount: number;
  lastActivity: number;
}

// --- helpers ---------------------------------------------------------------

function normEmail(v?: string | null): string {
  return (v || '').trim().toLowerCase();
}

function normPhone(v?: string | null): string {
  return (v || '').replace(/\D/g, '');
}

// Defensive date coercion: ISO strings, epoch ms/seconds, or Firestore
// Timestamp-like objects. Returns 0 when unparseable so sorts stay stable.
function toTime(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof v === 'object') {
    const obj = v as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') return obj.toDate().getTime();
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  }
  return 0;
}

function fmtDate(ms: number): string {
  return ms ? new Date(ms).toLocaleDateString() : '';
}

// Single source for relationship → badge styling. index.css has no
// badge-success/badge-warning, so "transferred" reuses the app's existing
// badge-gray convention and "reserved" reuses the inline var(--warning)
// tint already used by the Sale & availability panel.
function relationshipBadge(rel: Relationship): { className: string; style?: React.CSSProperties } {
  if (rel === 'transferred') return { className: 'badge badge-gray' };
  return { className: 'badge', style: { background: 'var(--gray-100)', color: 'var(--warning)' } };
}

// Resolve one dog to a single buyer identity + relationship.
// transferredAt present => Transferred (buyer* contact only).
// otherwise            => Reserved    (reservedFor* contact only).
// Returns null when the dog has no buyer identity at all (skip it).
//
// M7_DATA_MODEL.md §1's locked rule is explicit: "Reservation writes
// reservedFor* ONLY. Sale/transfer writes buyer* ONLY... this keeps
// prospective buyer (reserved) and completed buyer (sold/transferred)
// cleanly separable so Reports (§4.4) and Buyers (§5) can't confuse the
// two." An earlier version of this function fell back to the OTHER
// field set when the primary one was empty (e.g. transferred but
// buyerEmail blank => fall back to reservedForEmail) — that's exactly
// the confusion the locked rule forbids: a puppy can legitimately be
// reserved by one person and sold to a different one, and falling back
// would misattribute the sale to the original reserver instead of
// correctly reporting "no contact on file for this transfer" (which
// falls through to `key === null` below, listing the dog individually,
// per §5's own documented behaviour for un-groupable contacts).
function resolveIdentity(
  dog: Dog,
): { key: string; email: string; phone: string; name: string; relationship: Relationship } | null {
  const transferred = !!dog.transferredAt;
  const relationship: Relationship = transferred ? 'transferred' : 'reserved';

  const email = transferred ? normEmail(dog.buyerEmail) : normEmail(dog.reservedForEmail);
  const phone = transferred ? normPhone(dog.buyerPhone) : normPhone(dog.reservedForPhone);
  const name = (transferred ? dog.buyerName : dog.reservedForName) || '';

  const key = email || phone; // email is the primary key; phone is fallback
  if (!key) return null;

  return { key, email, phone, name: name.trim(), relationship };
}

export function buildBuyers(dogs: Dog[], contacts: BuyerContact[] = []): Buyer[] {
  const map = new Map<string, Buyer>();

  for (const dog of dogs) {
    const id = resolveIdentity(dog);
    if (!id) continue;

    const activity =
      id.relationship === 'transferred' ? toTime(dog.transferredAt) : toTime(dog.reservedAt);

    let buyer = map.get(id.key);
    if (!buyer) {
      buyer = {
        key: id.key,
        name: id.name,
        email: id.email,
        phone: id.phone,
        dogs: [],
        reservedCount: 0,
        transferredCount: 0,
        lastActivity: 0,
      };
      map.set(id.key, buyer);
    }

    // Backfill contact details as later dogs reveal them.
    if (!buyer.name && id.name) buyer.name = id.name;
    if (!buyer.email && id.email) buyer.email = id.email;
    if (!buyer.phone && id.phone) buyer.phone = id.phone;

    buyer.dogs.push({ dog, relationship: id.relationship, activity });
    if (id.relationship === 'transferred') buyer.transferredCount += 1;
    else buyer.reservedCount += 1;
    if (activity > buyer.lastActivity) buyer.lastActivity = activity;
  }

  for (const contact of contacts) {
    let buyer = map.get(contact.email);
    if (!buyer) {
      buyer = { key: contact.email, name: contact.name, email: contact.email, phone: contact.phone, dogs: [], reservedCount: 0, transferredCount: 0, lastActivity: 0 };
      map.set(contact.email, buyer);
    }
    buyer.contact = contact;
    buyer.name = contact.name; buyer.phone = contact.phone;
  }
  const buyers = Array.from(map.values());
  for (const b of buyers) {
    b.dogs.sort((a, c) => c.activity - a.activity);
  }
  buyers.sort((a, b) => {
    if (b.lastActivity !== a.lastActivity) return b.lastActivity - a.lastActivity;
    const an = a.name || a.email || a.phone;
    const bn = b.name || b.email || b.phone;
    return an.localeCompare(bn);
  });
  return buyers;
}

export function buyerStages(buyer: Buyer): BuyerStage[] {
  const stages = new Set<BuyerStage>();
  for (const { dog, relationship } of buyer.dogs) stages.add(relationship === 'transferred' ? 'transferred' : dog.depositStatus === 'received' ? 'deposit' : 'reserved');
  // Canonical puppy state wins over a previously recorded CRM stage.
  if (buyer.contact && (!['reserved', 'deposit'].includes(buyer.contact.status) || !buyer.dogs.some(d => d.dog.id === buyer.contact?.dogId))) stages.add(buyer.contact.status);
  return [...stages];
}

// --- component -------------------------------------------------------------

export default function BuyersPage() {
  const { user } = useAuth();
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [contacts, setContacts] = useState<BuyerContact[]>([]);
  const [editing, setEditing] = useState<BuyerContact | null | undefined>(undefined);
  const [stage, setStage] = useState('all');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [reloadToken, setReloadToken] = useState(0);
  // Codex round 15: this page previously had NO useAuth/user dependency
  // at all — its load effect only re-ran on reloadToken, so switching
  // accounts (logout + login as someone else, without a full page
  // remount) would leave the PREVIOUS account's buyers on screen
  // indefinitely. beginRequest()'s isCurrent() guard additionally stops
  // a stale response (from a superseded account OR a superseded retry)
  // from committing after a newer request has already started.
  const { beginRequest } = useRequestGuard(user?.uid);

  useEffect(() => {
    // Clear the previous account's buyers immediately on an account
    // switch — a stale buyer list from a former account must never
    // linger into the new one's view.
    setDogs([]); setContacts([]); setEditing(undefined);
    setError('');
    if (!user) { setLoading(false); return; }
    const req = beginRequest();
    setLoading(true);
    (async () => {
      try {
        const [data, result] = await Promise.all([getDogs(), buyerRequest({ action: 'list' })]);
        if (!req.isCurrent()) return;
        setDogs(data); setContacts(result.buyers);
      } catch {
        if (!req.isCurrent()) return;
        setError('Could not load buyers. Please try again.');
      } finally {
        if (req.isCurrent()) setLoading(false);
      }
    })();
  }, [user?.uid, reloadToken]);

  const buyers = useMemo(() => buildBuyers(dogs, contacts), [dogs, contacts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const staged = buyers.filter(b => stage === 'all' || buyerStages(b).includes(stage as BuyerStage));
    if (!q) return staged;
    const qDigits = q.replace(/\D/g, '');
    return staged.filter((b) => {
      if (b.name.toLowerCase().includes(q)) return true;
      if (b.email.includes(q)) return true;
      if (qDigits && b.phone.replace(/\D/g, '').includes(qDigits)) return true;
      return b.dogs.some((d) => (d.dog.name || '').toLowerCase().includes(q));
    });
  }, [buyers, search, stage]);

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 32px)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--dark)', margin: 0 }}>Buyers</h1>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setNotice(''); }} disabled={loading || !!error || editing !== undefined}>＋ Add buyer</button>
        {/* Codex round 15: hide the count badge entirely on a load
            failure — showing 0 (or a stale prior count) implies a real,
            current answer that we don't actually have. */}
        {!error && <span className="badge badge-gray">{buyers.length}</span>}
      </div>
      <p style={{ marginTop: '0.25rem', color: 'var(--mid)' }}>
        Manage enquiries, waiting lists, deposits and past buyers in one place.
      </p>

      {notice && <p role="status">{notice}</p>}
      {editing !== undefined && <BuyerForm key={editing?.id || 'new'} contact={editing || undefined} dogs={dogs.filter(d => d.status !== 'transferred' && (d.currentOwnerId || d.tenantId) === user?.uid && d.tenantId === user?.uid)} cancel={() => setEditing(undefined)} saved={() => { setEditing(undefined); setStage('all'); setSearch(''); setReloadToken(t => t + 1); setNotice('Buyer saved.'); }} />}
      {!loading && !error && buyers.length > 0 && (
        <div style={{ margin: '1rem 0', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <label>Filter by status<select className="form-input" value={stage} onChange={e => setStage(e.target.value)}><option value="all">All buyers</option>{Object.entries(buyerStageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <input
            className="form-input"
            aria-label="Search buyers"
            type="text"
            value={search}
            placeholder="Search buyers, emails, or dogs"
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: '24rem' }}
          />
        </div>
      )}

      {loading && (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--mid)' }}>Loading buyers...</p>
        </div>
      )}

      {!loading && error && (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => setReloadToken(t => t + 1)}>Retry</button>
        </div>
      )}

      {!loading && !error && buyers.length === 0 && (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--mid)' }}>
            No buyers yet. Choose Add buyer to start your waiting list or record a deposit.
          </p>
        </div>
      )}

      {!loading && !error && buyers.length > 0 && filtered.length === 0 && (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--mid)' }}>No buyers match these filters.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
          {filtered.map((b) => (
            <div key={b.key} className="card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{b.name || b.email || b.phone}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--mid)' }}>
                    {b.email}
                    {b.email && b.phone ? ' · ' : ''}
                    {b.phone}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {buyerStages(b).map(value => <span key={value} className={value === 'deposit' ? 'badge badge-green' : 'badge badge-gray'}>{buyerStageLabels[value]}</span>)}
                  <button className="btn btn-secondary btn-sm" disabled={editing !== undefined} onClick={() => { setNotice(''); setEditing(b.contact ? (b.dogs.some(d => d.dog.id === b.contact?.dogId && d.relationship === 'transferred') ? { ...b.contact, status: 'transferred', dogId: '' } : b.contact) : { id: '', name: b.name, email: b.email, phone: b.phone, notes: '', status: b.transferredCount ? 'transferred' : b.dogs.some(d => d.dog.depositStatus === 'received') ? 'deposit' : 'reserved', dogId: b.dogs.find(d => d.relationship === 'reserved')?.dog.id || '', amount: b.dogs.find(d => d.relationship === 'reserved')?.dog.depositAmount ?? null }); }}>Edit buyer</button>
                  {b.reservedCount > 0 && (
                    <span className="badge" style={{ background: 'var(--gray-100)', color: 'var(--warning)' }}>{b.reservedCount} reserved</span>
                  )}
                  {b.transferredCount > 0 && (
                    <span className="badge badge-gray">{b.transferredCount} transferred</span>
                  )}
                </div>
              </div>

              {b.contact?.notes && <p style={{ whiteSpace: 'pre-wrap', color: 'var(--mid)' }}><strong>Private notes: </strong>{b.contact.notes}</p>}
              {b.contact?.dogId && !b.dogs.some(d => d.dog.id === b.contact?.dogId) && <p><Link to={`/app/dogs/${b.contact.dogId}`}>View linked puppy</Link></p>}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                  marginTop: '0.75rem',
                }}
              >
                {b.dogs.map(({ dog, relationship, activity }) => {
                  const badge = relationshipBadge(relationship);
                  return (
                    <div
                      key={dog.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem',
                        background: 'var(--gray-100)',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <Link to={`/app/dogs/${dog.id}`} style={{ fontWeight: 500 }}>
                          {dog.name || 'Unnamed dog'}
                        </Link>
                        {relationship === 'reserved' && dog.depositStatus && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--mid)' }}>
                            Deposit: {dog.depositStatus}
                            {dog.depositAmount ? ` (${dog.depositAmount})` : ''}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {activity > 0 && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--mid)' }}>
                            {fmtDate(activity)}
                          </span>
                        )}
                        <Link className="btn btn-sm btn-secondary" to={`/app/finance?dogId=${dog.id}`}>
                          Invoice / Receipt
                        </Link>
                        <span className={badge.className} style={badge.style}>
                          {relationship === 'transferred' ? 'Transferred' : 'Reserved'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
