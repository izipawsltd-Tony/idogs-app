import React from 'react'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import ToastContainer from './ui/Toast'
import LoadingScreen from './ui/LoadingScreen'
import type { ToastMessage } from '../types'

// Keep the landing page eager so the marketing surface can render from the
// initial bundle. Every other route is loaded only when it is actually
// visited, keeping app/admin/upload code (including HEIC/WASM paths) off the
// landing-page critical path.
import LandingPage from '../pages/LandingPage'

const LoginPage = React.lazy(() => import('../pages/LoginPage'))
const SignupPage = React.lazy(() => import('../pages/SignupPage'))
const VerifyEmailPage = React.lazy(() => import('../pages/VerifyEmailPage'))
const DashboardPage = React.lazy(() => import('../pages/DashboardPage'))
const DogListPage = React.lazy(() => import('../pages/DogListPage'))
const DogDetailPage = React.lazy(() => import('../pages/DogDetailPage'))
const DogNewPage = React.lazy(() => import('../pages/DogNewPage'))
const LittersPage = React.lazy(() => import('../pages/LittersPage'))
const RemindersPage = React.lazy(() => import('../pages/RemindersPage'))
const SettingsPage = React.lazy(() => import('../pages/SettingsPage'))
const DocumentsPage = React.lazy(() => import('../pages/DocumentsPage'))
const ExportPage = React.lazy(() => import('../pages/ExportPage'))
const AuditPage = React.lazy(() => import('../pages/AuditPage'))
const BillingPage = React.lazy(() => import('../pages/BillingPage'))
const SurveyPage = React.lazy(() => import('../pages/SurveyPage'))
const AdminSurveyPage = React.lazy(() => import('../pages/AdminSurveyPage'))
const AdminAuditPage = React.lazy(() => import('../pages/AdminAuditPage'))
const LandingMediaAdminPage = React.lazy(() => import('../pages/LandingMediaAdminPage'))
const TermsPage = React.lazy(() => import('../pages/TermsPage'))
const PrivacyPage = React.lazy(() => import('../pages/PrivacyPage'))
const PassportPublicPage = React.lazy(() => import('../pages/PassportPublicPage'))
const ShowcasePublicPage = React.lazy(() => import('../pages/ShowcasePublicPage'))
const ForgotPasswordPage = React.lazy(() => import('../pages/ForgotPasswordPage'))
const NotFoundPage = React.lazy(() => import('../pages/NotFoundPage'))
const ReportsPage = React.lazy(() => import('../pages/ReportsPage'))
const BuyersPage = React.lazy(() => import('../pages/BuyersPage'))
const ClaimDogPage = React.lazy(() => import('../pages/ClaimDogPage'))
const PrivateDogPage = React.lazy(() => import('../pages/PrivateDogPage'))

const AppLayout = React.lazy(() => import('./layout/AppLayout'))
const SuperAdminRoute = React.lazy(() => import('../super-admin/SuperAdminRoute'))
const SuperAdminLayout = React.lazy(() => import('../super-admin/SuperAdminLayout'))
const SuperAdminOverviewPage = React.lazy(() => import('../super-admin/pages/SuperAdminOverviewPage'))
const SuperAdminAiCeoPage = React.lazy(() => import('../super-admin/pages/SuperAdminAiCeoPage'))
const SuperAdminOrganisationsPage = React.lazy(() => import('../super-admin/pages/SuperAdminOrganisationsPage'))
const SuperAdminOrganisationDetailPage = React.lazy(() => import('../super-admin/pages/SuperAdminOrganisationDetailPage'))
const SuperAdminUsersPage = React.lazy(() => import('../super-admin/pages/SuperAdminUsersPage'))
const SuperAdminUserDetailPage = React.lazy(() => import('../super-admin/pages/SuperAdminUserDetailPage'))
const SuperAdminSubscriptionsPage = React.lazy(() => import('../super-admin/pages/SuperAdminSubscriptionsPage'))
const SuperAdminPlansPricingPage = React.lazy(() => import('../super-admin/pages/SuperAdminPlansPricingPage'))
const SuperAdminAuditLogsPage = React.lazy(() => import('../super-admin/pages/SuperAdminAuditLogsPage'))
const SuperAdminAuditLogDetailPage = React.lazy(() => import('../super-admin/pages/SuperAdminAuditLogDetailPage'))
const SuperAdminSettingsPage = React.lazy(() => import('../super-admin/pages/SuperAdminSettingsPage'))
const SuperAdminSupportInboxPage = React.lazy(() => import('../super-admin/pages/SuperAdminSupportInboxPage'))
const SuperAdminFaqManagementPage = React.lazy(() => import('../super-admin/pages/SuperAdminFaqManagementPage'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}`
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(returnTo)}`} replace />
  if (!user.emailVerified) return <Navigate to={`/verify-email?next=${encodeURIComponent(returnTo)}`} replace />
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

export default function App() {
  const { toasts, toast, dismiss, dismissAll } = useToast()

  return (
    <>
      <React.Suspense fallback={<LoadingScreen />}>
        <Routes>
          {/* Public */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage toast={toast} />} />
          <Route path="/signup" element={<SignupPage toast={toast} />} />
          <Route path="/p/:passportId" element={<PassportPublicPage />} />
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
            <Route path="buyers" element={<BreederOnlyRoute><BuyersPage /></BreederOnlyRoute>} />
            <Route path="reports" element={<BreederOnlyRoute><ReportsPage toast={toast} /></BreederOnlyRoute>} />
            <Route path="claim-dogs" element={<ClaimDogPage toast={toast} />} />
            <Route path="shared-dogs/:dogId" element={<PrivateDogPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </React.Suspense>
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  )
}
