type MetaFbq = (...args: unknown[]) => void

type WindowWithFbq = Window & {
  fbq?: MetaFbq
}

export function trackCompleteRegistration(accountType: 'breeder' | 'owner') {
  const fbq = (window as WindowWithFbq).fbq
  if (typeof fbq !== 'function') return

  fbq('track', 'CompleteRegistration', {
    content_name: accountType,
  })
}
