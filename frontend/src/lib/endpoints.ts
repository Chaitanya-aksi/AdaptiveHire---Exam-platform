import { api } from './api';
import type {
  AnswerPayload,
  Assessment,
  AssessmentInvitation,
  AttemptListItem,
  AttemptReview,
  AuthUser,
  BulkImportResult,
  BulkInviteResult,
  CandidateAttemptView,
  CandidateMessage,
  CandidateInvitation,
  CreatedUser,
  ModuleCatalogEntry,
  OrganisationProfile,
  BrandingPatch,
  ItemAnalysis,
  ModuleQuestionStats,
  OrgRole,
  Paginated,
  PracticeQuestion,
  Question,
  QuestionDraft,
  LoginPortal,
  QuestionStatus,
  RegisterPayload,
  AssessmentDeletionResult,
  DeletionResult,
  ReportDetail,
  ReportSummary,
  ReviewPatch,
  SessionStep,
  UserProfile,
  UserRole,
} from './types';

interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

export const authApi = {
  /**
   * `portal` names which sign-in page this came from, so the server can refuse a
   * recruiter on the candidate form and vice versa.
   */
  login: (email: string, password: string, portal: LoginPortal) =>
    api
      .post<AuthResponse>('/auth/login', { email, password, portal })
      .then((r) => r.data),

  /**
   * Self-service sign-up. The role is not part of the payload — the backend
   * always creates a `candidate`, so this endpoint can't be used to mint a
   * recruiter. Signs the new account straight in.
   */
  register: (payload: RegisterPayload) =>
    api.post<AuthResponse>('/auth/register', payload).then((r) => r.data),

  /** Exchanges the httpOnly cookie for a fresh access token on page load. */
  refresh: () => api.post<AuthResponse>('/auth/refresh').then((r) => r.data),

  logout: () => api.post<void>('/auth/logout').then(() => undefined),

  /**
   * Asks for a reset link.
   *
   * Resolves the same way whether or not that address has an account — the
   * server deliberately gives nothing away, so the UI must not either. Never
   * branch on this result to say "we found you".
   */
  forgotPassword: (email: string) =>
    api.post<void>('/auth/forgot-password', { email }).then(() => undefined),

  /** Redeems the token from the emailed link. Signs out every other session. */
  resetPassword: (token: string, password: string) =>
    api
      .post<void>('/auth/reset-password', { token, password })
      .then(() => undefined),
};

