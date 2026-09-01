import { describe, expect, it, vi } from "vitest";
import type { SessionUser, UserAccount } from "../types";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import { projectScopedUsers, scopedUsers } from "./scope";
import {
  accountMatchesSchoolIdentity,
  isLegacySchoolCode,
  isV2SchoolLoginCode,
  resolveSessionSchoolIdentity,
} from "./schoolCanonicalIdentity";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOGIN_A = "CD-IN-26-001";
const LOGIN_B = "BI-EC-26-001";
const LEFTOVER_A = "CD-2026-0001";

function schoolAdmin(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "admin-nuru",
    firstName: "KIBWIJA",
    lastName: "TATA",
    role: SCHOOL_ADMIN_ROLE,
    schoolCode: LEFTOVER_A,
    schoolPublicCode: LOGIN_A,
    schoolId: SCHOOL_ID_A,
    identifier: "admin-nuru",
    ...overrides,
  } as SessionUser;
}

function apiUser(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    id: "usr-1",
    publicId: "CD-IN-AAA-26-00001",
    firstName: "A",
    lastName: "Staff",
    role: "Enseignant",
    status: "Actif",
    schoolCode: LOGIN_A,
    schoolPublicCode: LOGIN_A,
    schoolId: SCHOOL_ID_A,
    ...overrides,
  } as UserAccount;
}

function stateOf(users: UserAccount[]) {
  return { users, schools: [], countries: [], subscriptions: [], notifications: [] };
}

describe("contrat identité établissement — leftover JWT ≠ login_code API", () => {
  it("documente le mismatch préprod : session leftover vs users projetés login_code", () => {
    const session = schoolAdmin();
    const apiRow = apiUser();

    expect(isLegacySchoolCode(session.schoolCode)).toBe(true);
    expect(isV2SchoolLoginCode(apiRow.schoolCode)).toBe(true);
    expect(session.schoolCode).not.toBe(apiRow.schoolCode);
    expect(session.schoolPublicCode).toBe(apiRow.schoolPublicCode);
    expect(session.schoolId).toBe(apiRow.schoolId);

    const identity = resolveSessionSchoolIdentity(session);
    expect(identity).toEqual({ schoolId: SCHOOL_ID_A, publicCode: LOGIN_A });
    expect(accountMatchesSchoolIdentity(apiRow, identity!)).toBe(true);
  });
});

