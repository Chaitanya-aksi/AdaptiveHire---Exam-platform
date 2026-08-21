import { Suspense, lazy, useCallback, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { CandidateLayout } from './components/CandidateLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute, homeFor } from './components/ProtectedRoute';
import { BrandSplash, SplashProvider } from './components/Splash';
import { ToastProvider } from './components/Toast';
import { AuthProvider, useAuth } from './lib/auth';
import { ForgotPassword } from './routes/ForgotPassword';
import { Login } from './routes/Login';
import { Profile } from './routes/Profile';
import { ResetPassword } from './routes/ResetPassword';
import { SetPassword } from './routes/SetPassword';
import { RecruiterLogin } from './routes/RecruiterLogin';
import { RecruiterRegister } from './routes/RecruiterRegister';
import { Register } from './routes/Register';
import { Assessments } from './routes/candidate/Assessments';
import { AttemptDetail } from './routes/candidate/AttemptDetail';
import { ReadinessCheck } from './routes/candidate/ReadinessCheck';
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
  import('./routes/recruiter-admin/Dashboard').then((m) => ({
    default: m.Dashboard,
  })),
);
const Questions = lazy(() =>
  import('./routes/recruiter-admin/Questions').then((m) => ({
    default: m.Questions,
  })),
);
const QuestionAnalysis = lazy(() =>
  import('./routes/recruiter-admin/QuestionAnalysis').then((m) => ({
    default: m.QuestionAnalysis,
  })),
);
const BulkImport = lazy(() =>
  import('./routes/recruiter-admin/BulkImport').then((m) => ({
    default: m.BulkImport,
  })),
);
const Modules = lazy(() =>
  import('./routes/recruiter-admin/Modules').then((m) => ({
    default: m.Modules,
  })),
);
const People = lazy(() =>
  import('./routes/recruiter-admin/People').then((m) => ({
    default: m.People,
  })),
);
const AdminAssessments = lazy(() =>
  import('./routes/recruiter-admin/Assessments').then((m) => ({
    default: m.Assessments,
  })),
);
const NewAssessment = lazy(() =>
  import('./routes/recruiter-admin/NewAssessment').then((m) => ({
    default: m.NewAssessment,
  })),
);
const AssessmentDetail = lazy(() =>
  import('./routes/recruiter-admin/AssessmentDetail').then((m) => ({
    default: m.AssessmentDetail,
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
const Settings = lazy(() =>
  import('./routes/recruiter-admin/Settings').then((m) => ({
    default: m.Settings,
  })),
);

/**
 * The minimum the page-load splash stays up.
 *
 * Not a pause for its own sake. The silent refresh is usually quick, and left
 * to finish on its own the splash would blink in and out — worse than the blank
 * it replaced. It also buys the work that follows: `ProtectedRoute` cannot
 * mount a recruiter route until the session resolves, so the lazy chunk for
 * that page only starts downloading part-way through this window and lands
 * inside it, where before it produced a second "Loading…" of its own.
 */
const BOOT_MIN_MS = 900;

/**
 * What a reload looks like.
 *
 * Every page load starts with no access token — it is held in memory only, so
 * a refresh genuinely has none — and `AuthProvider` has to trade the httpOnly
 * cookie for a new one before anything can render. Until that settles every
 * route here renders "Loading…" on white, which is the flash this replaces.
 *
 * It waits on `loading` rather than a fixed hold, because the honest length of
 * this one is however long the round trip takes. `BOOT_MIN_MS` only stops it
 * being shorter than the eye can follow.
 *
 * Deliberately not conditional on already having a session: nothing can know
 * whether the cookie is good until the call comes back, so a first-time visitor
 * gets the same brand moment on their way to the sign-in page.
 */
function BootSplash() {
  const { loading } = useAuth();
  // Latched, not derived from `loading`. The exit animation runs *after* the
  // session resolves, so the splash has to outlive the condition that raised
  // it — unmounting the moment `loading` flips would cut the fade off.
  const [gone, setGone] = useState(false);
  const finish = useCallback(() => setGone(true), []);

  if (gone) return null;

  return (
    <BrandSplash
      title="Just a moment"
      subtitle="Getting things ready."
      holdMs={BOOT_MIN_MS}
      ready={!loading}
      onDone={finish}
    />
  );
}

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

/**
 * Last line of defence. The assessment runtime has its own boundary with a
 * recovery that rejoins the session — this one only has to stop an error
 * anywhere else turning into a blank page with no way forward.
 */
function AppRecovery({ reset }: { reset: () => void }) {
  return (
    <div className="empty" style={{ padding: 48, textAlign: 'center' }}>
      <h1 style={{ marginBottom: 8 }}>Something went wrong</h1>
      <p className="muted" style={{ margin: '0 0 18px' }}>
        This page didn&rsquo;t load properly. Trying again usually fixes it.
      </p>
      <button type="button" className="primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary
      name="app"
      fallback={({ reset }) => <AppRecovery reset={reset} />}
    >
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            {/*
              Outside <Routes> on purpose. The sign-in splash has to survive the
              navigation it introduces — `GuestOnly` below redirects the moment
              a session exists, and anything rendered inside the sign-in page
              would be unmounted with it. Here the destination mounts and
              fetches underneath the overlay instead of after it.
            */}
            <SplashProvider>
              <BootSplash />
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

                  {/*
                    Deliberately NOT `GuestOnly`, unlike the sign-in pages.
                    Someone can easily click a reset link in the same browser
                    they are signed in on, and bouncing them to their dashboard
                    with no explanation is the worst possible answer — they came
                    from their inbox holding a link that should work. The token
                    identifies the account on its own; the session is irrelevant
                    to redeeming it, and the reset ends that session anyway.
                  */}
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />

                  {/* Outside the app shell on purpose: the account cannot reach
                    the product until this is done, so a nav bar full of links
                    that all bounce back here would only mislead. */}
                  <Route
                    path="/set-password"
                    element={
                      <ProtectedRoute allow={['candidate', 'recruiter_admin']}>
                        <SetPassword />
                      </ProtectedRoute>
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
                    <Route
                      path="questions/analysis"
                      element={<QuestionAnalysis />}
                    />
                    <Route path="import" element={<BulkImport />} />
                    <Route path="modules" element={<Modules />} />
                    <Route path="people" element={<People />} />
                    <Route path="settings" element={<Settings />} />
                    {/* "My account" is a tab of Settings, not a section of its
                        own — same page component, mounted here so the tab strip
                        and the URL agree with each other. */}
                    <Route path="settings/account" element={<Profile />} />
                    <Route path="assessments" element={<AdminAssessments />} />
                    {/* Above `assessments/:id`, or "new" is read as an id. */}
                    <Route path="assessments/new" element={<NewAssessment />} />
                    {/* The overview: how the test is set up, and who is taking or
                      has taken it. Listed with its siblings so the relationship is
                      visible; react-router ranks by specificity, so the deeper
                      paths below still win over this one. */}
                    <Route
                      path="assessments/:id"
                      element={<AssessmentDetail />}
                    />
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
                    {/* Kept as an alias rather than deleted: this path is in
                        people's history and in old links. */}
                    <Route
                      path="profile"
                      element={<Navigate to="/admin/settings/account" replace />}
                    />
                  </Route>

                  {/* The candidate side has its own shell — the split brand panel
                    from the sign-in pages, not the recruiter's top nav bar. */}
                  <Route
                    path="/assessments"
                    element={
                      <ProtectedRoute allow={['candidate']}>
                        <CandidateLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Assessments />} />
                    {/* Ranked below `:invitationId/take` by react-router's own
                      specificity rules, and distinct from it on purpose: this one
                      keeps the shell, the test deliberately does not. */}
                    <Route path=":invitationId" element={<AttemptDetail />} />
                    <Route path="profile" element={<Profile />} />
                  </Route>

                  {/*
                   * Deliberately outside AppLayout: while a module's clock is
                   * running there should be no nav bar tempting the candidate to
                   * click away from the test.
                   */}
                  {/* The pre-flight: system check, then practice. Outside the
                      shell for the same reason the test is — it ends by starting
                      the assessment, and a nav bar at that moment is an invitation
                      to wander off mid-gate. Reachable on its own so somebody can
                      check their machine days before the assessment. */}
                  <Route
                    path="/assessments/:invitationId/ready"
                    element={
                      <ProtectedRoute allow={['candidate']}>
                        <ReadinessCheck />
                      </ProtectedRoute>
                    }
                  />
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
            </SplashProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