export const usersApi = {
  /** The signed-in user's own account, including createdAt / isActive. */
  me: () => api.get<UserProfile>('/users/me').then((r) => r.data),

  updateName: (fullName: string) =>
    api.patch<UserProfile>('/users/me', { fullName }).then((r) => r.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    api
      .post<void>('/users/me/change-password', {
        currentPassword,
        newPassword,
      })
      .then(() => undefined),

  /** Recruiter-only directory listing. */
  list: (query: UserQuery) =>
    api
      .get<Paginated<UserProfile>>('/users', {
        params: Object.fromEntries(
          Object.entries(query).filter(
            ([, v]) => v !== '' && v !== undefined && v !== null,
          ),
        ),
      })
      .then((r) => r.data),

  /** Recruiter-only. Returns a one-time password shown to the creator. */
  create: (fullName: string, email: string, role: UserRole) =>
    api
      .post<CreatedUser>('/users', { fullName, email, role })
      .then((r) => r.data),

  /** Moves a colleague to another workspace role. Server has the final say. */
  setOrgRole: (id: string, orgRole: OrgRole) =>
    api
      .patch<UserProfile>(`/users/${id}/org-role`, { orgRole })
      .then((r) => r.data),

  /**
   * Deletes a person and everything this organisation holds about them. The
   * server reports what it destroyed — the client must not re-derive that, or
   * the confirmation it shows could contradict what actually happened.
   */
  remove: (id: string) =>
    api.delete<DeletionResult>(`/users/${id}`).then((r) => r.data),
};

export interface UserQuery {
  role?: UserRole;
  search?: string;
  page?: number;
  limit?: number;
}

export const modulesApi = {
  list: (includeInactive = false) =>
    api
      .get<ModuleCatalogEntry[]>('/modules', { params: { includeInactive } })
      .then((r) => r.data),
};

export interface QuestionQuery {
  moduleId?: string;
  status?: QuestionStatus;
  search?: string;
  minDifficulty?: number;
  maxDifficulty?: number;
  page?: number;
  limit?: number;
}

export const questionsApi = {
  /** One request for the whole dashboard, instead of a count per module. */
  stats: () =>
    api.get<ModuleQuestionStats[]>('/questions/stats').then((r) => r.data),

  /** How each question is actually performing, from the answers already given. */
  analysis: (moduleId?: string) =>
    api
      .get<ItemAnalysis[]>('/questions/analysis', {
        params: moduleId ? { moduleId } : undefined,
      })
      .then((r) => r.data),

  list: (query: QuestionQuery) =>
    api
      .get<Paginated<Question>>('/questions', {
        // Blank fields would otherwise fail the backend's strict DTO
        // validation (e.g. status: "" is not a valid enum member).
        params: Object.fromEntries(
          Object.entries(query).filter(
            ([, v]) => v !== '' && v !== undefined && v !== null,
          ),
        ),
      })
      .then((r) => r.data),

  get: (id: string) =>
    api.get<Question>(`/questions/${id}`).then((r) => r.data),

  create: (moduleId: string, draft: QuestionDraft) =>
    api
      .post<Question>('/questions', { moduleId, ...draft })
      .then((r) => r.data),

  /**
   * Partial by design. Omitting `personality.pattern` leaves the stored one
   * alone, so fixing a legacy question's wording can't relabel it as
   * situational.
   */
  update: (id: string, draft: QuestionDraft) =>
    api.patch<Question>(`/questions/${id}`, draft).then((r) => r.data),

  activate: (id: string) =>
    api.patch<Question>(`/questions/${id}/activate`).then((r) => r.data),

  archive: (id: string) =>
    api.patch<Question>(`/questions/${id}/archive`).then((r) => r.data),

  /**
   * Permanent delete. Succeeds only for a question no candidate has answered;
   * the backend returns 409 otherwise (archive is the fallback there).
   */
  remove: (id: string) =>
    api
      .delete<{ id: string; deleted: true }>(`/questions/${id}`)
      .then((r) => r.data),

  bulkImport: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<BulkImportResult>('/questions/bulk-import', form)
      .then((r) => r.data);
  },

  /**
   * The template route is recruiter-only, so a plain <a href> would 401 —
   * the bearer token has to travel. Fetch it, then hand the browser a blob.
   */
  downloadTemplate: async (kind: 'mcq' | 'personality') => {
    const res = await api.get<Blob>(`/questions/bulk-import/template/${kind}`, {
      responseType: 'blob',
    });

    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `adaptivehire-${kind}-template.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

/**
 * Fetches a recruiter-only file (bearer token required) and saves it.
 *
 * `filename` is the fallback. A blob response discards `Content-Disposition`
 * as far as the browser is concerned — the synthetic `<a download>` decides
 * the name — so where the server named the file, that name is preferred and
 * the caller's is only used if the header is missing or unreadable.
 */
async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await api.get<Blob>(path, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFromHeaders(res.headers) ?? filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * The filename the server chose, or null.
 *
 * Only the quoted `filename="…"` form is read, because that is the only form
 * this API sends. Anything with a path separator in it is rejected rather than
 * sanitised: a name that tries to steer where the file lands is not a name.
 */
function filenameFromHeaders(headers: unknown): string | null {
  const raw = (headers as Record<string, unknown> | undefined)?.[
    'content-disposition'
  ];
  if (typeof raw !== 'string') return null;

  const match = /filename="([^"]+)"/.exec(raw);
  const name = match?.[1];
  if (!name || name.includes('/') || name.includes('\\')) return null;

  return name;
}

export interface AssessmentModulePayload {
  moduleId: string;
  /** Exactly how many questions this section asks. */
  questionCount: number;
  timeLimitSeconds: number;
  displayOrder?: number;
}

export interface CreateAssessmentPayload {
  title: string;
  description?: string;
  modules: AssessmentModulePayload[];
  /**
   * The questions the engine may draw from. Omit for no restriction, which is
   * the default — the engine then uses everything the organisation can see.
   */
  questionIds?: string[];
  /**
   * When the round runs, as ISO strings. Omit either for no bound; omit both
   * and it is open from the moment it exists, which is the default.
   */
  opensAt?: string;
  closesAt?: string;
}

export const assessmentsApi = {
  list: () => api.get<Assessment[]>('/assessments').then((r) => r.data),

  get: (id: string) =>
    api.get<Assessment>(`/assessments/${id}`).then((r) => r.data),

  create: (payload: CreateAssessmentPayload) =>
    api.post<Assessment>('/assessments', payload).then((r) => r.data),

  /**
   * Replaces which questions the engine may draw from. An empty array clears the
   * pool, returning the assessment to the whole visible bank.
   */
  setQuestionPool: (id: string, questionIds: string[]) =>
    api
      .put<Assessment>(`/assessments/${id}/questions`, { questionIds })
      .then((r) => r.data),

  /**
   * Deletes the assessment and every attempt made on it. Candidate accounts
   * survive — only their data for this assessment goes.
   */
  remove: (id: string) =>
    api
      .delete<AssessmentDeletionResult>(`/assessments/${id}`)
      .then((r) => r.data),
};

export const organisationsApi = {
  /**
   * The caller's own workspace. There is deliberately no route taking an
   * organisation id — the server reads the scope from the token, so there is no
   * id here for anyone to substitute.
   */
  mine: () =>
    api.get<OrganisationProfile>('/organisations/mine').then((r) => r.data),

  /**
   * Partial by design: an omitted field is left alone and an explicit `null`
   * clears it. Send only what changed, or clearing a logo would also reset the
   * colour.
   */
  updateBranding: (changes: BrandingPatch) =>
    api
      .patch<OrganisationProfile>('/organisations/mine/branding', changes)
      .then((r) => r.data),
};

export const invitationsApi = {
  /** Recruiter: everyone invited to one assessment. */
  forAssessment: (assessmentId: string) =>
    api
      .get<AssessmentInvitation[]>(`/assessments/${assessmentId}/invitations`)
      .then((r) => r.data),

  /** Recruiter: upload a candidate spreadsheet for one assessment. */
  bulkInvite: (assessmentId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<BulkInviteResult>(
        `/assessments/${assessmentId}/invitations/bulk-import`,
        form,
      )
      .then((r) => r.data);
  },

  /** Recruiter: invite one candidate without building a spreadsheet. */
  inviteOne: (assessmentId: string, email: string, fullName: string) =>
    api
      .post<AssessmentInvitation>(`/assessments/${assessmentId}/invitations`, {
        email,
        // Omitted rather than sent empty — the DTO treats it as optional.
        ...(fullName.trim() ? { fullName: fullName.trim() } : {}),
      })
      .then((r) => r.data),

  /** Recruiter: delete an invitation added by mistake. 409 once they start. */
  remove: (invitationId: string) =>
    api
      .delete<{ id: string; deleted: true }>(`/invitations/${invitationId}`)
      .then((r) => r.data),

  /**
   * Recruiter: move one candidate's window without touching the round.
   *
   * For the person who was ill on the day, or whose power went. Sets the
   * per-invitation override, so rescheduling one candidate leaves the other
   * ninety on the round's own dates. `null` on either end clears the override
   * and returns that end to the assessment's schedule; omit a field to leave
   * it alone.
   */
  reschedule: (
    invitationId: string,
    changes: { opensAt?: string | null; expiresAt?: string | null },
  ) =>
    api
      .patch<AssessmentInvitation>(
        `/invitations/${invitationId}/schedule`,
        changes,
      )
      .then((r) => r.data),

  /** Recruiter: withdraw access but keep the record and any completed attempt. */
  revoke: (invitationId: string) =>
    api
      .patch<AssessmentInvitation>(`/invitations/${invitationId}/revoke`)
      .then((r) => r.data),

  downloadTemplate: () =>
    downloadFile(
      '/invitations/template',
      'adaptivehire-candidates-template.csv',
    ),

  /** Candidate: their own invitations, for the assessment list. */
  mine: () =>
    api.get<CandidateInvitation[]>('/me/invitations').then((r) => r.data),

  /**
   * One timed round trip, for the readiness check's connection measurement.
   *
   * The same authenticated endpoint the candidate's own pages use, so what is
   * measured is the real path — auth, database and all — rather than a public
   * health route that skips most of the work a real request does.
   *
   * The nonce is the point of this existing separately from `mine`. Express
   * puts an ETag on the response, so a repeated identical GET can come back as
   * a 304 that is faster than the request it is meant to be timing, and the
   * median of three would then measure the browser cache rather than the
   * network. A unique query string makes every sample a real one.
   */
  ping: () =>
    api
      .get<CandidateInvitation[]>('/me/invitations', {
        params: { _: `${Date.now()}-${Math.random().toString(36).slice(2)}` },
      })
      .then(() => undefined),

  /**
   * Candidate: untimed, unscored practice questions for one of their own
   * invitations.
   *
   * An empty array is a normal answer — it means nobody has authored samples
   * for these subjects yet, and the caller skips the step rather than blocking.
   */
  practice: (invitationId: string) =>
    api
      .get<PracticeQuestion[]>(`/me/invitations/${invitationId}/practice`)
      .then((r) => r.data),

  /**
   * Candidate: one of their own invitations in full — where it has got to, and
   * how their attempt went. Participation figures only; no score comes back.
   */
  myAttempt: (invitationId: string) =>
    api
      .get<CandidateAttemptView>(`/me/invitations/${invitationId}`)
      .then((r) => r.data),
};

/**
 * The test-taking runtime. Every call returns the same `SessionStep` union, so
 * the UI never has to reconcile two shapes — whatever comes back *is* the
 * screen to render.
 */
export const sessionsApi = {
  /** Begins the attempt, or rejoins one already in progress. */
  start: (invitationId: string) =>
    api
      .post<SessionStep>('/sessions/start', { invitationId })
      .then((r) => r.data),

  /** Also how a reloaded tab catches back up to where the server thinks it is. */
  current: (sessionId: string) =>
    api
      .get<SessionStep>(`/sessions/${sessionId}/next-question`)
      .then((r) => r.data),

  /** Starts the current module's clock — nothing ticks until this is called. */
  startModule: (sessionId: string) =>
    api
      .post<SessionStep>(`/sessions/${sessionId}/module/start`)
      .then((r) => r.data),

  /**
   * `payload` carries either a single choice or a ranking's ordering. Order is
   * the answer for a ranking, so it is sent exactly as the candidate built it.
   */
  answer: (sessionId: string, questionId: string, payload: AnswerPayload) =>
    api
      .post<SessionStep>(`/sessions/${sessionId}/answer`, {
        questionId,
        ...payload,
      })
      .then((r) => r.data),
};

/**
 * Recruiter-only. Nothing here is reachable from the candidate app — a report
 * carries the answer key as well as the scores.
 */
export const reportsApi = {
  /** Every attempt at one assessment. */
  forAssessment: (assessmentId: string) =>
    api
      .get<AttemptListItem[]>(`/reports/assessments/${assessmentId}`)
      .then((r) => r.data),

  /**
   * Downloads the cohort as a CSV.
   *
   * Sends the session ids in the order they are on screen, so the file matches
   * exactly what the recruiter filtered and sorted rather than approximating it
   * from query parameters.
   */
  exportCohort: async (assessmentId: string, sessionIds: string[]) => {
    const res = await api.post<Blob>(
      `/reports/assessments/${assessmentId}/export`,
      { sessionIds },
      { responseType: 'blob' },
    );

    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'adaptivehire-results.csv';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * Saves one candidate's full report as a PDF.
   *
   * The server builds the file, so this is an ordinary authenticated download
   * that lands in the downloads folder. It replaced `window.print()`, which
   * could only ever open the print dialog and ask the recruiter to pick "Save
   * as PDF" themselves — no page can skip that dialog.
   */
  downloadPdf: (sessionId: string) =>
    downloadFile(
      `/reports/sessions/${sessionId}/pdf`,
      // Only reached if the server sent no filename; it always does.
      'adaptivehire-report.pdf',
    ),

  /**
   * Shortlist, reject, tag or annotate an attempt.
   *
   * Send only what changed. The row is shared across the organisation, so a
   * full replacement would blank a colleague's note whenever the caller
   * happened not to be showing it.
   */
  saveReview: (sessionId: string, patch: ReviewPatch) =>
    api
      .put<AttemptReview>(`/reports/sessions/${sessionId}/review`, patch)
      .then((r) => r.data),

  /** Layer one: the stored summary and scores. */
  summary: (sessionId: string) =>
    api
      .get<ReportSummary>(`/reports/sessions/${sessionId}`)
      .then((r) => r.data),

  /** Layer two: fetched separately so the summary paints without waiting. */
  detail: (sessionId: string) =>
    api
      .get<ReportDetail>(`/reports/sessions/${sessionId}/detail`)
      .then((r) => r.data),

  /**
   * Tells the candidate they were not taken forward.
   *
   * Separate from `saveReview` on purpose — this one reaches a person and
   * cannot be undone. The decision must already be 'rejected' (400 otherwise),
   * and a second call is refused with 409 rather than sending again, so the
   * server is the guard here and the disabled button is only a courtesy.
   */
  sendRejectionEmail: (sessionId: string) =>
    api
      .post<{ sentAt: string; to: string }>(
        `/reports/sessions/${sessionId}/rejection-email`,
      )
      .then((r) => r.data),

  /**
   * Writes to the candidate in the recruiter's own words.
   *
   * The way back to somebody already rejected — that decision is final on the
   * server, so re-engaging means talking to them rather than un-ticking a box.
   */
  sendMessage: (sessionId: string, message: string) =>
    api
      .post<CandidateMessage>(`/reports/sessions/${sessionId}/messages`, {
        message,
      })
      .then((r) => r.data),

  /** What has already been said to this candidate, newest first. */
  messages: (sessionId: string) =>
    api
      .get<CandidateMessage[]>(`/reports/sessions/${sessionId}/messages`)
      .then((r) => r.data),

  regenerate: (sessionId: string) =>
    api
      .post<void>(`/reports/sessions/${sessionId}/regenerate`)
      .then(() => undefined),
};
