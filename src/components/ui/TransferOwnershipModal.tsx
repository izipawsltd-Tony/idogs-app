import { useState } from 'react'
import { sendTransferEmail } from '../../lib/email'
import { transferDogOwnership } from '../../lib/db'

interface TransferOwnershipModalProps {
  dog: {
    id: string
    name: string
    breed: string
    passportId: string
  }
  breederName: string
  onClose: () => void
  onSuccess: () => void
}

export default function TransferOwnershipModal({
  dog,
  breederName,
  onClose,
  onSuccess,
}: TransferOwnershipModalProps) {
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const passportUrl = `https://idogs.com.au/p/${dog.passportId}`

  async function handleTransfer() {
    if (!buyerName.trim() || !buyerEmail.trim()) {
      setError('Please fill in buyer name and email.')
      return
    }
    if (!confirm) {
      setError('Please confirm the transfer.')
      return
    }

    setLoading(true)
    setError('')

    try {
      // 1. Update Firestore
      await transferDogOwnership(dog.id, {
        buyerName: buyerName.trim(),
        buyerEmail: buyerEmail.trim().toLowerCase(),
        transferredAt: new Date().toISOString(),
      })

      // 2. Send email to buyer
      await sendTransferEmail({
        buyerEmail: buyerEmail.trim(),
        buyerName: buyerName.trim(),
        dogName: dog.name,
        breed: dog.breed,
        breederName,
        passportUrl,
      })

      onSuccess()
    } catch (err) {
      console.error(err)
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Transfer Ownership</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="transfer-dog-info">
            <span className="transfer-dog-icon">🐾</span>
            <div>
              <div className="transfer-dog-name">{dog.name}</div>
              <div className="transfer-dog-breed">{dog.breed}</div>
            </div>
          </div>

          <p className="transfer-warning">
            Once transferred, the new owner will have full control of this dog's profile.
            You will be able to view it in read-only mode.
          </p>

          <div className="form-group">
            <label className="form-label">Buyer's Full Name</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Jane Smith"
              value={buyerName}
              onChange={e => setBuyerName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Buyer's Email Address</label>
            <input
              className="form-input"
              type="email"
              placeholder="e.g. jane@example.com"
              value={buyerEmail}
              onChange={e => setBuyerEmail(e.target.value)}
            />
            <p className="form-hint">
              They'll receive an email with the passport link and instructions to create their account.
            </p>
          </div>

          <label className="transfer-confirm-label">
            <input
              type="checkbox"
              checked={confirm}
              onChange={e => setConfirm(e.target.checked)}
            />
            <span>I confirm I want to transfer <strong>{dog.name}</strong> to this buyer. This action cannot be undone.</span>
          </label>

          {error && <p className="form-error">{error}</p>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn-danger"
            onClick={handleTransfer}
            disabled={loading || !confirm}
          >
            {loading ? 'Transferring…' : 'Transfer Ownership'}
          </button>
        </div>
      </div>
    </div>
  )
}
