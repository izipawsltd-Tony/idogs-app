// Synthetic stand-ins for Firebase-backed modules, used only by the
// DOC-MOBILE-01 layout harness. Data comes from window.__harness (set by the
// spec), so nothing here talks to a real backend.
const h = () => (window as any).__harness

// ../lib/db
export async function getAllDocumentsForUser() { return h().docs }
export async function getDogs() { return h().dogs }
export async function deleteDocument(id: string) { h().deleted.push(id) }
export async function updateDocument(id: string, name: string) { h().updated.push([id, name]) }

// ../hooks/useAuth
const user = { uid: 'harness-synthetic-uid', getIdToken: async () => 'synthetic-token' }
export function useAuth() { return { user } }

// ../lib/firebase
export const auth = { currentUser: user }
