import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const useAuth = read('../hooks/useAuth.tsx')
const login = read('../pages/LoginPage.tsx')
const signup = read('../pages/SignupPage.tsx')
const verify = read('../pages/VerifyEmailPage.tsx')
const appLayout = read('../components/layout/AppLayout.tsx')

const sendEmailVerification = vi.hoisted(() => vi.fn())
vi.mock('firebase/auth', () => ({ sendEmailVerification }))
import { sendInitialVerification, verificationDelivery } from './signupVerification'

afterEach(() => { vi.unstubAllGlobals(); sendEmailVerification.mockReset() })

function stubBrowser(origin: string) {
  const store = new Map<string, string>()
  vi.stubGlobal('window', { location: { origin } })
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
}

describe('iOS sign-up never loses an account to an email failure', () => {
  it('creates the profile before sending verification, and rollback only covers profile failure', () => {
    const body = useAuth.slice(useAuth.indexOf('async function signup'), useAuth.indexOf('async function login'))
    expect(body.indexOf('createUserProfile(')).toBeGreaterThan(-1)
    expect(body.indexOf('sendInitialVerification(newUser)')).toBeGreaterThan(body.indexOf('newUser.delete()'))
    expect(body).not.toContain('await sendEmailVerification(newUser)')
  })

  it('a throttled first email is remembered as failed instead of throwing', async () => {
    stubBrowser('capacitor://localhost')
    sendEmailVerification.mockRejectedValue(Object.assign(new Error('Firebase: Error (auth/too-many-requests).'), { code: 'auth/too-many-requests' }))
    await expect(sendInitialVerification({ uid: 'u1', email: 'a@b.co', emailVerified: false } as never)).resolves.toBeUndefined()
    expect(verificationDelivery('u1')?.status).toBe('failed')
  })

  it('native app sends the plain verification email (no capacitor:// continue URL); web keeps its https continue URL', async () => {
    stubBrowser('capacitor://localhost')
    sendEmailVerification.mockResolvedValue(undefined)
    await sendInitialVerification({ uid: 'u2', email: 'a@b.co', emailVerified: false } as never)
    expect(sendEmailVerification.mock.calls[0][1]).toBeUndefined()
    stubBrowser('https://idogs.com.au')
    await sendInitialVerification({ uid: 'u3', email: 'a@b.co', emailVerified: false } as never)
    expect(sendEmailVerification.mock.calls[1][1]).toEqual({ url: 'https://idogs.com.au/verify-email' })
  })
})

describe('iOS auth screens match idogs.com.au', () => {
  it('use the web AuthLayout, Email / Mobile number tabs and copy', () => {
    for (const page of [login, signup]) {
      expect(page).toContain("import AuthLayout from '../components/ui/AuthLayout'")
      expect(page).toContain('idogs-auth-tabs')
      expect(page).toContain('>Mobile number</button>')
    }
    expect(login).toContain('title="Welcome back"')
    expect(signup).toContain("'Welcome to iDogs'")
    expect(signup).toContain('<SignupConsent')
    expect(signup).toContain("role: 'owner'")
    expect(signup).toContain('termsAccepted: true')
  })

  it('do not offer web-only sign-in methods that cannot work inside the app', () => {
    for (const page of [login, signup]) {
      expect(page).not.toMatch(/SocialSignIn|PasswordlessSignIn|socialLogin|trackCompletedRegistration/)
    }
  })
})

describe('owner QA on 1.0 (167)', () => {
  it('sets the display name before the verification email so it greets the user by name', () => {
    const body = useAuth.slice(useAuth.indexOf('async function signup'), useAuth.indexOf('async function login'))
    expect(body.indexOf('updateProfile(newUser, { displayName })')).toBeGreaterThan(-1)
    expect(body.indexOf('updateProfile(newUser, { displayName })')).toBeLessThan(body.indexOf('sendInitialVerification(newUser)'))
  })
  it('Verify Email uses the official iDogs logo', () => {
    expect(verify).toContain('/01_idogs_primary_horizontal_transparent.png')
    expect(verify).not.toMatch(/fontSize: 20 }}>🐾<\/div>/)
  })
  it('signing out in the app returns to the Welcome back screen', () => {
    expect(appLayout).toContain("navigate(isNativeApp() ? '/login' : '/')")
  })
})

describe('native status-bar band does not cover auth screens', () => {
  const authCss = read('../components/ui/auth-layout.css')
  const nativeCss = read('../mobile-native-qa-polish.css')
  it('auth layout and stand-alone screens reserve the safe-area top only in the app', () => {
    expect(authCss).toMatch(/html\[data-idogs-native-platform\] \.idogs-auth\{padding-top:calc\(var\(--safe-area-top/)
    expect(nativeCss).toMatch(/html\[data-idogs-native-platform\] \.idogs-native-safe-page\{padding-top:calc\(var\(--safe-area-top/)
    for (const page of ['VerifyEmailPage', 'ForgotPasswordPage']) expect(read(`../pages/${page}.tsx`)).toContain('className="idogs-native-safe-page"')
  })
})
