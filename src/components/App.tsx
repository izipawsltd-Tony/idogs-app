import { discoveryRoute } from '../lib/quickSignup'
import React, { Suspense } from 'react'
import { lazyWithReload as lazy } from '../lib/lazyWithReload'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import ToastContainer from './ui/Toast'
import type { ToastMessage } from '../types'

// Pages (all except the landing page are loaded on demand)
import LandingPage from '../pages/LandingPage'
const EmailSigninFinishPage = lazy(() => import('../pages/EmailSigninFinishPage'))
const LoginPage = lazy(() => import('../pages/LoginPage'))
const SignupPage = lazy(() => import('../pages/SignupPage'))
const VerifyEmailPage = lazy(() => import('../pages/VerifyEmailPage'))
const DashboardPage = lazy(() => import('../pages/DashboardPage'))
const DogListPage = lazy(() => import('../pages/DogListPage'))
const DogDetailPage = lazy(() => import('../pages/DogDetailPage'))
const DogNewPage = lazy(() => import('../pages/DogNewPage'))
const LittersPage = lazy(() => import('../pages/LittersPage'))
const RemindersPage = lazy(() => import('../pages/RemindersPage'))
const SettingsPage = lazy(() => import('../pages/SettingsPage'))
const DocumentsPage = lazy(() => import('../pages/DocumentsPage'))
const ExportPage = lazy(() => import('../pages/ExportPage'))
const AuditPage = lazy(() => import('../pages/AuditPage'))
const BillingPage = lazy(() => import('../pages/BillingPage'))
const SurveyPage = lazy(() => import('../pages/SurveyPage'))
const AdminSurveyPage = lazy(() => import('../pages/AdminSurveyPage'))
const AdminAuditPage = lazy(() => import('../pages/AdminAuditPage'))
const LandingMediaAdminPage = lazy(() => import('../pages/LandingMediaAdminPage'))
const TermsPage = lazy(() => import('../pages/TermsPage'))
const PrivacyPage = lazy(() => import('../pages/PrivacyPage'))
const PassportPublicPage = lazy(() => import('../pages/PassportPublicPage'))
const ShowcasePublicPage = lazy(() => import('../pages/ShowcasePublicPage'))
const ForgotPasswordPage = lazy(() => import('../pages/ForgotPasswordPage'))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'))
const ComingSoonPage = lazy(() => import('../pages/ComingSoonPage'))
const ReportsPage = lazy(() => import('../pages/ReportsPage'))
const BuyersPage = lazy(() => import('../pages/BuyersPage'))
const FinanceDocumentsPage = lazy(() => import('../pages/FinanceDocumentsPage'))
const ClaimDogPage = lazy(() => import('../pages/ClaimDogPage'))
const PrivateDogPage = lazy(() => import('../pages/PrivateDogPage'))
const FollowingPuppiesPage = lazy(() => import('../pages/FollowingPuppiesPage'))
const PuppyUpdatesPage = lazy(() => import('../pages/PuppyUpdatesPage'))
const SuperAdminRoute = lazy(() => import('../super-admin/SuperAdminRoute'))
const SuperAdminLayout = lazy(() => import('../super-admin/SuperAdminLayout'))
const SuperAdminOverviewPage = lazy(() => import('../super-admin/pages/SuperAdminOverviewPage'))
const SuperAdminAiCeoPage = lazy(() => import('../super-admin/pages/SuperAdminAiCeoPage'))
const SuperAdminOrganisationsPage = lazy(() => import('../super-admin/pages/SuperAdminOrganisationsPage'))
const SuperAdminOrganisationDetailPage = lazy(() => import('../super-admin/pages/SuperAdminOrganisationDetailPage'))
const SuperAdminUsersPage = lazy(() => import('../super-admin/pages/SuperAdminUsersPage'))
const SuperAdminUserDetailPage = lazy(() => import('../super-admin/pages/SuperAdminUserDetailPage'))
const SuperAdminSubscriptionsPage = lazy(() => import('../super-admin/pages/SuperAdminSubscriptionsPage'))
const SuperAdminPlansPricingPage = lazy(() => import('../super-admin/pages/SuperAdminPlansPricingPage'))
const SuperAdminAuditLogsPage = lazy(() => import('../super-admin/pages/SuperAdminAuditLogsPage'))
const SuperAdminAuditLogDetailPage = lazy(() => import('../super-admin/pages/SuperAdminAuditLogDetailPage'))
const SuperAdminSettingsPage = lazy(() => import('../super-admin/pages/SuperAdminSettingsPage'))
const SuperAdminSupportInboxPage = lazy(() => import('../super-admin/pages/SuperAdminSupportInboxPage'))
const SuperAdminFaqManagementPage = lazy(() => import('../super-admin/pages/SuperAdminFaqManagementPage'))

const AppLayout = lazy(() => import('./layout/AppLayout'))
import LoadingScreen from './ui/LoadingScreen'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}`
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(returnTo)}`} replace />
  if (!user.emailVerified && !discoveryRoute(location.pathname)) return <Navigate to={`/verify-email?next=${encodeURIComponent(returnTo)}`} replace />
  return <>{children}</>
}

