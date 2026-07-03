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

import AppLayout from './layout/AppLayout'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!user.emailVerified) return <Navigate to="/verify-email" replace />
  return <>{children}</>
}

function LoadingScreen() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--sand)',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 40, height: 40,
          background: 'var(--green)',
          borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
          fontSize: 20,
        }}>🐾</div>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    </div>
  )
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
          <Route path="export" element={<ExportPage toast={toast} />} />
          <Route path="audit" element={<AuditPage toast={toast} />} />
          <Route path="billing" element={<BillingPage toast={toast} />} />
          <Route path="admin/survey" element={<AdminSurveyPage toast={toast} />} />
          <Route path="admin/audit" element={<AdminAuditPage toast={toast} />} />
          <Route path="puppies" element={<ComingSoonPage feature="Puppies" />} />
          <Route path="buyers"  element={<ComingSoonPage feature="Buyers" />} />
          <Route path="reports" element={<ComingSoonPage feature="Reports" />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  )
}
