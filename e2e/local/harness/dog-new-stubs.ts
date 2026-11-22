// Synthetic stand-ins for the Firebase-backed modules DogNewPage imports, used only by the
// QA-SYNTH fixture-form harness. Nothing here talks to a real backend.
const h = () => (window as any).__harness

// ../lib/db
export async function getDogs() { return h().dogs }
export async function createDog(data: any) { h().created.push(data); const id = `harness-dog-${h().created.length}`; h().dogs.push({ id, ...data, status: 'active' }); return id }
export async function addVaccineRecord() { h().extraWrites.push('vaccine') }
export async function addHealthTest() { h().extraWrites.push('health') }

// ../hooks/useAuth
const user = { uid: 'harness-synthetic-uid', email: 'harness@example.invalid', emailVerified: true, getIdToken: async () => 'synthetic-token' }
export function useAuth() { return { user, profile: h().profile } }

// ../lib/firebase
export const auth = { currentUser: user }
