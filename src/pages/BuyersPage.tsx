// src/pages/BuyersPage.tsx
// M7 #5 — Buyers derived view.
// Buyers are DERIVED, never stored: we read tenant-scoped dogs via getDogs()
// and group client-side. No Buyers collection, no getDogsByBuyerEmail (not
// tenant-scoped), no orderBy (JS sort only).
//
// VERIFIED IN CLAUDE CODE (index.css / Dog type / App.tsx routes actually read):
//   1. Flat Dog fields exist: buyerName/buyerEmail/buyerPhone,
//      reservedForName/reservedForEmail/reservedForPhone,
//      transferredAt, reservedAt, depositStatus, depositAmount, id, name.
//   2. index.css only defines badge-green/gold/red/gray/active/closed — there
//      is no badge-success/badge-warning/badge-muted. Mapped to what the app
//      already uses elsewhere for the same states: badge-gray for
//      "Transferred" (matches DogDetailPage.tsx/DogListPage.tsx) and an
//      inline var(--warning) tint for "Reserved" (matches the Sale &
//      availability panel in DogDetailPage.tsx). Single source: see
//      relationshipBadge() below.
//   3. Dog-detail route is /app/dogs/:dogId (App.tsx) — rows link to
//      /app/dogs/{id}, unchanged from the pasted draft.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Dog } from '../types';
import { getDogs } from '../lib/db';

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
// transferredAt present => Transferred (prefer buyer* contact).
// otherwise            => Reserved    (prefer reservedFor* contact).
// Returns null when the dog has no buyer identity at all (skip it).
function resolveIdentity(
  dog: Dog,
): { key: string; email: string; phone: string; name: string; relationship: Relationship } | null {
  const transferred = !!dog.transferredAt;
  const relationship: Relationship = transferred ? 'transferred' : 'reserved';

  const email = transferred
    ? normEmail(dog.buyerEmail) || normEmail(dog.reservedForEmail)
    : normEmail(dog.reservedForEmail) || normEmail(dog.buyerEmail);

  const phone = transferred
    ? normPhone(dog.buyerPhone) || normPhone(dog.reservedForPhone)
    : normPhone(dog.reservedForPhone) || normPhone(dog.buyerPhone);

  const name = (
    transferred
      ? dog.buyerName || dog.reservedForName
      : dog.reservedForName || dog.buyerName
  ) || '';

  const key = email || phone; // email is the primary key; phone is fallback
  if (!key) return null;

  return { key, email, phone, name: name.trim(), relationship };
}

function buildBuyers(dogs: Dog[]): Buyer[] {
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

// --- component -------------------------------------------------------------

export default function BuyersPage() {
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getDogs();
        if (active) setDogs(data);
      } catch {
        if (active) setError('Could not load buyers. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const buyers = useMemo(() => buildBuyers(dogs), [dogs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return buyers;
    const qDigits = q.replace(/\D/g, '');
    return buyers.filter((b) => {
      if (b.name.toLowerCase().includes(q)) return true;
      if (b.email.includes(q)) return true;
      if (qDigits && b.phone.includes(qDigits)) return true;
      return b.dogs.some((d) => (d.dog.name || '').toLowerCase().includes(q));
    });
  }, [buyers, search]);

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--dark)', margin: 0 }}>Buyers</h1>
        <span className="badge badge-gray">{buyers.length}</span>
      </div>
      <p style={{ marginTop: '0.25rem', color: 'var(--mid)' }}>
        Derived from reservations and transfers. Nothing here is stored separately.
      </p>

      {!loading && !error && buyers.length > 0 && (
        <div style={{ margin: '1rem 0' }}>
          <input
            className="form-input"
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
        </div>
      )}

      {!loading && !error && buyers.length === 0 && (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--mid)' }}>
            No buyers yet. Buyers appear here once you reserve or transfer a dog.
          </p>
        </div>
      )}

      {!loading && !error && buyers.length > 0 && filtered.length === 0 && (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--mid)' }}>No buyers match that search.</p>
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
                  {b.reservedCount > 0 && (
                    <span className="badge" style={{ background: 'var(--gray-100)', color: 'var(--warning)' }}>{b.reservedCount} reserved</span>
                  )}
                  {b.transferredCount > 0 && (
                    <span className="badge badge-gray">{b.transferredCount} transferred</span>
                  )}
                </div>
              </div>

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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        {activity > 0 && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--mid)' }}>
                            {fmtDate(activity)}
                          </span>
                        )}
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
