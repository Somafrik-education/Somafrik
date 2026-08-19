import * as FileSystem from "expo-file-system/legacy";
import { UserRole } from "../navigation/AppNavigator";
import { isUsingLocalhostOnDevice, resolveApiBaseUrl, resolveApiRootUrl } from "../config/env";
import {
  ApiClientError,
  httpRequest,
  httpUpload,
  type SecureUploadFile,
  type SecureUploadRequestOptions,
} from "./httpClient";
import { sanitizeUserFacingError } from "./safeLogger";
import {
  clearSecureSession,
  getAccessToken,
  getRefreshToken,
  saveSessionProfile,
  saveTokens,
} from "./secureStorage";
import { canPersistFullSession, normalizePaymentRow, unwrapList } from "../lib/dataTruth";
import {
  normalizeEvaluation,
  normalizeGrade,
  stripEvaluationClientScope,
  type CanonicalEvaluation,
  type CanonicalGrade,
} from "../lib/evaluationsV2";
import {
  beginRestrictedSession,
  clearRestrictedSession,
  getRestrictedAccessToken,
  getRestrictedRefreshToken,
} from "../lib/restrictedSession";

export function getApiBaseUrl() {
  return resolveApiBaseUrl();
}

/** @deprecated Préférez getApiBaseUrl() — conservé pour compatibilité. */
export const API_BASE_URL = ""; // renseigné dynamiquement via getApiBaseUrl()

export type StudentSummary = {
  id: string;
  publicId?: string;
  name: string;
  firstName?: string;
  matricule: string;
  gender?: string;
  birthDate?: string;
  classId?: string | null;
  classCode?: string;
  className: string;
  schoolCode: string;
  parentName?: string;
  parentPhone: string;
  parentEmail?: string;
  archived?: boolean;
  status?: string;
};

export type TeacherAssignment = {
  id?: string;
  classId?: string | null;
  classCode?: string;
  className: string;
  course: string;
  subject?: string;
  subjectCode?: string;
  teacherId?: string;
  teacherName?: string;
  status?: string;
};

type LoginPayload = {
  role: UserRole;
  schoolCode: string;
  identifier: string;
  pin: string;
};

export type SchoolInfo = {
  id?: string;
  publicId?: string;
  code: string;
  name: string;
  type?: string;
  city: string;
  country?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  currency?: string;
  slogan?: string;
  status?: string;
  logoUrl?: string;
  schoolYear?: string;
  timezone?: string;
  language?: string;
  dateFormat?: string;
  primaryColor?: string;
  subscriptionPlan?: string;
  subscriptionStartDate?: string;
  subscriptionEndDate?: string;
  maxStudents?: number;
  maxTeachers?: number;
};

export type IdentifyResponse = {
  role: UserRole;
  roleLabel: string;
};

export type LoginResponse = {
  role: UserRole;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  permissions?: string[];
  user: {
    id: string;
    publicId?: string;
    name: string;
    firstName?: string;
    lastName?: string;
    matricule?: string;
    className?: string;
    schoolCode?: string;
    scopeLevel?: string;
    countryScope?: string;
    countryCode?: string;
    permissions?: string[];
    mustChangePassword?: boolean;
    parentPhone?: string;
    children?: StudentSummary[];
    phone?: string;
    assignments?: TeacherAssignment[];
    assignedClasses?: string[];
    courses?: string[];
  };
  school: SchoolInfo;
};

export type BackOfficeStatePayload = Record<string, unknown> & {
  schools?: unknown[];
  users?: unknown[];
  countries?: unknown[];
  subscriptions?: unknown[];
  notifications?: unknown[];
  students?: unknown[];
  teachers?: unknown[];
  classes?: unknown[];
  courses?: unknown[];
  assignments?: unknown[];
  courseSchedules?: unknown[];
  payments?: unknown[];
  paymentStatuses?: unknown[];
  presences?: unknown[];
  notes?: unknown[];
  academicConfigs?: Record<string, unknown>;
  announcements?: unknown[];
  messages?: unknown[];
  rolePermissions?: Record<string, string[]>;
  deletedRows?: Record<string, string[]>;
};

export type AcademicConfigPayload = {
  schoolCode: string;
  periodMode: string;
  periods: unknown[];
  evaluationTypes: string[];
  defaultScale: number;
  reportCardMode: string;
};

