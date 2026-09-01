import { describe, expect, it } from "vitest";
import { diagnoseScopedUsers, scopedUsers } from "./scope";
import type { SessionUser, UserAccount } from "../types";

const SCHOOL_ID_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID_B = "22222222-2222-4222-8222-222222222222";
const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-IN-26-001";
const LOGIN_B = "BI-BUJ-26-001";

function schoolAdmin(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "admin-a",
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    schoolId: SCHOOL_ID_A,
    schoolPublicCode: LOGIN_A,
    ...overrides,
  };
}

function userRow(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    id: "usr-a",
    firstName: "Ada",
    lastName: "Lovelace",
    role: "Secrétaire",
    status: "Actif",
    schoolCode: LOGIN_A,
    schoolId: SCHOOL_ID_A,
    schoolPublicCode: LOGIN_A,
    ...overrides,
  };
}

function stateOf(users: UserAccount[]) {
  return { schools: [], users, countries: [], subscriptions: [], notifications: [] };
}

describe("scopedUsers — SCHOOL_ADMIN identité canonique (préprod-like)", () => {
  it("A — API retourne les utilisateurs de l'école → le client les conserve", () => {
    const users = [
      userRow({ id: "usr-1" }),
      userRow({ id: "usr-2", firstName: "Grace" }),
    ];
    const result = diagnoseScopedUsers(schoolAdmin(), stateOf(users));
    expect(result.trace.received).toBe(2);
    expect(result.trace.kept).toBe(2);
    expect(result.trace.error).toBeNull();
    expect(result.users.map((row) => row.id)).toEqual(["usr-1", "usr-2"]);
  });

  it("B — API retourne [] → le client affiche réellement 0, sans erreur", () => {
    const result = diagnoseScopedUsers(schoolAdmin(), stateOf([]));
    expect(result.trace.received).toBe(0);
    expect(result.trace.kept).toBe(0);
    expect(result.trace.error).toBeNull();
    expect(result.users).toEqual([]);
  });

  it("C — utilisateur autre école jamais visible", () => {
    const users = [
      userRow({ id: "usr-a" }),
      userRow({
        id: "usr-b",
        schoolId: SCHOOL_ID_B,
        schoolCode: LOGIN_B,
        schoolPublicCode: LOGIN_B,
      }),
    ];
    const result = diagnoseScopedUsers(schoolAdmin(), stateOf(users));
    expect(result.users.map((row) => row.id)).not.toContain("usr-b");
    expect(result.trace.security).toBe(true);
    expect(result.trace.error).toBe("MULTI_TENANT_RESPONSE");
    expect(result.users).toEqual([]);
  });

  it("D — leftover JWT ≠ login_code ne doit pas effacer les données autorisées", () => {
    const session = schoolAdmin({ schoolCode: LEFTOVER_A, schoolPublicCode: LOGIN_A });
    const users = [userRow({ schoolCode: LOGIN_A, schoolId: SCHOOL_ID_A })];
    expect(session.schoolCode).not.toBe(users[0]?.schoolCode);
    const result = diagnoseScopedUsers(session, stateOf(users));
    expect(result.trace.leftoverDiffersFromPublic).toBe(true);
    expect(result.users).toHaveLength(1);
    expect(result.trace.error).toBeNull();
    expect(scopedUsers(session, stateOf(users))).toHaveLength(1);
  });

  it("E — absence d'identité canonique → fail closed, pas un succès vide", () => {
    const session = schoolAdmin({ schoolId: "", schoolPublicCode: "" });
    const users = [userRow()];
    const result = diagnoseScopedUsers(session, stateOf(users));
    expect(result.users).toEqual([]);
    expect(result.trace.error).toBe("CANONICAL_IDENTITY_MISSING");
    expect(result.trace.received).toBe(1);
    expect(result.trace.kept).toBe(0);
  });

  it("I — régression préprod : GET users non vide + leftover JWT → plus de [] silencieux", () => {
    const session = schoolAdmin();
    const apiUsers = [
      userRow({ id: "preprod-1", schoolCode: LOGIN_A }),
      userRow({ id: "preprod-2", schoolCode: LOGIN_A, firstName: "Binta" }),
    ];
    const legacyFilter = apiUsers.filter(
      (account) =>
        String(account.schoolCode).toLowerCase() === String(session.schoolCode).toLowerCase(),
    );
    expect(legacyFilter).toHaveLength(0);
    const result = diagnoseScopedUsers(session, stateOf(apiUsers));
    expect(result.users).toHaveLength(2);
    expect(result.trace.received).toBe(2);
    expect(result.trace.kept).toBe(2);
    expect(result.trace.backendCanonical).toBe("school_id");
  });
});
