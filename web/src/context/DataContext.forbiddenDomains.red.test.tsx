/**
 * P0 [RED] — LOT RED-1 / RED-2 / RED-3 / RED-6 / RED-8
 * Un 403 sur un domaine facultatif ne doit pas casser une session authentifiée
 * ni transformer l'hydratation partielle en panne globale.
 * Fail-closed : aucune donnée 403 n'est injectée.
 * Ne pas modifier DataContext / domainLoaders pour verdir ces tests.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { useData } from "./DataContext";
import { SCHOOL_ADMIN_ROLE } from "../lib/orgHierarchy";
import { getInternalRoleDefaults } from "../lib/internalRoleDefaults";
import {
  AuthDataWrapper,
  AUTHORIZED_USER,
  FORBIDDEN_ANNOUNCEMENT,
  FORBIDDEN_MESSAGE,
  createForbiddenFetchCtl,
  installForbiddenDomainFetch,
  sessionForRole,
  SCHOOL_A,
  type ForbiddenFetchCtl,
} from "./forbiddenDomainRedTestUtils";

function useHarness() {
  const auth = useAuth();
  const data = useData();
  return { auth, data };
}

describe("P0 [RED] — DataContext / domaines interdits (messages, announcements)", () => {
  let ctl: ForbiddenFetchCtl;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    ctl = createForbiddenFetchCtl();
    ctl.permissions = getInternalRoleDefaults(SCHOOL_ADMIN_ROLE);
    installForbiddenDomainFetch(ctl);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  async function loginSchoolAdmin() {
    const { result } = renderHook(() => useHarness(), { wrapper: AuthDataWrapper });
    await act(async () => {
      result.current.auth.setSession(sessionForRole(SCHOOL_ADMIN_ROLE, ctl.access));
    });
    await waitFor(() => expect(result.current.auth.permissionsReady).toBe(true));
    expect(result.current.auth.isAuthenticated).toBe(true);
    return result;
  }

  it("[RED] RED-1 hydratation partielle : users 200 + messages 403 + announcements 403 ne doit pas paniquer l'app", async () => {
    ctl.domainStatus = { messages: 403, announcements: 403 };
    const result = await loginSchoolAdmin();

    await act(async () => {
      await expect(
        result.current.data.ensureDomains(["users", "messages", "announcements"], {
          schoolCode: SCHOOL_A,
        }),
      ).resolves.toBeUndefined();
    });

    expect(
      result.current.data.state.users.some((row) => String((row as { id?: string }).id) === AUTHORIZED_USER.id),
      "le domaine autorisé users doit rester chargé",
    ).toBe(true);
    expect(result.current.data.state.messages).toEqual([]);
    expect(result.current.data.state.announcements).toEqual([]);
    expect(JSON.stringify(result.current.data.state.messages)).not.toContain("DONNEE INTERDITE");
    expect(JSON.stringify(result.current.data.state.announcements)).not.toContain("DONNEE INTERDITE");
    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.auth.session?.accessToken).toBe(ctl.access);
    expect(
      result.current.data.error,
      "un 403 facultatif ne doit pas devenir une erreur globale DataContext",
    ).toBeNull();
  });

  it("[RED] RED-2 login + token valides : un 403 métier ne déconnecte pas et n'envoie pas vers Login", async () => {
    ctl.domainStatus = { messages: 403 };
    const { result } = renderHook(() => useHarness(), { wrapper: AuthDataWrapper });

    await act(async () => {
      await result.current.auth.login({
        identifier: "admin-nuru",
        password: "secret",
        profile: "school",
        schoolCode: SCHOOL_A,
      });
    });
    await waitFor(() => expect(result.current.auth.permissionsReady).toBe(true));
    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.auth.session?.accessToken).toBeTruthy();

    await act(async () => {
      await expect(
        result.current.data.ensureDomains(["users", "messages"], { schoolCode: SCHOOL_A }),
      ).resolves.toBeUndefined();
    });

    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.auth.session).not.toBeNull();
    expect(result.current.auth.session?.accessToken).toBeTruthy();
    expect(result.current.data.state.users.length).toBeGreaterThan(0);
    expect(result.current.data.error).toBeNull();
  });

  it("[RED] RED-3A messages 403 uniquement : session intacte, messages vides, users chargés", async () => {
    ctl.domainStatus = { messages: 403 };
    const result = await loginSchoolAdmin();

    await act(async () => {
      await expect(
        result.current.data.ensureDomains(["users", "messages"], { schoolCode: SCHOOL_A }),
      ).resolves.toBeUndefined();
    });

    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.data.state.users.length).toBeGreaterThan(0);
    expect(result.current.data.state.messages).toEqual([]);
    expect(result.current.data.error).toBeNull();
  });

  it("[RED] RED-3B announcements 403 uniquement : session intacte, annonces vides, users chargés", async () => {
    ctl.domainStatus = { announcements: 403 };
    const result = await loginSchoolAdmin();

    await act(async () => {
      await expect(
        result.current.data.ensureDomains(["users", "announcements"], { schoolCode: SCHOOL_A }),
      ).resolves.toBeUndefined();
    });

    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.data.state.users.length).toBeGreaterThan(0);
    expect(result.current.data.state.announcements).toEqual([]);
    expect(result.current.data.error).toBeNull();
  });

  it("[RED] RED-3C messages + announcements 403 simultanés (cas capture /parametres)", async () => {
    ctl.domainStatus = { messages: 403, announcements: 403 };
    const result = await loginSchoolAdmin();

    await act(async () => {
      await expect(
        result.current.data.ensureDomains(
          ["users", "academicConfigs", "messages", "announcements"],
          { schoolCode: SCHOOL_A },
        ),
      ).resolves.toBeUndefined();
    });

    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.data.state.users.length).toBeGreaterThan(0);
    expect(result.current.data.state.messages).toEqual([]);
    expect(result.current.data.state.announcements).toEqual([]);
    // error est null après un 403 facultatif (typeof null === "object" casse .toMatch).
    expect(result.current.data.error ?? "").not.toMatch(/messages:.*accès refusé/i);
    expect(result.current.data.error ?? "").not.toMatch(/announcements:.*accès refusé/i);
    expect(result.current.data.error).toBeNull();
  });

  it("[RED] RED-6 403 métier ≠ 401 : le 403 ne déconnecte pas", async () => {
    ctl.domainStatus = { messages: 403 };
    const result = await loginSchoolAdmin();

    await act(async () => {
      await result.current.data
        .ensureDomains(["users", "messages"], { schoolCode: SCHOOL_A })
        .catch(() => undefined);
    });

    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.auth.session?.accessToken).toBeTruthy();
    expect(result.current.data.state.messages).toEqual([]);
    expect(JSON.stringify(result.current.data.state)).not.toContain(FORBIDDEN_MESSAGE.id);
    expect(
      result.current.data.error,
      "un 403 facultatif ne doit pas être exposé comme une panne globale de session",
    ).toBeNull();
  });

  it("[CONTROL] RED-6 401 domaine : message session expirée, jamais « accès refusé », aucune donnée injectée", async () => {
    ctl.domainStatus = { messages: 401 };
    ctl.refreshStatus = 401;
    const result = await loginSchoolAdmin();

    await act(async () => {
      await result.current.data
        .ensureDomains(["users", "messages"], { schoolCode: SCHOOL_A })
        .catch(() => undefined);
    });

    expect(result.current.data.state.messages).toEqual([]);
    expect(JSON.stringify(result.current.data.state.messages)).not.toContain("DONNEE INTERDITE");
    expect(result.current.data.error).toMatch(/session expirée/i);
    expect(result.current.data.error).not.toMatch(/accès refusé/i);
  });

  it("[CONTROL] 401 bloquant + 403 facultatif : session expirée, 403 filtré, aucune donnée interdite", async () => {
    ctl.domainStatus = { messages: 401, announcements: 403 };
    ctl.refreshStatus = 401;
    const result = await loginSchoolAdmin();

    await act(async () => {
      await result.current.data
        .ensureDomains(["users", "messages", "announcements"], { schoolCode: SCHOOL_A })
        .catch(() => undefined);
    });

    expect(result.current.data.state.messages).toEqual([]);
    expect(result.current.data.state.announcements).toEqual([]);
    expect(JSON.stringify(result.current.data.state)).not.toContain("DONNEE INTERDITE");
    expect(JSON.stringify(result.current.data.state)).not.toContain(FORBIDDEN_MESSAGE.id);
    expect(JSON.stringify(result.current.data.state)).not.toContain(FORBIDDEN_ANNOUNCEMENT.id);
    expect(result.current.data.error).toMatch(/session expirée/i);
    expect(result.current.data.error).not.toMatch(/accès refusé/i);
    expect(result.current.data.error).not.toMatch(/announcements:/i);
  });

  it("[CONTROL] RED-6 401 sur /auth/effective-permissions : la session est bien invalidée", async () => {
    ctl.permissionsStatus = 401;
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
    });

    await act(async () => {
      result.current.setSession(sessionForRole(SCHOOL_ADMIN_ROLE, ctl.access));
    });

    await waitFor(() => expect(result.current.session).toBeNull());
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("[CONTROL] RED-8 403 n'injecte jamais le payload interdit", async () => {
    ctl.domainStatus = { messages: 403, announcements: 403 };
    const result = await loginSchoolAdmin();

    await act(async () => {
      await result.current.data
        .ensureDomains(["users", "messages", "announcements"], { schoolCode: SCHOOL_A })
        .catch(() => undefined);
    });

    const serialized = JSON.stringify(result.current.data.state);
    expect(serialized).not.toContain(FORBIDDEN_MESSAGE.id);
    expect(serialized).not.toContain(FORBIDDEN_ANNOUNCEMENT.id);
    expect(serialized).not.toContain("DONNEE INTERDITE");
    expect(result.current.data.state.messages).toEqual([]);
    expect(result.current.data.state.announcements).toEqual([]);
  });

  it("[CONTROL] RED-8 changement de rôle purge les données du rôle précédent", async () => {
    ctl.domainStatus = {};
    const result = await loginSchoolAdmin();

    await act(async () => {
      await result.current.data.ensureDomains(["users", "messages"], { schoolCode: SCHOOL_A });
    });
    expect(result.current.data.state.users.length).toBeGreaterThan(0);
    expect(result.current.data.state.messages.length).toBeGreaterThan(0);

    await act(async () => {
      result.current.auth.setSession(sessionForRole("Parent", "access-parent"));
    });
    await waitFor(() => expect(result.current.auth.session?.user?.role).toBe("Parent"));

    expect(result.current.data.state.users).toEqual([]);
    expect(result.current.data.state.messages).toEqual([]);
    expect(JSON.stringify(result.current.data.state)).not.toContain(AUTHORIZED_USER.id);
  });

  it("[CONTROL] RED-8 changement d'établissement ne réutilise pas les données de l'autre école", async () => {
    const result = await loginSchoolAdmin();
    await act(async () => {
      await result.current.data.ensureDomains(["users"], { schoolCode: SCHOOL_A });
    });
    expect(result.current.data.state.users.length).toBeGreaterThan(0);

    const otherSchool = sessionForRole(SCHOOL_ADMIN_ROLE, "access-school-b");
    otherSchool.user = {
      ...otherSchool.user,
      id: "admin-other",
      schoolCode: "BI-EC-26-001",
      schoolPublicCode: "BI-EC-26-001",
      schoolId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };

    await act(async () => {
      result.current.auth.setSession(otherSchool);
    });
    await waitFor(() => expect(result.current.auth.session?.user?.schoolCode).toBe("BI-EC-26-001"));

    expect(result.current.data.state.users).toEqual([]);
    expect(JSON.stringify(result.current.data.state)).not.toContain(SCHOOL_A);
  });
});