/** Persist tokens in SecureStore and return a session object without secrets. */
export async function persistAuthenticatedSession(session: LoginResponse): Promise<LoginResponse> {
  if (!canPersistFullSession(session)) {
    beginRestrictedSession(session.accessToken, session.refreshToken);
    await clearSecureSession();
    return {
      ...session,
      accessToken: undefined,
      refreshToken: undefined,
    };
  }

  clearRestrictedSession();
  if (session.accessToken || session.refreshToken) {
    await saveTokens(session.accessToken ?? null, session.refreshToken ?? null);
  }
  const safeSession: LoginResponse = {
    ...session,
    accessToken: undefined,
    refreshToken: undefined,
  };
  await saveSessionProfile({
    role: safeSession.role,
    permissions: safeSession.permissions,
    user: safeSession.user as unknown as Record<string, unknown>,
    school: safeSession.school as unknown as Record<string, unknown>,
  });
  return safeSession;
}

export async function hasActiveAccessToken() {
  return Boolean(await getAccessToken());
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    return await httpRequest<T>(path, options);
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError(
      sanitizeUserFacingError(error, "Impossible de joindre le serveur Somafrik."),
    );
  }
}

export function login(payload: LoginPayload) {
  return request<LoginResponse>("/login", {
    method: "POST",
    body: JSON.stringify(payload),
  })
    .catch((error) => {
      throw buildApiConnectionError(error);
    })
    .then((session) => persistAuthenticatedSession(session));
}

export async function logout() {
  try {
    await request<{ message: string }>("/auth/logout", {
      method: "POST",
    });
  } catch {
    // best effort — on nettoie toujours localement
  } finally {
    clearRestrictedSession();
    await clearSecureSession();
  }
}

export function changePassword(newPassword: string) {
  return request<{ user: LoginResponse["user"]; message: string; accessToken?: string }>(
    "/auth/change-password",
    {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    },
  ).then(async (response) => {
    const refresh = getRestrictedRefreshToken() ?? (await getRefreshToken());
    const access = response.accessToken ?? getRestrictedAccessToken();
    if (access) {
      await saveTokens(access, refresh);
    }
    clearRestrictedSession();
    return response;
  });
}

export async function getSchoolByCode(code: string) {
  const normalizedCode = code.trim().toUpperCase();
  try {
    return await request<SchoolInfo>(`/schools/${encodeURIComponent(normalizedCode)}`);
  } catch (error) {
    throw buildApiConnectionError(error);
  }
}

