import { UserRole } from "../navigation/AppNavigator";
import { resolveApiBaseUrl, resolveApiRootUrl, isUsingLocalhostOnDevice } from "../config/env";

let accessToken: string | null = null;

export function getApiBaseUrl() {
  return resolveApiBaseUrl();
}

/** @deprecated Préférez getApiBaseUrl() — conservé pour compatibilité. */
export const API_BASE_URL = resolveApiBaseUrl();

export type StudentSummary = {
  id: string;
  publicId?: string;
  name: string;
  firstName?: string;
  matricule: string;
  gender?: string;
  birthDate?: string;
  className: string;
  schoolCode: string;
  parentName?: string;
  parentPhone: string;
  parentEmail?: string;
  archived?: boolean;
};

export type TeacherAssignment = {
  className: string;
  course: string;
  teacherId?: string;
  teacherName?: string;
};

type LoginPayload = {
  role: UserRole;
  schoolCode: string;
  identifier: string;
  pin: string;
};

export type SchoolInfo = {
  id: string;
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
  slogan: string;
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

type TeacherSummary = {
  id: string;
  publicId?: string;
  phone: string;
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options?.headers,
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(data?.message ?? "L'API Somafrik ne répond pas correctement. Vérifiez que le backend est lancé sur le port 5000.");
  }

  if (!isJson) {
    throw new Error("Réponse API invalide. Vérifiez l'adresse API et redémarrez le backend.");
  }

  return data;
}

export function login(payload: LoginPayload) {
  return request<LoginResponse>("/login", {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch((error) => {
    throw buildApiConnectionError(error);
  }).then((session) => {
    accessToken = session.accessToken ?? null;
    return session;
  });
}

export async function logout() {
  try {
    await request<{ message: string }>("/auth/logout", {
      method: "POST",
    });
  } finally {
    accessToken = null;
  }
}

export function changePassword(newPassword: string) {
  return request<{ user: LoginResponse["user"]; message: string }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ newPassword }),
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
  return request<unknown[]>("/notes");
}

export function getPresences() {
  return request<unknown[]>("/presences");
}

export function getStudents() {
  return request<StudentSummary[]>("/students");
}

export function getClasses() {
  return request<unknown[]>("/classes");
}

export function getCourses() {
  return request<unknown[]>("/courses");
}

export function getAssignments() {
  return request<TeacherAssignment[]>("/assignments");
}

export function getAcademicConfig() {
  return request<AcademicConfigPayload>("/academic-config");
}

export function saveAcademicConfig(payload: AcademicConfigPayload) {
  return request<AcademicConfigPayload>("/academic-config", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function saveNote(payload: unknown) {
  return request<unknown>("/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function savePresences(payload: unknown) {
  return request<unknown[]>("/presences", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getBackOfficeState() {
  return request<BackOfficeStatePayload>("/backoffice/state");
}

export function saveBackOfficeState(payload: BackOfficeStatePayload) {
  return request<BackOfficeStatePayload>("/backoffice/state", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function resetUserPassword(userId: string, temporaryPassword: string) {
  return request<{ temporaryPassword: string; user: unknown }>(`/users/${encodeURIComponent(userId)}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ temporaryPassword }),
  });
}

export function getReportCardPdfUrl(studentId: string, period = "Trimestre 1") {
  const tokenQuery = accessToken ? `&access_token=${encodeURIComponent(accessToken)}` : "";
  return `${getApiBaseUrl()}/students/${encodeURIComponent(studentId)}/report.pdf?period=${encodeURIComponent(period)}${tokenQuery}`;
}

function buildApiConnectionError(error: unknown) {
  const reason = error instanceof Error ? error.message : "Connexion API impossible";
  const apiUrl = getApiBaseUrl();
  const rootUrl = resolveApiRootUrl();
  if (isUsingLocalhostOnDevice()) {
    return new Error(
      `${reason}\n\nSur téléphone, localhost ne fonctionne pas.\n` +
        `Mettez l'IP du PC dans Mobile/.env.local :\n` +
        `EXPO_PUBLIC_API_URL=http://VOTRE_IP:5000\n` +
        `Puis rebuild l'application.`
    );
  }
  return new Error(
    `${reason}\n\nAPI : ${apiUrl}\n` +
      `Backend attendu : ${rootUrl}\n` +
      `1) Lancez scripts\\start-backend.ps1 sur le PC\n` +
      `2) Même Wi-Fi que le téléphone\n` +
      `3) Testez ${rootUrl}/api/health dans le navigateur du téléphone`
  );
}
