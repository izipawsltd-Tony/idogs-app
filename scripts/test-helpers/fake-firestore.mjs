// scripts/test-helpers/fake-firestore.mjs — minimal in-memory,
// firebase-admin-shaped Firestore fake for pure-logic unit tests (no live
// emulator required). Exercises the REAL exported functions from
// api/_lib/dog-cap.js, api/_lib/litter-quota.js, and
// api/_lib/webhook-handler.js against this fake, rather than
// reimplementing their logic — only the Firestore I/O is faked.
//
// Deliberately NOT a full Firestore query engine: equality-only where()
// (all any of these modules ever use, matching this repo's own
// no-orderBy/composite-index convention — see CLAUDE.md), no real
// transactional isolation/retry (writes apply immediately; fine for the
// single-threaded sequential scenarios these tests exercise, not a
// concurrency simulator). Mirrors firebase-admin's `snap.exists` as a
// boolean property (not a function, unlike some client SDKs) since every
// module under test relies on that exact shape.
//
// Codex fix-round: api/_lib/dog-cap.js's reconciliation functions now
// write FieldValue.delete() sentinels (clearing restrictionReason on
// reactivation) — a plain object spread would store the sentinel object
// itself as the field's value instead of actually deleting the key. This
// resolves any such sentinel via FieldValue's own isEqual() (the
// documented, SDK-supported way to identify one), same as real Firestore.

import { FieldValue } from 'firebase-admin/firestore'

const DELETE_SENTINEL = FieldValue.delete()

function isDeleteSentinel(value) {
  return !!value && typeof value.isEqual === 'function' && value.isEqual(DELETE_SENTINEL)
}

function applyFieldValues(existing, data) {
  const result = { ...existing }
  for (const [key, value] of Object.entries(data)) {
    if (isDeleteSentinel(value)) delete result[key]
    else result[key] = value
  }
  return result
}

let autoId = 0

export function createFakeFirestore(seedByCollection = {}) {
  const store = new Map() // Map<collection, Map<id, data>>
  for (const [col, docs] of Object.entries(seedByCollection)) {
    const m = new Map()
    for (const [id, data] of Object.entries(docs)) m.set(id, { ...data })
    store.set(col, m)
  }

  function colMap(name) {
    if (!store.has(name)) store.set(name, new Map())
    return store.get(name)
  }

  function makeDocRef(collectionName, id) {
    return {
      id,
      collectionName,
      async get() {
        const data = colMap(collectionName).get(id)
        return { exists: data !== undefined, id, ref: this, data: () => (data ? { ...data } : undefined) }
      },
      async set(data, opts) {
        const existing = colMap(collectionName).get(id) || {}
        colMap(collectionName).set(id, opts?.merge ? applyFieldValues(existing, data) : { ...data })
      },
      async update(data) {
        const existing = colMap(collectionName).get(id) || {}
        colMap(collectionName).set(id, applyFieldValues(existing, data))
      },
    }
  }

  function makeQueryRef(collectionName, filters) {
    return {
      collectionName,
      where(field, op, value) {
        if (op !== '==') throw new Error('fake-firestore: only == is supported')
        return makeQueryRef(collectionName, [...filters, { field, value }])
      },
      async get() {
        const docs = [...colMap(collectionName).entries()]
          .filter(([, data]) => filters.every(f => data[f.field] === f.value))
          .map(([id, data]) => ({ id, ref: makeDocRef(collectionName, id), data: () => ({ ...data }) }))
        return { docs, empty: docs.length === 0 }
      },
    }
  }

  function collection(name) {
    return {
      doc(id) {
        return makeDocRef(name, id || `auto-${++autoId}`)
      },
      where(field, op, value) {
        return makeQueryRef(name, []).where(field, op, value)
      },
    }
  }

  // Serializes every transaction against this fake db instance — a
  // conservative over-approximation of real Firestore's per-document
  // transaction contention/retry semantics, but correct for what the
  // concurrency tests (Codex H3 — atomic quota reservation) need to
  // prove: a second concurrent transaction never observes state from
  // before an overlapping first transaction's write has landed. Chained
  // on `.then(ok, ok)` so a thrown transaction body still lets queued
  // transactions run afterward, instead of stalling the queue forever.
  let transactionQueue = Promise.resolve()

  async function runTransaction(fn) {
    const run = async () => {
      const tx = {
        async get(refOrQuery) {
          return refOrQuery.get()
        },
        set(ref, data, opts) {
          const existing = colMap(ref.collectionName).get(ref.id) || {}
          colMap(ref.collectionName).set(ref.id, opts?.merge ? applyFieldValues(existing, data) : { ...data })
        },
        update(ref, data) {
          const existing = colMap(ref.collectionName).get(ref.id) || {}
          colMap(ref.collectionName).set(ref.id, applyFieldValues(existing, data))
        },
      }
      return fn(tx)
    }
    const settle = () => undefined
    const result = transactionQueue.then(run, run)
    transactionQueue = result.then(settle, settle)
    return result
  }

  return {
    collection,
    runTransaction,
    _dump(name) {
      return Object.fromEntries(colMap(name).entries())
    },
  }
}