export async function identifyAccount(payload: { schoolCode: string; identifier: string }) {
  try {
    return await request<IdentifyResponse>("/identify", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw buildApiConnectionError(error);
  }
}

export function getHealth() {
  return request<{ status: string }>("/health");
}

export function getNotes() {
  return request<unknown>("/notes").then((payload) => unwrapList(payload).map(normalizeGrade));
}

export function getEvaluations() {
  return request<unknown>("/evaluations").then((payload) => unwrapList(payload).map(normalizeEvaluation));
}

export function createEvaluation(payload: Record<string, unknown>) {
  const body = stripEvaluationClientScope(payload);
  delete body.status;
  return request<CanonicalEvaluation>("/evaluations", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(normalizeEvaluation);
}

export function updateEvaluation(evaluationId: string, payload: Record<string, unknown>) {
  return request<CanonicalEvaluation>(`/evaluations/${encodeURIComponent(evaluationId)}`, {
    method: "PATCH",
    body: JSON.stringify(stripEvaluationClientScope(payload)),
  }).then(normalizeEvaluation);
}

export function getPresences() {
  return request<unknown[]>("/presences");
}

export function getStudents() {
  return request<unknown>("/students").then((payload) => unwrapList(payload) as StudentSummary[]);
}

export function getClasses() {
  return request<unknown[]>("/classes");
}

export function getCourses() {
  return request<unknown[]>("/courses");
}

export function getAssignments() {
  return request<unknown>("/assignments").then((payload) => unwrapList(payload) as TeacherAssignment[]);
}

export type SchoolSubject = {
  id?: string;
  code?: string;
  subjectCode?: string;
  name: string;
  status?: string;
};

export function getSubjects() {
  return request<SchoolSubject[] | { items: SchoolSubject[] }>("/v2/subjects");
}

export function createTeacherAssignment(payload: Partial<TeacherAssignment>) {
  const { schoolCode: _schoolCode, schoolId: _schoolId, academicYearId: _year, id: _id, ...canonical } =
    payload as Partial<TeacherAssignment> & Record<string, unknown>;
  return request<TeacherAssignment>("/assignments", {
    method: "POST",
    body: JSON.stringify(canonical),
  });
}

export function updateTeacherAssignment(id: string, payload: Partial<TeacherAssignment>) {
  const { schoolCode: _schoolCode, schoolId: _schoolId, academicYearId: _year, id: _id, ...canonical } =
    payload as Partial<TeacherAssignment> & Record<string, unknown>;
  return request<TeacherAssignment>(`/assignments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(canonical),
  });
}

export function deleteTeacherAssignment(id: string) {
  return request<{ id: string; deleted: boolean }>(`/assignments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function getCourseSchedules() {
  return request<unknown>("/course-schedules").then((payload) => unwrapList(payload));
}

export function getPayments() {
  return request<unknown>("/payments").then((payload) => unwrapList(payload).map(normalizePaymentRow));
}

export type CanonicalReportCard = {
  id: string;
  studentId: string;
  studentName?: string;
  className?: string;
  period?: string;
  status?: string;
  average?: number | null;
  rank?: number | null;
  publishedAt?: string | null;
};

export function getReportCards() {
  return request<unknown>("/report-cards").then((payload) =>
    unwrapList(payload).map((row) => {
      const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return {
        id: String(item.id ?? ""),
        studentId: String(item.studentId ?? item.student_id ?? ""),
        studentName: item.studentName ? String(item.studentName) : undefined,
        className: item.className ? String(item.className) : undefined,
        period: String(item.period ?? item.term ?? ""),
        status: String(item.status ?? ""),
        average: item.average == null || item.average === "" ? null : Number(item.average),
        rank: item.rank == null || item.rank === "" ? null : Number(item.rank),
        publishedAt: item.publishedAt ? String(item.publishedAt) : null,
      } satisfies CanonicalReportCard;
    }),
  );
}

export type CanonicalEvaluationType = {
  id: string;
  schoolCode: string;
  code: string;
  name: string;
  displayOrder: number;
  status: "active" | "archived";
};

export function getAcademicConfig() {
  return request<AcademicConfigPayload>("/academic-config");
}

export function getEvaluationTypes(includeArchived = false) {
  const query = includeArchived ? "?includeArchived=true" : "";
  return request<{ types: CanonicalEvaluationType[] }>(`/evaluation-types${query}`);
}

export function saveAcademicConfig(payload: AcademicConfigPayload) {
  return request<AcademicConfigPayload>("/academic-config", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function saveNote(payload: unknown) {
  const body =
    payload && typeof payload === "object"
      ? stripEvaluationClientScope(payload as Record<string, unknown>)
      : payload;
  return request<CanonicalGrade>("/notes", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(normalizeGrade);
}

export function savePresences(payload: unknown) {
  return request<unknown[]>("/presences", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getBackOfficeState() {
  return Promise.reject(
    Object.assign(new Error("La lecture globale BackOffice State a été supprimée."), {
      code: "BACKOFFICE_STATE_READ_REMOVED",
    }),
  );
}

export function saveBackOfficeState(_payload: BackOfficeStatePayload) {
  return Promise.reject(
    Object.assign(new Error("L'écriture globale BackOffice State a été supprimée."), {
      code: "BACKOFFICE_STATE_WRITE_REMOVED",
    }),
  );
}

export function createClientsAnnouncement(payload: Record<string, unknown>) {
  return request("/backoffice/announcements", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateClientsAnnouncement(announcementId: string, payload: Record<string, unknown>) {
  return request(`/backoffice/announcements/${encodeURIComponent(announcementId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function sendClientsMessage(payload: Record<string, unknown>) {
  return request("/backoffice/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createClientsUser(payload: Record<string, unknown>) {
  return request("/backoffice/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateClientsUser(userId: string, payload: Record<string, unknown>) {
  return request(`/backoffice/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function createPlatformNotification(payload: Record<string, unknown>) {
  return request("/backoffice/notifications", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePlatformNotification(notificationId: string, payload: Record<string, unknown>) {
  return request(`/backoffice/notifications/${encodeURIComponent(notificationId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function replacePlatformRolePermissions(_payload: Record<string, string[]>) {
  return Promise.reject(
    Object.assign(new Error("LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN"), {
      code: "LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN",
      status: 403,
    }),
  );
}

export function getEffectivePermissions() {
  return request<{ permissions?: string[] }>("/auth/effective-permissions", { method: "GET" });
}

export function createCourse(payload: Record<string, unknown>) {
  return request("/courses", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCourse(courseId: string, payload: Record<string, unknown>) {
  return request(`/courses/${encodeURIComponent(courseId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCourse(courseId: string) {
  return request(`/courses/${encodeURIComponent(courseId)}`, {
    method: "DELETE",
  });
}

export function createSchoolPayment(payload: Record<string, unknown>) {
  return request("/payments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function cancelSchoolPayment(paymentId: string, reason: string) {
  return request(`/payments/${encodeURIComponent(paymentId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function upsertFinancePaymentStatus(payload: Record<string, unknown>, statusId?: string) {
  if (statusId) {
    return request(`/finance/payment-statuses/${encodeURIComponent(statusId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }
  return request("/finance/payment-statuses", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetUserPassword(userId: string, temporaryPassword: string) {
  return request<{ temporaryPassword: string; user: unknown }>(
    `/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: "POST",
      body: JSON.stringify({ temporaryPassword }),
    },
  );
}

/** URL du bulletin PDF (sans JWT). */
export function getReportCardPdfUrl(studentId: string, period = "Trimestre 1") {
  return `${getApiBaseUrl()}/students/${encodeURIComponent(studentId)}/report.pdf?period=${encodeURIComponent(period)}`;
}

/**
 * S2.3 — Téléchargement sécurisé PDF.
 *
 * Adaptateur natif volontaire autour du client HTTP central (`httpClient`) :
 * `FileSystem.downloadAsync` écrit directement vers le cache et n'est pas
 * interchangeable avec `fetch` JSON. Les autres appels réseau doivent passer
 * par `httpRequest` / `httpUpload` — ne pas dupliquer ce pattern ailleurs.
 * Contrôles : Bearer, status 200 strict, MIME PDF/octet-stream, taille > 0.
 */
export async function downloadReportCardPdf(studentId: string, period = "Trimestre 1"): Promise<string> {
  const token = await getAccessToken();
  if (!token) {
    throw new ApiClientError("Authentification requise pour télécharger le bulletin PDF.");
  }

  const url = getReportCardPdfUrl(studentId, period);
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    throw new ApiClientError("Stockage local indisponible pour ouvrir le bulletin PDF.");
  }

  const safePeriod = period.replace(/[^\w.-]+/g, "-").toLowerCase();
  const target = `${cacheDir}bulletin-${studentId}-${safePeriod}.pdf`;
  // Exception documentée : adaptateur FileSystem (voir JSDoc ci-dessus).
  const result = await FileSystem.downloadAsync(url, target, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (result.status !== 200) {
    throw new ApiClientError(
      result.status === 401 || result.status === 403
        ? "Accès refusé au bulletin PDF."
        : "Impossible de télécharger le bulletin PDF.",
    );
  }

  const mime = String(result.mimeType ?? "").toLowerCase();
  if (mime && !mime.includes("pdf") && !mime.includes("octet-stream")) {
    throw new ApiClientError("Type de fichier PDF invalide.");
  }

  const info = await FileSystem.getInfoAsync(result.uri);
  const size = "size" in info ? Number(info.size ?? 0) : 0;
  if (!info.exists || size <= 0) {
    throw new ApiClientError("Bulletin PDF vide ou illisible.");
  }

  return result.uri;
}

/**
 * Upload sécurisé : MIME + taille validés avant FormData (impossible de contourner).
 * HTTPS + Authorization via httpClient.
 */
export function uploadSecureFile(
  path: string,
  file: SecureUploadFile,
  options?: SecureUploadRequestOptions,
) {
  return httpUpload(path, file, options);
}

export type { SecureUploadFile };

function buildApiConnectionError(error: unknown) {
  if (error instanceof ApiClientError) {
    return error;
  }
  const reason = sanitizeUserFacingError(error, "Connexion API impossible");
  if (isUsingLocalhostOnDevice()) {
    return new ApiClientError(
      `${reason} Configurez EXPO_PUBLIC_API_URL vers l'IP de votre machine, puis reconstruisez l'application.`,
    );
  }
  try {
    resolveApiRootUrl();
  } catch {
    // ignore
  }
  return new ApiClientError(reason);
}

export { ApiClientError };
