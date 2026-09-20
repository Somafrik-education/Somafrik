import * as FileSystem from "expo-file-system/legacy";
import { UserRole } from "../navigation/AppNavigator";
import { isUsingLocalhostOnDevice, resolveApiBaseUrl, resolveApiRootUrl } from "../config/env";
import {
  ApiClientError,
  httpRequest,
  httpUpload,
  type HttpRequestOptions,
  type SecureUploadFile,
  type SecureUploadRequestOptions,
} from "./httpClient";
import { revokeCurrentPushDevice } from "./pushNotifications";
import { sanitizeUserFacingError } from "./safeLogger";
import {
  clearSecureSession,
  getAccessToken,
  getRefreshToken,
  saveEffectivePermissionsSnapshot,
  saveSessionProfile,
  saveTokens,
} from "./secureStorage";
import { canPersistFullSession, normalizePaymentRow, unwrapList } from "../lib/dataTruth";
import { buildEffectivePermissionsSnapshotV1 } from "../lib/offlinePermissionsSnapshot";
import {
  normalizeEvaluation,
  normalizeGrade,
  stripEvaluationClientScope,
  type CanonicalEvaluation,
  type CanonicalGrade,
} from "../lib/evaluationsV2";
import {
  assertNoLegacyPlanningIdentity,
  buildCreateReplacementPayload,
  buildCreateWeeklySlotPayload,
  buildUpdateWeeklySlotPayload,
  normalizePlanningCourseOption,
  normalizeReplacement,
  normalizeReplacementTeacherOption,
  normalizeSchoolRoom,
  normalizeWeeklySlot,
  unwrapPlanningList,
  type CanonicalReplacement,
  type CanonicalSchoolRoom,
  type CanonicalWeeklySlot,
  type PlanningCourseOption,
  type ReplacementTeacherOption,
  type ReplacementWriteInput,
  type WeeklySlotWriteInput,
} from "../lib/planningV2";
import {
  beginRestrictedSession,
  clearRestrictedSession,
  getRestrictedAccessToken,
  getRestrictedRefreshToken,
} from "../lib/restrictedSession";
import {
  clearRequestSchoolScope,
  getRequestSchoolScope,
  publicRequestSchoolScope,
} from "../lib/requestSchoolScope";
import { clearStoredSchoolCode } from "../lib/activeSchool";
import { attachStudentTenantIdentity } from "../lib/studentsScope";
import {
  hasCommunicationSchoolScope,
  resolveCommunicationSchoolScope,
  withCommunicationSchoolPayload,
  withCommunicationSchoolScope,
} from "../lib/communicationSchoolScope";
import { normalizeUnpaidLedger, type UnpaidLedger } from "../lib/unpaidLedger";

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
  lastName?: string;
  matricule: string;
  gender?: string;
  birthDate?: string;
  classId?: string | null;
  classCode?: string;
  className: string;
  schoolId?: string;
  schoolPublicCode?: string;
  schoolCode: string;
  parentName?: string;
  parentPhone: string;
  parentEmail?: string;
  archived?: boolean;
  status?: string;
  updatedAt?: string;
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
  schoolCode?: string;
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
  hasLogo?: boolean;
  logoSource?: string;
  logoUploadedAt?: string;
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
  roleLabel?: string;
  roleKey?: string;
  roleKeys?: string[];
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
    schoolId?: string;
    schoolPublicCode?: string;
    schoolCode?: string;
    scopeLevel?: string;
    countryScope?: string;
    countryCode?: string;
    role?: string;
    roleKey?: string;
    roleKeys?: string[];
    roles?: string[];
    permissions?: string[];
    mustChangePassword?: boolean;
    parentPhone?: string;
    children?: StudentSummary[];
    phone?: string;
    assignments?: TeacherAssignment[];
    assignedClasses?: string[];
    courses?: string[];
    accountKind?: string;
    linkedStudent?: { studentId?: string; studentCode?: string; status?: string } | null;
  };
  school?: SchoolInfo;
  platformContext?: {
    kind: "global" | "country";
    countryCode?: string;
  };
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
    roleKeys: safeSession.roleKeys,
    permissions: safeSession.permissions,
    user: safeSession.user as unknown as Record<string, unknown>,
    ...(safeSession.school
      ? { school: safeSession.school as unknown as Record<string, unknown> }
      : {}),
  });
  const snapshot = Array.isArray(safeSession.permissions)
    ? buildEffectivePermissionsSnapshotV1({
        session: safeSession,
        permissions: safeSession.permissions,
        roleKeys: Array.isArray(safeSession.roleKeys) ? safeSession.roleKeys : safeSession.user?.roleKeys,
      })
    : null;
  if (snapshot) {
    await saveEffectivePermissionsSnapshot(JSON.stringify(snapshot));
  }
  return safeSession;
}

export async function hasActiveAccessToken() {
  return Boolean(await getAccessToken());
}

