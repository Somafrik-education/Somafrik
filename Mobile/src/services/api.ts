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
  saveSessionProfile,
  saveTokens,
} from "./secureStorage";

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
  await saveTokens(session.accessToken ?? null, session.refreshToken ?? null);
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
    if (response.accessToken) {
      const { getRefreshToken } = await import("./secureStorage");
      await saveTokens(response.accessToken, await getRefreshToken());
    }
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

export function getCourseSchedules() {
  return request<unknown[]>("/course-schedules");
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
  const rest = { ...payload };
  delete rest.schools;
  return request<BackOfficeStatePayload>("/backoffice/state", {
    method: "PUT",
    body: JSON.stringify(rest),
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
