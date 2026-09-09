/**
 * Helpers P0 [RED] — hydratation bloquée par un 403 de domaine facultatif.
 * Aucun comportement de production. Réutilise hydrationRedTestUtils.
 */

import type { ReactNode } from "react";
import { vi } from "vitest";
import type { Session, SessionUser } from "../types";
import { AuthProvider } from "./AuthContext";
import { DataProvider } from "./DataContext";
import { getInternalRoleDefaults } from "../lib/internalRoleDefaults";
import {
  COUNTRY_ADMIN_ROLE,
  SCHOOL_ADMIN_ROLE,
  SUPER_ADMIN_ROLE,
} from "../lib/orgHierarchy";
import { jsonResponse, pathnameOf, SCHOOL_A, SCHOOL_ID_A } from "./hydrationRedTestUtils";

export { SCHOOL_A, SCHOOL_ID_A, jsonResponse, pathnameOf } from "./hydrationRedTestUtils";

export const FORBIDDEN_MESSAGE = {
  id: "leak-message-other-role",
  body: "DONNEE INTERDITE MESSAGES",
  schoolCode: "XX-LEAK-00-001",
};

export const FORBIDDEN_ANNOUNCEMENT = {
  id: "leak-announcement-other-role",
  title: "DONNEE INTERDITE ANNONCES",
  schoolCode: "XX-LEAK-00-001",
};

export const AUTHORIZED_USER = {
  id: "user-authorized",
  firstName: "Autorise",
  lastName: "Nuru",
  role: SCHOOL_ADMIN_ROLE,
  schoolId: SCHOOL_ID_A,
  schoolCode: SCHOOL_A,
  schoolPublicCode: SCHOOL_A,
};

/** Rôles réellement exposés par le Web (orgHierarchy + defaults internes + isInternalSchoolRole). */
export const WEB_ROLE_CATALOG = [
  SUPER_ADMIN_ROLE,
  COUNTRY_ADMIN_ROLE,
  SCHOOL_ADMIN_ROLE,
  "Secrétaire",
  "Préfet des études",
  "Proviseur",
  "Directeur",
  "Directeur adjoint",
  "Comptable",
  "Enseignant",
  "Parent",
  "Élève / Étudiant",
  "Surveillant",
  "Proviseur / Directeur",
] as const;

export type WebRoleName = (typeof WEB_ROLE_CATALOG)[number];

export function schoolCodeForRole(role: string): string {
  if (role === SUPER_ADMIN_ROLE || role === COUNTRY_ADMIN_ROLE) return "*";
  return SCHOOL_A;
}

export function permissionsForRole(role: string): string[] {
  if (role === SUPER_ADMIN_ROLE) return ["ALL_PRIVILEGES"];
  if (role === COUNTRY_ADMIN_ROLE) return ["COUNTRY_PRIVILEGES"];
  return getInternalRoleDefaults(role);
}

export function sessionUserForRole(role: string, overrides: Partial<SessionUser> = {}): SessionUser {
  const schoolCode = schoolCodeForRole(role);
  return {
    id: `user-${role}`,
    firstName: "Acteur",
    lastName: role,
    identifier: `login-${role}`,
    role,
    schoolCode,
    schoolPublicCode: schoolCode === "*" ? "*" : SCHOOL_A,
    schoolId: schoolCode === "*" ? undefined : SCHOOL_ID_A,
    permissions: permissionsForRole(role),
    ...overrides,
  } as SessionUser;
}

export function sessionForRole(role: string, accessToken = "access-1"): Session {
  const user = sessionUserForRole(role);
  return {
    accessToken,
    refreshToken: "refresh-1",
    permissions: user.permissions ?? [],
    scope: {
      label: schoolCodeForRole(role) === "*" ? "Plateforme" : "Établissement",
      hint: schoolCodeForRole(role),
    },
    user,
  } as Session;
}

export function AuthDataWrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>{children}</DataProvider>
    </AuthProvider>
  );
}

export type FetchCall = { path: string; method: string; status: number };

export interface ForbiddenFetchCtl {
  access: string;
  refresh: string;
  permissions: string[];
  loginStatus: number;
  permissionsStatus: number;
  refreshStatus: number;
  domainStatus: Record<string, number>;
  calls: FetchCall[];
}

export function createForbiddenFetchCtl(): ForbiddenFetchCtl {
  return {
    access: "access-1",
    refresh: "refresh-1",
    permissions: [],
    loginStatus: 200,
    permissionsStatus: 200,
    refreshStatus: 200,
    domainStatus: {},
    calls: [],
  };
}

function domainKeyFromPath(path: string): string | null {
  if (path === "/students") return "students";
  if (path === "/teachers") return "teachers";
  if (path === "/classes") return "classes";
  if (path === "/assignments") return "assignments";
  if (path === "/notes") return "notes";
  if (path === "/presences") return "presences";
  if (path === "/exams") return "exams";
  if (path === "/backoffice/users") return "users";
  if (path === "/backoffice/contacts") return "contacts";
  if (path === "/backoffice/relations") return "relations";
  if (path === "/backoffice/messages") return "messages";
  if (path === "/backoffice/announcements") return "announcements";
  if (path === "/backoffice/notifications") return "notifications";
  if (path === "/backoffice/countries") return "countries";
  if (path === "/backoffice/subscriptions") return "subscriptions";
  if (path === "/backoffice/role-permissions") return "rolePermissions";
  if (path === "/backoffice/dashboard-chart-config") return "dashboardChartConfig";
  if (path === "/backoffice/establishments") return "schools";
  if (path.startsWith("/backoffice/establishments/") && path.includes("academic-config")) {
    return "academicConfigs";
  }
  if (path.startsWith("/backoffice/establishments/")) return "schools";
  if (path.includes("academic-config")) return "academicConfigs";
  if (path.startsWith("/payments")) return "payments";
  if (path.includes("fee")) return "fees";
  return null;
}