export type MutationRequestOptions = {
  idempotencyKey?: string;
};

async function request<T>(path: string, options?: HttpRequestOptions): Promise<T> {
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
    await revokeCurrentPushDevice();
  } catch {
    // best effort — le logout local ne doit pas être bloqué
  }
  try {
    await request<{ message: string }>("/auth/logout", {
      method: "POST",
    });
  } catch {
    // best effort — on nettoie toujours localement
  } finally {
    clearRequestSchoolScope();
    clearStoredSchoolCode();
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

export type CanonicalExam = {
  id: string;
  name: string;
  className?: string;
  subject?: string;
  examType?: string;
  date?: string;
  period?: string;
  status?: string;
  statusCode?: string;
};

function normalizeExam(row: Record<string, unknown>): CanonicalExam {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    className: row.className != null ? String(row.className) : undefined,
    subject: row.subject != null ? String(row.subject) : undefined,
    examType: row.examType != null ? String(row.examType) : undefined,
    date: row.date != null ? String(row.date) : undefined,
    period: row.period != null ? String(row.period) : undefined,
    status: row.status != null ? String(row.status) : undefined,
    statusCode: row.statusCode != null ? String(row.statusCode) : undefined,
  };
}

export function listExams() {
  return request<{ exams?: unknown[] }>("/exams").then((payload) =>
    (Array.isArray(payload?.exams) ? payload.exams : unwrapList(payload)).map((row) =>
      normalizeExam(row as Record<string, unknown>),
    ),
  );
}

export function getExam(examId: string) {
  return request<Record<string, unknown>>(`/exams/${encodeURIComponent(examId)}`).then((row) =>
    normalizeExam(row),
  );
}

export function createExam(payload: Record<string, unknown>, options?: MutationRequestOptions) {
  const body = { ...payload };
  delete body.schoolId;
  delete body.schoolCode;
  return request<Record<string, unknown>>("/exams", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: options?.idempotencyKey,
  }).then((row) => normalizeExam(row));
}

export function patchExam(examId: string, payload: Record<string, unknown>, options?: MutationRequestOptions) {
  const body = { ...payload };
  delete body.schoolId;
  delete body.schoolCode;
  return request<Record<string, unknown>>(`/exams/${encodeURIComponent(examId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    idempotencyKey: options?.idempotencyKey,
  }).then((row) => normalizeExam(row));
}

export function validateExam(examId: string, options?: MutationRequestOptions) {
  return request<Record<string, unknown>>(`/exams/${encodeURIComponent(examId)}/validate`, {
    method: "POST",
    body: JSON.stringify({}),
    idempotencyKey: options?.idempotencyKey,
  }).then((row) => normalizeExam(row));
}

export function cancelExam(examId: string, options?: MutationRequestOptions) {
  return request<Record<string, unknown>>(`/exams/${encodeURIComponent(examId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
    idempotencyKey: options?.idempotencyKey,
  }).then((row) => normalizeExam(row));
}

export function archiveExam(examId: string, options?: MutationRequestOptions) {
  return request<Record<string, unknown>>(`/exams/${encodeURIComponent(examId)}/archive`, {
    method: "POST",
    body: JSON.stringify({}),
    idempotencyKey: options?.idempotencyKey,
  }).then((row) => normalizeExam(row));
}

export function getEvaluations() {
  return request<unknown>("/evaluations").then((payload) => unwrapList(payload).map(normalizeEvaluation));
}

export function createEvaluation(payload: Record<string, unknown>, options?: MutationRequestOptions) {
  const body = stripEvaluationClientScope(payload);
  delete body.status;
  return request<CanonicalEvaluation>("/evaluations", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: options?.idempotencyKey,
  }).then(normalizeEvaluation);
}

export function updateEvaluation(
  evaluationId: string,
  payload: Record<string, unknown>,
  options?: MutationRequestOptions,
) {
  return request<CanonicalEvaluation>(`/evaluations/${encodeURIComponent(evaluationId)}`, {
    method: "PATCH",
    body: JSON.stringify(stripEvaluationClientScope(payload)),
    idempotencyKey: options?.idempotencyKey,
  }).then(normalizeEvaluation);
}

export function getPresences() {
  return request<unknown[]>("/presences");
}

export function getStudents() {
  return request<unknown>("/students").then(
    (payload) =>
      unwrapList(payload).map((row) =>
        attachStudentTenantIdentity((row && typeof row === "object" ? row : {}) as Record<string, unknown>),
      ) as StudentSummary[],
  );
}

export function getSchoolStudent(studentId: string) {
  return request<Record<string, unknown>>(`/students/${encodeURIComponent(studentId)}`).then((row) =>
    attachStudentTenantIdentity((row && typeof row === "object" ? row : {}) as Record<string, unknown>),
  );
}

