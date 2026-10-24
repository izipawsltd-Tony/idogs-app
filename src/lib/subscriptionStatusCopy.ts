export interface SubscriptionStatusDetails {
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  trialEnd?: string | null
  promotionStatus?: 'confirmed' | 'not_confirmed'
}

// Read-only provider status. A trial date alone never confirms campaign enrolment.
export function subscriptionStatusCopy(subscription: SubscriptionStatusDetails) {
  const ending = subscription.cancelAtPeriodEnd
  return {
    label: ending ? 'Access scheduled to end' : subscription.status === 'trialing' ? 'Trial ends' : 'Next renewal',
    date: subscription.status === 'trialing'
      ? subscription.trialEnd || subscription.currentPeriodEnd
      : subscription.currentPeriodEnd,
    promotion: subscription.promotionStatus === 'confirmed'
      ? 'Your promotional Plus access is confirmed for this subscription.'
      : subscription.promotionStatus === 'not_confirmed'
        ? 'Promotional access is not confirmed for this subscription. Your existing subscription terms still apply.'
        : null,
  }
}
