import { api } from './api';
import type {
  AnswerPayload,
  Assessment,
  AssessmentInvitation,
  AttemptListItem,
  AuthUser,
  BulkImportResult,
  BulkInviteResult,
  CandidateInvitation,
  CreatedUser,
  ModuleCatalogEntry,
  ModuleQuestionStats,
  Paginated,
  Question,
  QuestionDraft,
  LoginPortal,
  QuestionStatus,
  RegisterPayload,
  ReportDetail,
  ReportSummary,
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
    const res = await api.get<Blob>(
      `/questions/bulk-import/template/${kind}`,
      { responseType: 'blob' },
    );

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

/** Fetches a recruiter-only file (bearer token required) and saves it. */
async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await api.get<Blob>(path, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface AssessmentModulePayload {
  moduleId: string;
  minQuestions: number;
  maxQuestions: number;
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

  /** Recruiter: withdraw access but keep the record and any completed attempt. */
  revoke: (invitationId: string) =>
    api
      .patch<AssessmentInvitation>(`/invitations/${invitationId}/revoke`)
      .then((r) => r.data),

  downloadTemplate: () =>
    downloadFile('/invitations/template', 'adaptivehire-candidates-template.csv'),

  /** Candidate: their own invitations, for the assessment list. */
  mine: () =>
    api.get<CandidateInvitation[]>('/me/invitations').then((r) => r.data),
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

  /** Layer one: the stored summary and scores. */
  summary: (sessionId: string) =>
    api.get<ReportSummary>(`/reports/sessions/${sessionId}`).then((r) => r.data),

  /** Layer two: fetched separately so the summary paints without waiting. */
  detail: (sessionId: string) =>
    api
      .get<ReportDetail>(`/reports/sessions/${sessionId}/detail`)
      .then((r) => r.data),

  regenerate: (sessionId: string) =>
    api
      .post<void>(`/reports/sessions/${sessionId}/regenerate`)
      .then(() => undefined),
};
