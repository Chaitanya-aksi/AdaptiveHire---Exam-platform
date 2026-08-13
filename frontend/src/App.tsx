import { Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute, homeFor } from './components/ProtectedRoute';
import { ToastProvider } from './components/Toast';
import { AuthProvider, useAuth } from './lib/auth';
import { Login } from './routes/Login';
import { Profile } from './routes/Profile';
import { RecruiterLogin } from './routes/RecruiterLogin';
import { RecruiterRegister } from './routes/RecruiterRegister';
import { Register } from './routes/Register';
import { Assessments } from './routes/candidate/Assessments';
import { TakeAssessment } from './routes/candidate/TakeAssessment';

/*
 * Recruiter screens load as separate chunks, so a candidate's browser never
 * fetches them. The route guards and the API's 403s are what actually enforce
 * access; this is about the bundle itself. Recruiter copy names the scoring
 * mechanics — Elo scales, difficulty scores, per-option trait weights — and in
 * a single bundle all of that is readable in devtools by anyone who signs in,
 * whatever the router renders. Splitting keeps it off the wire entirely.
 *
 * Anything describing how scoring works belongs in one of these chunks.
 */
const Dashboard = lazy(() =>
  import('./routes/recruiter-admin/Dashboard').then((m) => ({ default: m.Dashboard })),
);
const Questions = lazy(() =>
  import('./routes/recruiter-admin/Questions').then((m) => ({ default: m.Questions })),
);
const BulkImport = lazy(() =>
  import('./routes/recruiter-admin/BulkImport').then((m) => ({ default: m.BulkImport })),
);
const Modules = lazy(() =>
  import('./routes/recruiter-admin/Modules').then((m) => ({ default: m.Modules })),
);
const People = lazy(() =>
  import('./routes/recruiter-admin/People').then((m) => ({ default: m.People })),
);
const AdminAssessments = lazy(() =>
  import('./routes/recruiter-admin/Assessments').then((m) => ({
    default: m.Assessments,
  })),
);
const AssessmentQuestions = lazy(() =>
  import('./routes/recruiter-admin/AssessmentQuestions').then((m) => ({
    default: m.AssessmentQuestions,
  })),
);
const InviteCandidates = lazy(() =>
  import('./routes/recruiter-admin/InviteCandidates').then((m) => ({
    default: m.InviteCandidates,
  })),
);
const AssessmentReports = lazy(() =>
  import('./routes/recruiter-admin/AssessmentReports').then((m) => ({
    default: m.AssessmentReports,
  })),
);
const CandidateReport = lazy(() =>
  import('./routes/recruiter-admin/CandidateReport').then((m) => ({
    default: m.CandidateReport,
  })),
);

/** Sends an already-signed-in user to their own home instead of the login form. */
function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Loading…</div>;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

/**
 * Sign-in and sign-up are pointless once there is a session — landing on them
 * mid-session reads as a bug, so bounce straight to the role's home.
 */
function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Loading…</div>;
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          {/* Covers the lazy recruiter chunks while they download. */}
          <Suspense fallback={<div className="empty">Loading…</div>}>
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route
                path="/login"
                element={
                  <GuestOnly>
                    <Login />
                  </GuestOnly>
                }
              />
              <Route
                path="/recruiter/login"
                element={
                  <GuestOnly>
                    <RecruiterLogin />
                  </GuestOnly>
                }
              />
              <Route
                path="/register"
                element={
                  <GuestOnly>
                    <Register />
                  </GuestOnly>
                }
              />
              <Route
                path="/recruiter/register"
                element={
                  <GuestOnly>
                    <RecruiterRegister />
                  </GuestOnly>
                }
              />

              <Route
                path="/admin"
                element={
                  <ProtectedRoute allow={['recruiter_admin']}>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Dashboard />} />
                <Route path="questions" element={<Questions />} />
                <Route path="import" element={<BulkImport />} />
                <Route path="modules" element={<Modules />} />
                <Route path="people" element={<People />} />
                <Route path="assessments" element={<AdminAssessments />} />
                <Route
                  path="assessments/:id/questions"
                  element={<AssessmentQuestions />}
                />
                <Route
                  path="assessments/:id/invite"
                  element={<InviteCandidates />}
                />
                <Route
                  path="assessments/:id/results"
                  element={<AssessmentReports />}
                />
                <Route
                  path="reports/:sessionId"
                  element={<CandidateReport />}
                />
                <Route path="profile" element={<Profile />} />
              </Route>

              <Route
                path="/assessments"
                element={
                  <ProtectedRoute allow={['candidate']}>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Assessments />} />
                <Route path="profile" element={<Profile />} />
              </Route>

              {/*
               * Deliberately outside AppLayout: while a module's clock is
               * running there should be no nav bar tempting the candidate to
               * click away from the test.
               */}
              <Route
                path="/assessments/:invitationId/take"
                element={
                  <ProtectedRoute allow={['candidate']}>
                    <TakeAssessment />
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<RootRedirect />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
