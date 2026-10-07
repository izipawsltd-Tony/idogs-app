export function buildTransferEmailMessage(params: {
  breederName: string
  dogName: string
  breed: string
}): string {
  return `${params.breederName} has transferred ownership of ${params.dogName} (${params.breed}) to you.

Sign in to iDogs using this email address to access your dog's profile, health records, documents and digital passport.

New to iDogs? Create your free account using this same email address and your dog will appear automatically.`
}

export const TRANSFER_EMAIL_ACTION_URL = 'https://idogs.com.au/login'
export const TRANSFER_EMAIL_ACTION_LABEL = 'Access your dog →'