export type C18Enrollment = {
  id: string;
  studentId?: string;
  status?: string;
  classId?: string | null;
  classCode?: string;
  className?: string;
  academicYearName?: string;
  enrollmentDate?: string;
};

function c18EnrollmentPath(studentId: string, enrollmentId: string, action: string) {
  return `/students/${encodeURIComponent(studentId)}/enrollments/${encodeURIComponent(enrollmentId)}/${action}`;
}

export function listStudentEnrollments(studentId: string) {
  return request<{ items?: C18Enrollment[] } | C18Enrollment[]>(
    `/students/${encodeURIComponent(studentId)}/enrollments`,
  ).then((payload) => (Array.isArray(payload) ? payload : payload?.items ?? []));
}

export function validateStudentEnrollment(studentId: string, enrollmentId: string, body: { reason?: string } = {}) {
  return request<C18Enrollment>(c18EnrollmentPath(studentId, enrollmentId, "validate"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function assignStudentEnrollmentClass(
  studentId: string,
  enrollmentId: string,
  body: { classCode?: string; classId?: string; effectiveDate?: string },
) {
  return request<C18Enrollment>(c18EnrollmentPath(studentId, enrollmentId, "assign-class"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function transferStudentEnrollment(
  studentId: string,
  enrollmentId: string,
  body: { destinationSchoolName: string; reason?: string },
) {
  return request<C18Enrollment>(c18EnrollmentPath(studentId, enrollmentId, "transfer"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function closeStudentEnrollment(studentId: string, enrollmentId: string, body: { reason?: string } = {}) {
  return request<C18Enrollment>(c18EnrollmentPath(studentId, enrollmentId, "close"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getParentRelations(studentId: string) {
  return request<{ items?: Record<string, unknown>[] } | Record<string, unknown>[]>(
    `/parents/relations?studentId=${encodeURIComponent(studentId)}`,
  ).then((payload) => (Array.isArray(payload) ? payload : payload?.items ?? []));
}

export function lookupParentIdentity(query: { phone?: string; email?: string }) {
  const params = new URLSearchParams();
  if (query.phone) params.set("phone", query.phone);
  if (query.email) params.set("email", query.email);
  const suffix = params.toString();
  return request<Record<string, unknown>>(`/parents/identity${suffix ? `?${suffix}` : ""}`);
}

export function linkParent(payload: {
  studentId: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
}) {
  return request<Record<string, unknown>>("/parents/link", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function archiveParentRelation(relationId: string) {
  return request<Record<string, unknown>>(`/parents/relations/${encodeURIComponent(relationId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "archived" }),
  });
}

export type PaymentStudentOption = {
  studentId: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  classId?: string | null;
  classCode?: string;
  className?: string;
  schoolCode?: string;
  classes?: Array<{ classId: string; classCode?: string; className?: string }>;
};

export type FinanceCatalog = {
  currency?: string;
  paymentMethods?: Array<{ methodCode: string; label: string; active: boolean }>;
  feeTypeCatalog?: Array<{ code: string; feeType: string; label: string; active: boolean }>;
  canonicalFeeTypes?: Array<{ feeType: string; label: string; code?: string }>;
};

export function getPaymentStudentOptions() {
  return request<unknown>("/finance/payment-student-options").then(
    (payload) => unwrapList(payload) as PaymentStudentOption[],
  );
}

export function getFinanceCatalog() {
  return request<FinanceCatalog>("/finance/catalog");
}

export function getClasses() {
  return request<unknown[]>("/classes");
}

export type AcademicYearOption = {
  id: string;
  name: string;
  schoolCode?: string;
  isCurrent?: boolean;
};

export type EducationCatalogLevel = {
  id: string;
  name: string;
  schoolActive?: boolean;
};

export type EducationCatalogStream = {
  id: string;
  name: string;
  levelId?: string | null;
  streamType?: "filiere" | "serie" | "option" | string;
  schoolActive?: boolean;
};

export type EducationCatalogGroup = {
  id: string;
  name: string;
  code?: string;
  schoolActive?: boolean;
};

export type EducationSchoolCatalog = {
  schoolCode?: string;
  countryCode?: string;
  labels?: { levelLabel?: string; trackLabel?: string; groupLabel?: string };
  levels: EducationCatalogLevel[];
  streams: EducationCatalogStream[];
  groups: EducationCatalogGroup[];
};

export function getAcademicYears() {
  return request<unknown>("/v2/academic-years").then((payload) => unwrapList(payload) as AcademicYearOption[]);
}

export function getEducationCatalog() {
  return request<EducationSchoolCatalog>("/education-reference/catalog");
}

export function createSchoolClass(payload: {
  academicYearId: string;
  levelId: string;
  streamId?: string | null;
  groupId: string;
  status?: "active" | "inactive";
}) {
  return request<Record<string, unknown>>("/classes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateSchoolClass(
  classCode: string,
  payload: {
    levelId?: string;
    streamId?: string | null;
    groupId?: string;
    status?: "active" | "inactive";
  },
) {
  return request<Record<string, unknown>>(`/classes/${encodeURIComponent(classCode)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type HeadTeacherCandidate = {
  teacherCode: string;
  firstName: string;
  lastName: string;
  displayName: string;
  assignedToCurrentClass?: boolean;
  otherClassNames?: string[];
  alreadyHeadTeacherHint?: string;
};

export function listClassHeadTeacherCandidates(classCode: string, q?: string) {
  const query = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return request<HeadTeacherCandidate[]>(
    `/classes/${encodeURIComponent(classCode)}/head-teacher/candidates${query}`,
  );
}

export function assignClassHeadTeacher(classCode: string, teacherCode: string) {
  return request<Record<string, unknown>>(`/classes/${encodeURIComponent(classCode)}/head-teacher`, {
    method: "PUT",
    body: JSON.stringify({ teacherCode }),
  });
}

export function removeClassHeadTeacher(classCode: string) {
  return request<Record<string, unknown>>(`/classes/${encodeURIComponent(classCode)}/head-teacher`, {
    method: "DELETE",
  });
}

export function enrollClassStudent(
  classCode: string,
  payload: {
    firstName: string;
    lastName: string;
    gender?: string;
    birthDate?: string;
    parentPhone?: string;
    parentEmail?: string;
  },
) {
  return request<{
    student?: Record<string, unknown>;
    credentials?: { login?: string; temporarySecret?: string };
  }>(`/classes/${encodeURIComponent(classCode)}/students`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateSchoolStudent(studentId: string, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(`/students/${encodeURIComponent(studentId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteSchoolStudent(studentId: string) {
  return request(`/students/${encodeURIComponent(studentId)}`, { method: "DELETE" });
}

/** POST /teachers est 403 (`TEACHER_IDENTITY_MUST_COME_FROM_USERS`). Ne pas appeler depuis l'UI. */
export function createSchoolTeacher(payload: {
  firstName: string;
  lastName: string;
  gender?: string;
  birthDate: string;
  entryDate?: string;
  phone?: string;
  email?: string;
  speciality?: string;
  temporaryPassword: string;
}) {
  return request<Record<string, unknown>>("/teachers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateSchoolTeacher(teacherCode: string, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(`/teachers/${encodeURIComponent(teacherCode)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteSchoolTeacher(teacherCode: string) {
  return request(`/teachers/${encodeURIComponent(teacherCode)}`, { method: "DELETE" });
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
  return request<unknown>("/v2/subjects").then((payload) => unwrapList(payload) as SchoolSubject[]);
}

export type TeacherAssignmentWritePayload = {
  teacherCode?: string;
  teacherId?: string;
  classCode?: string;
  className?: string;
  subjectCode?: string;
  subject?: string;
  course?: string;
  assignmentRole?: string;
};

export function createTeacherAssignment(payload: TeacherAssignmentWritePayload) {
  const { schoolCode: _schoolCode, schoolId: _schoolId, academicYearId: _year, id: _id, ...canonical } =
    payload as TeacherAssignmentWritePayload & Record<string, unknown>;
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

export function getPlanningWeekly(): Promise<CanonicalWeeklySlot[]> {
  return request<unknown>("/course-schedules").then((payload) =>
    unwrapPlanningList(payload)
      .map(normalizeWeeklySlot)
      .filter((row): row is CanonicalWeeklySlot => Boolean(row)),
  );
}

/** @deprecated LOT 3 — utiliser getPlanningWeekly (contrat weekly V2). */
export function getCourseSchedules() {
  return getPlanningWeekly();
}

export function getPlanningCourseOptions(): Promise<PlanningCourseOption[]> {
  return request<unknown>("/course-schedules?projection=planning-course-options").then((payload) =>
    unwrapPlanningList(payload)
      .map(normalizePlanningCourseOption)
      .filter((row): row is PlanningCourseOption => Boolean(row)),
  );
}

export function createCourseSchedule(input: WeeklySlotWriteInput, options?: MutationRequestOptions) {
  const body = buildCreateWeeklySlotPayload(input);
  assertNoLegacyPlanningIdentity(body);
  return request<unknown>("/course-schedules", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: options?.idempotencyKey,
  }).then(normalizeWeeklySlot);
}

export function updateCourseSchedule(scheduleId: string, input: Partial<WeeklySlotWriteInput> & { roomId?: string | null }) {
  const body = buildUpdateWeeklySlotPayload(input);
  assertNoLegacyPlanningIdentity(body);
  return request<unknown>(`/course-schedules/${encodeURIComponent(scheduleId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }).then(normalizeWeeklySlot);
}

export function deleteCourseSchedule(scheduleId: string) {
  return request<{ id?: string; deleted?: boolean }>(`/course-schedules/${encodeURIComponent(scheduleId)}`, {
    method: "DELETE",
  });
}

export function getSchoolRooms(): Promise<CanonicalSchoolRoom[]> {
  return request<unknown>("/school-rooms").then((payload) =>
    unwrapPlanningList(payload)
      .map(normalizeSchoolRoom)
      .filter((row): row is CanonicalSchoolRoom => Boolean(row)),
  );
}

export function getCourseScheduleReplacements(): Promise<CanonicalReplacement[]> {
  return request<unknown>("/course-schedule-replacements").then((payload) =>
    unwrapPlanningList(payload)
      .map(normalizeReplacement)
      .filter((row): row is CanonicalReplacement => Boolean(row)),
  );
}

export function getReplacementTeacherOptions(
  weeklySlotId: string,
  occurrenceDate: string,
): Promise<ReplacementTeacherOption[]> {
  const query = `weeklySlotId=${encodeURIComponent(weeklySlotId)}&occurrenceDate=${encodeURIComponent(occurrenceDate)}`;
  return request<unknown>(`/course-schedule-replacements/options?${query}`).then((payload) =>
    unwrapPlanningList(payload)
      .map(normalizeReplacementTeacherOption)
      .filter((row): row is ReplacementTeacherOption => Boolean(row)),
  );
}

export function createCourseScheduleReplacement(input: ReplacementWriteInput, options?: MutationRequestOptions) {
  const body = buildCreateReplacementPayload(input);
  return request<unknown>("/course-schedule-replacements", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: options?.idempotencyKey,
  }).then(normalizeReplacement);
}

export function deleteCourseScheduleReplacement(replacementId: string) {
  return request<{ id?: string; deleted?: boolean }>(
    `/course-schedule-replacements/${encodeURIComponent(replacementId)}`,
    { method: "DELETE" },
  );
}

export function getPayments() {
  return request<unknown>("/payments").then((payload) => unwrapList(payload).map(normalizePaymentRow));
}

/** Ledger canonique des créances, agrégé et scopé côté serveur par établissement. */
export function getUnpaidLedger(
  requestedSchoolCode?: string | null,
  filters?: { period?: string | null },
): Promise<UnpaidLedger> {
  const period = String(filters?.period ?? "").trim();
  const query = period ? `?period=${encodeURIComponent(period)}` : "";
  return request<unknown>(`/backoffice/finance/unpaid${query}`).then((payload) =>
    normalizeUnpaidLedger(payload, publicRequestSchoolScope(requestedSchoolCode)),
  );
}

export function createUnpaidReminder(
  studentId: string,
  payload: Record<string, unknown>,
  options?: MutationRequestOptions,
) {
  return request(`/backoffice/finance/unpaid/${encodeURIComponent(studentId)}/reminders`, {
    method: "POST",
    body: JSON.stringify(payload),
    idempotencyKey: options?.idempotencyKey,
  });
}

export type FinanceFeeGrid = {
  id: string;
  schoolCode?: string;
  className?: string;
  academicYear?: string;
  periodName?: string;
  currency?: string;
  status?: string;
};

export type FinanceFeeGridItem = {
  id: string;
  feeType?: string;
  label?: string;
  amount: number;
  currency?: string;
  mandatory: boolean;
  dueDate?: string;
  status?: string;
};

function normalizeFeeGrid(value: unknown): FinanceFeeGrid | null {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const id = String(row.id ?? row.grid_code ?? "").trim();
  if (!id) return null;
  return {
    id,
    schoolCode: String(row.schoolCode ?? row.school_code ?? "").trim() || undefined,
    className: String(row.className ?? row.class_name ?? "").trim() || undefined,
    academicYear: String(row.academicYear ?? row.academic_year ?? "").trim() || undefined,
    periodName: String(row.periodName ?? row.period_name ?? "").trim() || undefined,
    currency: String(row.currency ?? "").trim() || undefined,
    status: String(row.status ?? "").trim() || undefined,
  };
}

function normalizeFeeGridItem(value: unknown, currency?: string): FinanceFeeGridItem | null {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const id = String(row.id ?? row.item_code ?? "").trim();
  if (!id) return null;
  const amount = Number(row.amount ?? 0);
  return {
    id,
    feeType: String(row.feeType ?? row.fee_type ?? "").trim() || undefined,
    label: String(row.label ?? "").trim() || undefined,
    amount: Number.isFinite(amount) ? amount : 0,
    currency: String(row.currency ?? currency ?? "").trim() || undefined,
    mandatory: row.mandatory !== false,
    dueDate: String(row.dueDate ?? row.due_date ?? "").trim() || undefined,
    status: String(row.status ?? "").trim() || undefined,
  };
}

export function listFeeGrids(): Promise<FinanceFeeGrid[]> {
  return request<unknown>("/finance/fee-grids").then((payload) =>
    unwrapList(payload)
      .map(normalizeFeeGrid)
      .filter((row): row is FinanceFeeGrid => Boolean(row)),
  );
}

export function getFeeGrid(gridId: string): Promise<{ grid: FinanceFeeGrid | null; items: FinanceFeeGridItem[] }> {
  return request<unknown>(`/finance/fee-grids/${encodeURIComponent(gridId)}`).then((payload) => {
    const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const grid = normalizeFeeGrid(body.grid ?? payload);
    const items = unwrapList(Array.isArray(body.items) ? body.items : body).map((item) =>
      normalizeFeeGridItem(item, grid?.currency),
    );
    return {
      grid,
      items: items.filter((row): row is FinanceFeeGridItem => Boolean(row)),
    };
  });
}

export type CanonicalStudentFee = {
  id: string;
  studentId: string;
  studentDbId?: string;
  studentName?: string;
  schoolCode?: string;
  amountDue: number;
  amountPaid: number;
  exemption: number;
  balance: number;
  status: string;
  archivedAt?: string | null;
  feeType?: string;
  label?: string;
  schoolFeeItemId?: string;
  currency?: string;
};

function normalizeStudentFeeRow(raw: unknown): CanonicalStudentFee {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const amountDue = Number(row.amountDue ?? row.amount_due ?? 0);
  const amountPaid = Number(row.amountPaid ?? row.amount_paid ?? 0);
  const exemption = Number(row.exemption ?? 0);
  const studentDbId = String(row.studentDbId ?? row.student_db_id ?? "").trim();
  return {
    id: String(row.id ?? row.publicId ?? ""),
    studentId: String(row.studentId ?? row.student_id ?? ""),
    ...(studentDbId ? { studentDbId } : {}),
    studentName: row.studentName ? String(row.studentName) : undefined,
    schoolCode: row.schoolCode ? String(row.schoolCode) : undefined,
    amountDue,
    amountPaid,
    exemption,
    balance: Number(row.balance),
    status: String(row.status ?? ""),
    archivedAt: row.archivedAt ? String(row.archivedAt) : row.archived_at ? String(row.archived_at) : null,
    feeType: row.feeType ? String(row.feeType) : undefined,
    label: String(row.label ?? row.feeType ?? "").trim() || undefined,
    schoolFeeItemId: row.schoolFeeItemId ? String(row.schoolFeeItemId) : row.school_fee_item_id ? String(row.school_fee_item_id) : undefined,
    currency: String(row.currency ?? "").trim(),
  };
}

export function getStudentFees() {
  return request<unknown>("/finance/student-fees").then((payload) =>
    unwrapList(payload).map(normalizeStudentFeeRow),
  );
}

export function reconcilePaymentAllocations() {
  return request<{ created?: number; leftoverTotal?: number }>("/finance/reconcile-payment-allocations", {
    method: "POST",
    body: JSON.stringify({}),
  });
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

export function saveNote(payload: unknown, options?: MutationRequestOptions) {
  const body =
    payload && typeof payload === "object"
      ? stripEvaluationClientScope(payload as Record<string, unknown>)
      : payload;
  return request<CanonicalGrade>("/notes", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: options?.idempotencyKey,
  }).then(normalizeGrade);
}

export function savePresences(payload: unknown, options?: MutationRequestOptions) {
  return request<unknown[]>("/presences", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotencyKey: options?.idempotencyKey,
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

export function createClientsAnnouncement(payload: Record<string, unknown>, options?: MutationRequestOptions) {
  const schoolCode = communicationSchoolScope(
    typeof payload.effectiveSchoolCode === "string" ? payload.effectiveSchoolCode : undefined,
  );
  return request(scopedMessagesPath("/backoffice/announcements", schoolCode), {
    method: "POST",
    body: JSON.stringify(withCommunicationSchoolPayload(payload, schoolCode)),
    idempotencyKey: options?.idempotencyKey,
  });
}

export function updateClientsAnnouncement(announcementId: string, payload: Record<string, unknown>) {
  const schoolCode = communicationSchoolScope(
    typeof payload.effectiveSchoolCode === "string" ? payload.effectiveSchoolCode : undefined,
  );
  return request(scopedMessagesPath(`/backoffice/announcements/${encodeURIComponent(announcementId)}`, schoolCode), {
    method: "PATCH",
    body: JSON.stringify(withCommunicationSchoolPayload(payload, schoolCode)),
  });
}

export async function getAnnouncementAudienceOptions(schoolCode?: string): Promise<{
  classes: Array<{ id: string; code: string; name: string }>;
  recipientKinds: Array<{ id: string; label: string }>;
}> {
  const data = await request<{
    classes?: Array<{ id: string; code: string; name: string }>;
    recipientKinds?: Array<{ id: string; label: string }>;
  }>(scopedMessagesPath("/backoffice/announcements/audience-options", schoolCode));
  return {
    classes: Array.isArray(data?.classes) ? data.classes : [],
    recipientKinds: Array.isArray(data?.recipientKinds) ? data.recipientKinds : [],
  };
}

export async function getAnnouncementsUnreadCount(schoolCode?: string): Promise<number> {
  const scope = communicationSchoolScope(schoolCode);
  const [school, platform] = await Promise.all([
    hasCommunicationSchoolScope(scope)
      ? request<{ count?: number }>(scopedMessagesPath("/backoffice/announcements/unread-count", scope))
      : Promise.resolve({ count: 0 }),
    request<{ count?: number }>("/backoffice/platform-announcements/unread-count"),
  ]);
  return (Number(school?.count) || 0) + (Number(platform?.count) || 0);
}

export function createPlatformAnnouncement(payload: Record<string, unknown>, options?: MutationRequestOptions) {
  return request("/backoffice/platform-announcements", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotencyKey: options?.idempotencyKey,
  });
}

export async function uploadPlatformAnnouncementAttachment(file: {
  uri: string;
  name: string;
  mimeType: string;
}): Promise<{ id: string; fileName: string; mimeType?: string; fileSize?: number }> {
  const token = await getAccessToken();
  const root = resolveApiRootUrl().replace(/\/$/, "");
  const blob = await (await fetch(file.uri)).blob();
  const response = await fetch(`${root}/api/backoffice/platform-announcements/attachments`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": file.mimeType || "application/octet-stream",
      "X-Filename": file.name,
    },
    body: blob,
  });
  const data = (await response.json().catch(() => ({}))) as { message?: string; id?: string };
  if (!response.ok || !data.id) {
    throw new ApiClientError(String(data.message ?? "Échec de l'upload"));
  }
  return data as { id: string; fileName: string; mimeType?: string; fileSize?: number };
}

export async function uploadAnnouncementAttachment(
  file: {
    uri: string;
    name: string;
    mimeType: string;
  },
  schoolCode?: string,
): Promise<{ id: string; fileName: string; mimeType?: string; fileSize?: number }> {
  const token = await getAccessToken();
  const root = resolveApiRootUrl().replace(/\/$/, "");
  const blob = await (await fetch(file.uri)).blob();
  const response = await fetch(
    scopedMessagesPath(`${root}/api/backoffice/announcements/attachments`, schoolCode),
    {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": file.mimeType || "application/octet-stream",
        "X-Filename": file.name,
      },
      body: blob,
    },
  );
  const data = (await response.json().catch(() => ({}))) as { message?: string; id?: string };
  if (!response.ok || !data.id) {
    throw new ApiClientError(String(data.message ?? "Échec de l'upload"));
  }
  return data as { id: string; fileName: string; mimeType?: string; fileSize?: number };
}

function communicationSchoolScope(explicit?: string | null): string {
  return resolveCommunicationSchoolScope(explicit) || resolveCommunicationSchoolScope(getRequestSchoolScope());
}

function scopedMessagesPath(path: string, schoolCode?: string | null): string {
  return withCommunicationSchoolScope(path, communicationSchoolScope(schoolCode));
}

export function sendClientsMessage(payload: Record<string, unknown>, options?: MutationRequestOptions) {
  const schoolCode = communicationSchoolScope(
    typeof payload.effectiveSchoolCode === "string" ? payload.effectiveSchoolCode : undefined,
  );
  return request(scopedMessagesPath("/backoffice/messages", schoolCode), {
    method: "POST",
    body: JSON.stringify(withCommunicationSchoolPayload(payload, schoolCode)),
    idempotencyKey: options?.idempotencyKey,
  });
}

export function replyClientsConversationMessage(
  conversationId: string,
  payload: Record<string, unknown>,
  options?: MutationRequestOptions,
) {
  const id = String(conversationId ?? "").trim();
  if (!id) {
    return Promise.reject(new ApiClientError("Conversation requise."));
  }
  const schoolCode = communicationSchoolScope(
    typeof payload.effectiveSchoolCode === "string" ? payload.effectiveSchoolCode : undefined,
  );
  return request(
    scopedMessagesPath(`/backoffice/conversations/${encodeURIComponent(id)}/messages`, schoolCode),
    {
      method: "POST",
      body: JSON.stringify(withCommunicationSchoolPayload(payload, schoolCode)),
      idempotencyKey: options?.idempotencyKey,
    },
  );
}

export type CanonicalMessageRecipient = {
  userId: string;
  displayName: string;
  roleLabel?: string;
  kind?: string;
  studentId?: string;
  studentName?: string;
  className?: string;
};

export async function getMessageRecipients(schoolCode?: string): Promise<CanonicalMessageRecipient[]> {
  const data = await request<{ items?: CanonicalMessageRecipient[] } | CanonicalMessageRecipient[]>(
    scopedMessagesPath("/backoffice/messages/recipients", schoolCode),
  );
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.items) ? data.items : [];
}

export async function uploadCommunicationAttachment(
  file: {
    uri: string;
    name: string;
    mimeType: string;
  },
  schoolCode?: string,
): Promise<{ id: string; fileName: string; mimeType?: string; fileSize?: number }> {
  const token = await getAccessToken();
  const root = resolveApiRootUrl().replace(/\/$/, "");
  const blob = await (await fetch(file.uri)).blob();
  const response = await fetch(
    scopedMessagesPath(`${root}/api/backoffice/communications/attachments`, schoolCode),
    {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": file.mimeType || "application/octet-stream",
        "X-Filename": file.name,
      },
      body: blob,
    },
  );
  const data = (await response.json().catch(() => ({}))) as { message?: string; id?: string };
  if (!response.ok || !data.id) {
    throw new ApiClientError(String(data.message ?? "Échec de l'upload"));
  }
  return data as { id: string; fileName: string; mimeType?: string; fileSize?: number };
}

export async function downloadCommunicationAttachment(
  attachmentId: string,
  fileName: string,
  schoolCode?: string,
): Promise<string> {
  const token = await getAccessToken();
  const root = resolveApiRootUrl().replace(/\/$/, "");
  const target = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ""}${fileName}`;
  const result = await FileSystem.downloadAsync(
    scopedMessagesPath(
      `${root}/api/backoffice/communications/attachments/${encodeURIComponent(attachmentId)}`,
      schoolCode,
    ),
    target,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (result.status !== 200) {
    throw new ApiClientError("Téléchargement refusé");
  }
  return result.uri;
}

export async function downloadPlatformAnnouncementAttachment(
  attachmentId: string,
  fileName: string,
): Promise<string> {
  const token = await getAccessToken();
  const root = resolveApiRootUrl().replace(/\/$/, "");
  const target = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ""}${fileName}`;
  const result = await FileSystem.downloadAsync(
    `${root}/api/backoffice/platform-announcements/attachments/${encodeURIComponent(attachmentId)}`,
    target,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (result.status !== 200) {
    throw new ApiClientError("Téléchargement refusé");
  }
  return result.uri;
}

export function createClientsUser(payload: Record<string, unknown>) {
  return request<Record<string, unknown>>("/backoffice/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function grantClientsUserRole(userId: string, role: string) {
  return request<Record<string, unknown>>(`/backoffice/users/${encodeURIComponent(userId)}/roles/grant`, {
    method: "POST",
    body: JSON.stringify({ role }),
  });
}

export function revokeClientsUserRole(userId: string, role: string) {
  return request<Record<string, unknown>>(`/backoffice/users/${encodeURIComponent(userId)}/roles/revoke`, {
    method: "POST",
    body: JSON.stringify({ role }),
  });
}

export function createTeacherIdentityFromUsers(payload: {
  firstName: string;
  lastName: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  gender?: string;
  temporaryPassword: string;
  schoolCode?: string;
}) {
  return request<{
    user?: Record<string, unknown>;
    credentials?: { login?: string; temporarySecret?: string };
  }>("/backoffice/users/create-teacher", {
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
  return request<{
    permissions?: string[];
    roleKeys?: string[];
    modules?: unknown;
    source?: string;
    resolvedAt?: string;
  }>("/auth/effective-permissions", { method: "GET" });
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

export function createSchoolPayment(payload: Record<string, unknown>, options?: MutationRequestOptions) {
  return request("/payments", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotencyKey: options?.idempotencyKey,
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

/** URL du bulletin PDF LOT 5 (sans JWT). */
export function getReportCardPdfUrl(reportCardId: string, version: number | string = 1) {
  return `${getApiBaseUrl()}/report-card/publications/${encodeURIComponent(reportCardId)}/pdf?version=${encodeURIComponent(String(version))}`;
}

/**
 * S2.3 — Téléchargement sécurisé PDF LOT 5.
 *
 * Adaptateur natif volontaire autour du client HTTP central (`httpClient`) :
 * `FileSystem.downloadAsync` écrit directement vers le cache et n'est pas
 * interchangeable avec `fetch` JSON. Les autres appels réseau doivent passer
 * par `httpRequest` / `httpUpload` — ne pas dupliquer ce pattern ailleurs.
 * Contrôles : Bearer, status 200 strict, MIME PDF/octet-stream, taille > 0.
 */
export async function downloadReportCardPdf(reportCardId: string, version: number | string = 1): Promise<string> {
  const token = await getAccessToken();
  if (!token) {
    throw new ApiClientError("Authentification requise pour télécharger le bulletin PDF.");
  }

  const url = getReportCardPdfUrl(reportCardId, version);
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    throw new ApiClientError("Stockage local indisponible pour ouvrir le bulletin PDF.");
  }

  const safeVersion = String(version).replace(/[^\w.-]+/g, "-").toLowerCase();
  const target = `${cacheDir}bulletin-${reportCardId}-${safeVersion}.pdf`;
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