function BreederOnlyRoute({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth()
  if (profile?.role === 'owner') return <Navigate to="/app/dashboard" replace />
  return <>{children}</>
}

// Codex round 17, Blocker 4: React Router does NOT remount a route's
// element when only a URL param changes within the same route match —
// navigating from /app/dogs/A to /app/dogs/B re-renders the SAME
// DogDetailPage instance with a new dogId, relying entirely on its own
// internal effects to clear and reload. That's the same class of timing
// risk useRequestGuard's own render-vs-commit fix (this round) closes for
// uid tracking — an effect-based clear can still leave a frame where
// Dog A's fields are visible right after the URL/params for Dog B have
// already committed. Keying on dogId here forces React to fully unmount
// the previous dog's instance and mount a completely fresh one on every
// navigation between two dogs — the same structural guarantee
// `<Outlet key={user?.uid}/>` gives AppLayout for account switches,
// applied at the dog level: a torn-down instance's state can never be
// visible again, and there is no state to accidentally carry over.
function DogDetailRoute({ toast }: { toast: (msg: string, type?: ToastMessage['type']) => void }) {
  const { dogId } = useParams<{ dogId: string }>()
  return <DogDetailPage key={dogId} toast={toast} />
}
function PassportRoute() {
  const { passportId } = useParams<{ passportId: string }>()
  return <PassportPublicPage key={passportId} />
}
export default function App() {
  const { toasts, toast, dismiss, dismissAll } = useToast()
  const { pathname } = useLocation()
  // Ad traffic lands on / and taps "Start Free": warm the signup/login
  // chunks while the visitor reads, without competing with the first paint.
  React.useEffect(() => {
    if (pathname !== '/') return
    const warm = () => { void import('../pages/SignupPage'); void import('../pages/LoginPage') }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    const id = w.requestIdleCallback ? w.requestIdleCallback(warm, { timeout: 4000 }) : window.setTimeout(warm, 2500)
    return () => { if (!w.requestIdleCallback) window.clearTimeout(id) }
  }, [pathname])

  return (
    <>
      <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage toast={toast} />} />
        <Route path="/signup" element={<SignupPage toast={toast} />} />
        <Route path="/auth/finish" element={<EmailSigninFinishPage />} />
        <Route path="/p/:passportId" element={<PassportRoute />} />
        <Route path="/s/:token" element={<ShowcasePublicPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/survey" element={<SurveyPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage toast={toast} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Isolated Super SaaS Admin — intentionally outside AppLayout. */}
        <Route path="/app/super-admin" element={
          <ProtectedRoute>
            <SuperAdminRoute>
              <SuperAdminLayout />
            </SuperAdminRoute>
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/app/super-admin/dashboard" replace />} />
          <Route path="start" element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<SuperAdminOverviewPage />} />
          <Route path="ai-ceo" element={<SuperAdminAiCeoPage />} />
          <Route path="organisations" element={<SuperAdminOrganisationsPage />} />
          <Route path="organisations/:id" element={<SuperAdminOrganisationDetailPage />} />
          <Route path="users" element={<SuperAdminUsersPage />} />
          <Route path="users/:uid" element={<SuperAdminUserDetailPage />} />
          <Route path="subscriptions" element={<SuperAdminSubscriptionsPage />} />
          <Route path="plans-pricing" element={<SuperAdminPlansPricingPage />} />
          <Route path="support-inbox" element={<SuperAdminSupportInboxPage />} />
          <Route path="support-faqs" element={<SuperAdminFaqManagementPage />} />
          <Route path="audit-logs" element={<SuperAdminAuditLogsPage />} />
          <Route path="audit-logs/:id" element={<SuperAdminAuditLogDetailPage />} />
          <Route path="settings" element={<SuperAdminSettingsPage />} />
        </Route>

        {/* Protected — app */}
        <Route path="/app" element={
          <ProtectedRoute>
            <AppLayout toast={toast} />
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="start" element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage toast={toast} />} />
          <Route path="dogs" element={<DogListPage toast={toast} />} />
          <Route path="dogs/new" element={<DogNewPage toast={toast} />} />
          <Route path="dogs/:dogId" element={<DogDetailRoute toast={toast} />} />
          <Route path="litters" element={<LittersPage toast={toast} dismissAll={dismissAll} />} />
          <Route path="reminders" element={<RemindersPage toast={toast} />} />
          <Route path="settings" element={<SettingsPage toast={toast} />} />
          <Route path="documents" element={<DocumentsPage toast={toast} />} />
          <Route path="export" element={<BreederOnlyRoute><ExportPage toast={toast} /></BreederOnlyRoute>} />
          <Route path="audit" element={<AuditPage toast={toast} />} />
          <Route path="billing" element={<BillingPage toast={toast} />} />
          <Route path="admin/survey" element={<AdminSurveyPage toast={toast} />} />
          <Route path="admin/audit" element={<AdminAuditPage toast={toast} />} />
          <Route path="admin/landing-media" element={<LandingMediaAdminPage toast={toast} />} />
          <Route path="puppies" element={<Navigate to="/app/dogs?stage=puppies" replace />} />
          <Route path="buyers"  element={<BreederOnlyRoute><BuyersPage /></BreederOnlyRoute>} />
          <Route path="finance" element={<BreederOnlyRoute><FinanceDocumentsPage toast={toast} /></BreederOnlyRoute>} />
          <Route path="reports" element={<BreederOnlyRoute><ReportsPage toast={toast} /></BreederOnlyRoute>} />
          <Route path="claim-dogs" element={<ClaimDogPage toast={toast} />} />
          <Route path="shared-dogs/:dogId" element={<PrivateDogPage />} />
          <Route path="following-puppies" element={<FollowingPuppiesPage />} />
          <Route path="puppy-updates/:passportId" element={<PuppyUpdatesPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  )
}
