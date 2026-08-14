import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { verifySuperAdmin } from './_auth.js'
import { confirmPersistedSupportMessage, exactFields, plainText, safeId, toIso } from '../support/_shared.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  const actor = await verifySuperAdmin(req, res)
  if (!actor) return
  try {
    const id = safeId(req.query.id)
    if (!id) return res.status(404).json({ error: 'Conversation not found' })
    const db = getFirestore()
    const ref = db.collection('supportConversations').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return res.status(404).json({ error: 'Conversation not found' })
    const conversation = snap.data()
    if (req.method === 'GET') {
      const messagesSnap = await db.collection('supportMessages').where('conversationId', '==', id).limit(200).get()
      if (conversation.adminUnreadCount) await ref.update({ adminUnreadCount: 0 })
      return res.status(200).json({ conversation: { id, ...conversation }, messages: messagesSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), createdAt: toIso(doc.data().createdAt) })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    exactFields(req.body, ['action', 'message', 'reason', 'confirmed'])
    const action = req.body.action
    if (!['reply', 'assign', 'waiting_on_user', 'close', 'reopen'].includes(action)) return res.status(400).json({ error: 'Invalid action' })
    if (['close', 'reopen'].includes(action) && (req.body.confirmed !== true || typeof req.body.reason !== 'string' || req.body.reason.trim().length < 5)) return res.status(400).json({ error: 'Confirmation and reason of at least 5 characters required' })
    const before = { status: conversation.status, assigneeUid: conversation.assigneeUid || null }
    const update = { updatedAt: FieldValue.serverTimestamp() }
    let message = null
    let messageRef = null
    if (action === 'reply') {
      message = plainText(req.body.message)
      if (conversation.status === 'closed') return res.status(409).json({ error: 'Reopen before replying' })
      update.status = 'waiting_on_user'
      update.lastMessageAt = FieldValue.serverTimestamp()
      update.lastMessagePreview = 'Support replied'
      update.userUnreadCount = Number(conversation.userUnreadCount || 0) + 1
    }
    if (action === 'assign') {
      update.assigneeUid = actor.uid
      update.assigneeEmail = actor.email || null
      if (conversation.status === 'new') update.status = 'open'
    }
    if (action === 'waiting_on_user') update.status = 'waiting_on_user'
    if (action === 'close') update.status = 'closed'
    if (action === 'reopen') update.status = 'open'
    const after = { status: update.status || conversation.status, assigneeUid: update.assigneeUid ?? conversation.assigneeUid ?? null }
    const batch = db.batch()
    batch.update(ref, update)
    if (message) {
      messageRef = db.collection('supportMessages').doc()
      batch.set(messageRef, { conversationId: id, senderUid: actor.uid, senderType: 'admin', text: message, createdAt: FieldValue.serverTimestamp() })
    }
    batch.set(db.collection('auditLogs').doc(), { action: `super_admin_support_${action}`, details: 'Super Admin support operation', reason: req.body.reason || null, performedBy: actor.uid, performedByEmail: actor.email || null, targetUserId: conversation.ownerUid || null, targetUserEmail: conversation.ownerEmail || null, targetOrganisationId: conversation.organisationId || null, targetOrganisationName: conversation.organisationName || null, beforeState: before, afterState: after, createdAt: FieldValue.serverTimestamp() })
    await batch.commit()
    const persisted = messageRef ? await confirmPersistedSupportMessage(db, ref, messageRef, 'waiting_on_user') : null
    return res.status(200).json({ success: true, ...(persisted || {}) })
  } catch (error) {
    return res.status(error?.status || 500).json({ error: error?.status ? error.message : 'Support operation failed' })
  }
}
