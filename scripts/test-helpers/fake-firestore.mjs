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
        colMap(collectionName).set(id, opts?.merge ? { ...existing, ...data } : { ...data })
      },
      async update(data) {
        const existing = colMap(collectionName).get(id) || {}
        colMap(collectionName).set(id, { ...existing, ...data })
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

  async function runTransaction(fn) {
    const tx = {
      async get(refOrQuery) {
        return refOrQuery.get()
      },
      set(ref, data, opts) {
        const existing = colMap(ref.collectionName).get(ref.id) || {}
        colMap(ref.collectionName).set(ref.id, opts?.merge ? { ...existing, ...data } : { ...data })
      },
      update(ref, data) {
        const existing = colMap(ref.collectionName).get(ref.id) || {}
        colMap(ref.collectionName).set(ref.id, { ...existing, ...data })
      },
    }
    return fn(tx)
  }

  return {
    collection,
    runTransaction,
    _dump(name) {
      return Object.fromEntries(colMap(name).entries())
    },
  }
}
