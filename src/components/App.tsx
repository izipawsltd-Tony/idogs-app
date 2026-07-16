import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import ToastContainer from './ui/Toast'

// Pages
import LandingPage from '../pages/LandingPage'
import LoginPage from '../pages/LoginPage'
import SignupPage from '../pages/SignupPage'
import VerifyEmailPage from '../pages/VerifyEmailPage'
import DashboardPage from '../pages/DashboardPage'
import DogListPage from '../pages/DogListPage'
import DogDetailPage from '../pages/DogDetailPage'
import DogNewPage from '../pages/DogNewPage'
import LittersPage from '../pages/LittersPage'
import RemindersPage from '../pages/RemindersPage'
import SettingsPage from '../pages/SettingsPage'
import DocumentsPage from '../pages/DocumentsPage'
import ExportPage from '../pages/ExportPage'
import AuditPage from '../pages/AuditPage'
import BillingPage from '../pages/BillingPage'
import SurveyPage from '../pages/SurveyPage'
import AdminSurveyPage from '../pages/AdminSurveyPage'
import AdminAuditPage from '../pages/AdminAuditPage'
import TermsPage from '../pages/TermsPage'
import PrivacyPage from '../pages/PrivacyPage'
import PassportPublicPage from '../pages/PassportPublicPage'
import ForgotPasswordPage from '../pages/ForgotPasswordPage'
import NotFoundPage from '../pages/NotFoundPage'
import ComingSoonPage from '../pages/ComingSoonPage'
import ReportsPage from '../pages/ReportsPage'
import BuyersPage from '../pages/BuyersPage'
import ClaimDogPage from '../pages/ClaimDogPage'

import AppLayout from './layout/AppLayout'
import LoadingScreen from './ui/LoadingScreen'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!user.emailVerified) return <Navigate to="/verify-email" replace />
  return <>{children}</>
}

function BreederOnlyRoute({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth()
  if (profile?.role === 'owner') return <Navigate to="/app/dashboard" replace />
  return <>{children}</>
}
export default function App() {
  const { toasts, toast, dismiss } = useToast()

  return (
    <>
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage toast={toast} />} />
        <Route path="/signup" element={<SignupPage toast={toast} />} />
        <Route path="/p/:passportId" element={<PassportPublicPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/survey" element={<SurveyPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage toast={toast} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

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
          <Route path="dogs/:dogId" element={<DogDetailPage toast={toast} />} />
          <Route path="litters" element={<LittersPage toast={toast} />} />
          <Route path="reminders" element={<RemindersPage toast={toast} />} />
          <Route path="settings" element={<SettingsPage toast={toast} />} />
          <Route path="documents" element={<DocumentsPage toast={toast} />} />
          <Route path="export" element={<BreederOnlyRoute><ExportPage toast={toast} /></BreederOnlyRoute>} />
          <Route path="audit" element={<AuditPage toast={toast} />} />
          <Route path="billing" element={<BillingPage toast={toast} />} />
          <Route path="admin/survey" element={<AdminSurveyPage toast={toast} />} />
          <Route path="admin/audit" element={<AdminAuditPage toast={toast} />} />
          <Route path="puppies" element={<Navigate to="/app/dogs?stage=puppies" replace />} />
          <Route path="buyers"  element={<BreederOnlyRoute><BuyersPage /></BreederOnlyRoute>} />
          <Route path="reports" element={<BreederOnlyRoute><ReportsPage toast={toast} /></BreederOnlyRoute>} />
          <Route path="claim-dogs" element={<ClaimDogPage toast={toast} />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  )
}