describe("scopedUsers — SCHOOL_ADMIN canonique (A–E, I)", () => {
  it("A. API retourne les utilisateurs de l'école → le Web les conserve", () => {
    const users = [
      apiUser({ id: "u1", publicId: "CD-IN-AAA-26-00001" }),
      apiUser({ id: "u2", publicId: "CD-IN-BBB-26-00002" }),
    ];
    const projection = projectScopedUsers(schoolAdmin(), stateOf(users));
    expect(projection.error).toBeNull();
    expect(projection.received).toBe(2);
    expect(projection.kept).toBe(2);
    expect(projection.users.map((row) => row.id)).toEqual(["u1", "u2"]);
    expect(projection.trace.api.distinctSchoolIds).toBe(1);
  });

  it("B. API retourne [] → le Web affiche réellement 0", () => {
    const projection = projectScopedUsers(schoolAdmin(), stateOf([]));
    expect(projection.error).toBeNull();
    expect(projection.received).toBe(0);
    expect(projection.kept).toBe(0);
    expect(projection.users).toEqual([]);
  });

  it("C. utilisateur autre école → jamais visible", () => {
    const users = [
      apiUser({ id: "own" }),
      apiUser({
        id: "foreign",
        schoolId: SCHOOL_ID_B,
        schoolCode: LOGIN_B,
        schoolPublicCode: LOGIN_B,
        publicId: "BI-EC-ZZZ-26-00001",
      }),
    ];
    const projection = projectScopedUsers(schoolAdmin(), stateOf(users));
    expect(projection.users.map((row) => row.id)).toEqual(["own"]);
    expect(projection.error?.code).toBe("SCOPE_LEAK");
    expect(projection.trace.api.distinctSchoolIds).toBe(2);
  });

  it("D. leftover session ≠ login_code projeté → ne doit pas effacer les données autorisées", () => {
    const session = schoolAdmin({
      schoolCode: LEFTOVER_A,
      schoolPublicCode: LOGIN_A,
      schoolId: SCHOOL_ID_A,
    });
    const users = [apiUser({ schoolCode: LOGIN_A, schoolPublicCode: LOGIN_A })];
    expect(session.schoolCode).not.toBe(users[0].schoolCode);

    const legacyCompareWouldDrop = users.filter(
      (account) => account.schoolCode === session.schoolCode,
    );
    expect(legacyCompareWouldDrop).toHaveLength(0);

    const projection = projectScopedUsers(session, stateOf(users));
    expect(projection.error).toBeNull();
    expect(projection.kept).toBe(1);
    expect(projection.users[0]?.id).toBe("usr-1");
  });

  it("E. absence d'identité canonique → fail closed, pas une liste vide silencieuse", () => {
    const session = schoolAdmin({
      schoolCode: LEFTOVER_A,
      schoolPublicCode: "",
      schoolId: "",
    });
    const users = [apiUser()];
    const projection = projectScopedUsers(session, stateOf(users));
    expect(resolveSessionSchoolIdentity(session)).toBeNull();
    expect(projection.users).toEqual([]);
    expect(projection.error?.code).toBe("MISSING_CANONICAL_IDENTITY");
    expect(projection.error?.message).toMatch(/schoolId/i);
  });

  it("E2. schoolId absent + schoolPublicCode présent → fail closed (publicCode n'est pas une autorité)", () => {
    const session = schoolAdmin({
      schoolCode: LEFTOVER_A,
      schoolPublicCode: LOGIN_A,
      schoolId: "",
    });
    const users = [apiUser()];
    expect(resolveSessionSchoolIdentity(session)).toBeNull();
    const projection = projectScopedUsers(session, stateOf(users));
    expect(projection.users).toEqual([]);
    expect(projection.error?.code).toBe("MISSING_CANONICAL_IDENTITY");
    expect(accountMatchesSchoolIdentity(users[0], { schoolId: "", publicCode: LOGIN_A })).toBe(false);
  });

  it("E3. schoolCode V2 seul, sans schoolId → fail closed", () => {
    const session = schoolAdmin({
      schoolCode: LOGIN_A,
      schoolPublicCode: LOGIN_A,
      schoolId: "",
    });
    expect(isV2SchoolLoginCode(session.schoolCode)).toBe(true);
    expect(resolveSessionSchoolIdentity(session)).toBeNull();
    const projection = projectScopedUsers(session, stateOf([apiUser()]));
    expect(projection.users).toEqual([]);
    expect(projection.error?.code).toBe("MISSING_CANONICAL_IDENTITY");
  });

  it("E4. schoolId session présent + row sans schoolId → ne pas autoriser par code public", () => {
    const session = schoolAdmin();
    const identity = resolveSessionSchoolIdentity(session)!;
    const rowWithoutId = apiUser({ schoolId: "", schoolCode: LOGIN_A, schoolPublicCode: LOGIN_A });
    expect(accountMatchesSchoolIdentity(rowWithoutId, identity)).toBe(false);
    const projection = projectScopedUsers(session, stateOf([rowWithoutId]));
    expect(projection.users).toEqual([]);
    expect(projection.error?.code).toBe("SCOPE_MISMATCH");
  });

  it("E5. schoolId différents + même publicCode → SCOPE_LEAK, pas d'autorisation par code", () => {
    const session = schoolAdmin();
    const identity = resolveSessionSchoolIdentity(session)!;
    const foreignSameCode = apiUser({
      id: "foreign",
      schoolId: SCHOOL_ID_B,
      schoolCode: LOGIN_A,
      schoolPublicCode: LOGIN_A,
    });
    expect(accountMatchesSchoolIdentity(foreignSameCode, identity)).toBe(false);
    const projection = projectScopedUsers(session, stateOf([foreignSameCode]));
    expect(projection.users).toEqual([]);
    expect(projection.error?.code).toBe("SCOPE_LEAK");
  });

  it("I. SCHOOL_ADMIN préprod-like : leftover JWT + projection login_code + plusieurs publicId user", () => {
    const session = schoolAdmin();
    const users = Array.from({ length: 20 }, (_, index) =>
      apiUser({
        id: `u-${index}`,
        publicId: `CD-IN-X${String(index).padStart(2, "0")}-26-${String(index + 1).padStart(5, "0")}`,
      }),
    );
    const projection = projectScopedUsers(session, stateOf(users));
    expect(projection.received).toBe(20);
    expect(projection.kept).toBe(20);
    expect(projection.error).toBeNull();
    expect(projection.trace.session.leftoverPresent).toBe(true);
    expect(projection.trace.session.hasPublicCode).toBe(true);
    expect(projection.trace.session.leftoverEqualsPublic).toBe(false);
    expect(new Set(users.map((row) => row.publicId)).size).toBe(20);
  });

  it("incohérence leftover-only vs projection → erreur observable, pas « 0 résultat »", () => {
    const session = schoolAdmin({
      schoolCode: LEFTOVER_A,
      schoolPublicCode: LOGIN_A,
      schoolId: SCHOOL_ID_A,
    });
    const otherTenantOnly = [
      apiUser({
        id: "other",
        schoolId: SCHOOL_ID_B,
        schoolCode: LOGIN_B,
        schoolPublicCode: LOGIN_B,
      }),
    ];
    const projection = projectScopedUsers(session, stateOf(otherTenantOnly));
    expect(projection.users).toEqual([]);
    expect(projection.error?.code).toBe("SCOPE_LEAK");
    expect(scopedUsers(session, stateOf(otherTenantOnly))).toEqual([]);
  });

  it("ne réintroduit pas le leftover comme autorité même s'il matcherait un schoolCode API non projeté", () => {
    const session = schoolAdmin({
      schoolCode: LEFTOVER_A,
      schoolPublicCode: "",
      schoolId: "",
    });
    const leftoverRows = [apiUser({ schoolCode: LEFTOVER_A, schoolPublicCode: "" })];
    const projection = projectScopedUsers(session, stateOf(leftoverRows));
    expect(projection.users).toEqual([]);
    expect(projection.error?.code).toBe("MISSING_CANONICAL_IDENTITY");
  });
});

describe("projectScopedUsers — traces sans données sensibles", () => {
  it("n'écrit ni email, ni nom, ni publicId utilisateur dans la trace", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const users = [apiUser({ email: "secret@nuru.test", firstName: "KIBWIJA", lastName: "TATA" })];
    const projection = projectScopedUsers(schoolAdmin(), stateOf(users));
    const serialized = JSON.stringify(projection.trace);
    expect(serialized).not.toMatch(/secret@nuru\.test/i);
    expect(serialized).not.toMatch(/KIBWIJA|TATA/i);
    expect(serialized).not.toMatch(/CD-IN-AAA-26-00001/);
    expect(projection.trace.kind).toBe("users_scope_trace");
    spy.mockRestore();
  });
});