export function installForbiddenDomainFetch(ctl: ForbiddenFetchCtl) {
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const path = pathnameOf(url);
    const method = String(init?.method ?? "GET").toUpperCase();
    const domain = domainKeyFromPath(path);
    const status =
      domain && ctl.domainStatus[domain] != null
        ? ctl.domainStatus[domain]
        : path === "/auth/effective-permissions"
          ? ctl.permissionsStatus
          : path === "/auth/refresh"
            ? ctl.refreshStatus
            : path === "/backoffice/login"
              ? ctl.loginStatus
              : 200;

    ctl.calls.push({ path, method, status });

    if (path === "/backoffice/login") {
      if (ctl.loginStatus !== 200) {
        return jsonResponse({ message: "Identifiants invalides" }, ctl.loginStatus);
      }
      return jsonResponse({
        accessToken: ctl.access,
        refreshToken: ctl.refresh,
        permissions: ctl.permissions,
        scope: { label: "Établissement", hint: SCHOOL_A },
        user: sessionUserForRole(SCHOOL_ADMIN_ROLE, { permissions: ctl.permissions }),
      });
    }

    if (path === "/auth/effective-permissions") {
      if (ctl.permissionsStatus !== 200) {
        return jsonResponse({ message: "Permissions indisponibles" }, ctl.permissionsStatus);
      }
      return jsonResponse({ permissions: ctl.permissions });
    }

    if (path === "/auth/refresh") {
      if (ctl.refreshStatus !== 200) {
        return jsonResponse({ message: "refresh failed" }, ctl.refreshStatus);
      }
      ctl.access = "access-2";
      ctl.refresh = "refresh-2";
      return jsonResponse({ accessToken: ctl.access, refreshToken: ctl.refresh });
    }

    if (status === 401) {
      return jsonResponse({ message: "Session expirée" }, 401);
    }
    if (status === 403) {
      if (domain === "messages") {
        return jsonResponse({ message: "Forbidden", items: [FORBIDDEN_MESSAGE] }, 403);
      }
      if (domain === "announcements") {
        return jsonResponse({ message: "Forbidden", items: [FORBIDDEN_ANNOUNCEMENT] }, 403);
      }
      return jsonResponse({ message: "Forbidden", items: [{ id: "leak-generic" }] }, 403);
    }

    if (path === "/students") {
      return jsonResponse([
        {
          id: "CD-IN-EL-26-00001",
          publicId: "CD-IN-EL-26-00001",
          firstName: "Amina",
          lastName: "Nuru",
          name: "Amina Nuru",
          className: "6ème A",
          schoolId: SCHOOL_ID_A,
          schoolCode: SCHOOL_A,
          schoolPublicCode: SCHOOL_A,
          status: "active",
        },
      ]);
    }
    if (path === "/backoffice/users") {
      return jsonResponse([AUTHORIZED_USER]);
    }
    if (path === "/backoffice/messages") {
      return jsonResponse([{ id: "msg-ok", body: "message autorisé", schoolCode: SCHOOL_A }]);
    }
    if (path === "/backoffice/announcements") {
      return jsonResponse({ items: [{ id: "ann-ok", title: "annonce autorisée", schoolCode: SCHOOL_A }] });
    }
    if (path.startsWith("/backoffice/establishments/") && path.includes("academic-config")) {
      return jsonResponse({ schoolCode: SCHOOL_A, periodMode: "trimester" });
    }
    if (path.includes("academic-config")) {
      return jsonResponse({ schoolCode: SCHOOL_A, periodMode: "trimester" });
    }
    if (path === "/backoffice/establishments") {
      return jsonResponse([
        { id: SCHOOL_ID_A, code: SCHOOL_A, name: "Complexe Scolaire Nuru", status: "active" },
      ]);
    }
    if (path.startsWith("/backoffice/establishments/")) {
      return jsonResponse({
        id: SCHOOL_ID_A,
        code: SCHOOL_A,
        name: "Complexe Scolaire Nuru",
        status: "active",
      });
    }
    if (path === "/backoffice/role-permissions") {
      return jsonResponse({});
    }
    if (path === "/backoffice/dashboard-chart-config") {
      return jsonResponse({ platform: {}, establishment: {} });
    }
    if (path === "/exams") return jsonResponse({ exams: [] });
    if (path === "/report-cards") return jsonResponse({ bulletins: [] });
    if (path === "/school-documents") return jsonResponse({ documents: [] });
    return jsonResponse([]);
  };

  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

export function pathsCalled(ctl: ForbiddenFetchCtl, needle: string): string[] {
  return ctl.calls.map((call) => call.path).filter((path) => path === needle || path.startsWith(`${needle}?`));
}
