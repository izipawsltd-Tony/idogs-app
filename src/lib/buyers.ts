import { auth } from './firebase'
export type BuyerStage = 'enquiry' | 'waiting' | 'reserved' | 'deposit' | 'transferred' | 'closed'
export const buyerStageLabels: Record<BuyerStage, string> = { enquiry: 'Enquiry', waiting: 'Waiting list', reserved: 'Reserved', deposit: 'Deposit received', transferred: 'Transferred', closed: 'Closed' }
export interface BuyerContact { id: string; name: string; email: string; phone: string; notes: string; status: BuyerStage; dogId: string; amount: number | null }
export async function buyerRequest(body: Record<string, unknown>): Promise<{ buyers: BuyerContact[]; buyer: BuyerContact }> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Please sign in again.')
  const response = await fetch('/api/buyers', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not save buyer. Please try again.')
  return data
}
