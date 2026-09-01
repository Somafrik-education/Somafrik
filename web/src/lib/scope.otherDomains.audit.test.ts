import { describe, expect, it } from "vitest";
import type { PlatformNotification, School, SessionUser, Subscription } from "../types";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import { scopedNotifications, scopedSchools, scopedSubscriptions } from "./scope";

/**
 * Audit #456 — leftover JWT vs login_code V2 sur les scopes hors users.
 *
 * Cause racine users : projectUsersApiUser réécrit schoolCode en login_code V2
 * alors que le JWT porte encore leftover CC-YYYY-NNNN.
 *
 * Pour schools / subscriptions / notifications, la question est :
 * le payload API porte-t-il déjà login_code dans le champ comparé à user.schoolCode ?
 * Si oui → même bug. Si leftover === leftover → SAFE aujourd'hui (dette latente).
 */
const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOGIN_A = "CD-IN-26-001";
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

function emptyState(overrides: {
  schools?: School[];
  subscriptions?: Subscription[];
  notifications?: PlatformNotification[];
} = {}) {
  return {
    schools: overrides.schools ?? [],
    users: [],
    countries: [],
    subscriptions: overrides.subscriptions ?? [],
    notifications: overrides.notifications ?? [],
  };
}

describe("audit #456 — scopedSchools (SAFE aujourd'hui)", () => {
  it("preuve payload : leftover JWT === leftover school.code conserve l'établissement", () => {
    const session = schoolAdmin();
    const apiSchool = {
      id: SCHOOL_ID_A,
      code: LEFTOVER_A,
      loginCode: LOGIN_A,
      publicId: LOGIN_A,
      legacySchoolCode: LEFTOVER_A,
      name: "Nuru",
    } as School & { loginCode: string; legacySchoolCode: string };

    expect(session.schoolCode).toBe(apiSchool.code);
    expect(session.schoolCode).not.toBe(apiSchool.loginCode);
    expect(scopedSchools(session, emptyState({ schools: [apiSchool] }))).toHaveLength(1);
  });

  it("dette latente : si `code` était projeté en login_code V2, leftover JWT viderait la liste", () => {
    const session = schoolAdmin();
    const projectedAsLoginCode = { id: SCHOOL_ID_A, code: LOGIN_A, name: "Nuru" } as School;
    expect(session.schoolCode).not.toBe(projectedAsLoginCode.code);
    expect(scopedSchools(session, emptyState({ schools: [projectedAsLoginCode] }))).toHaveLength(0);
  });
});

describe("audit #456 — scopedSubscriptions (SAFE aujourd'hui)", () => {
  it("preuve payload : leftover JWT === leftover subscription.schoolCode conserve l'abonnement", () => {
    const session = schoolAdmin();
    const apiSubscription = {
      id: "sub-1",
      schoolId: SCHOOL_ID_A,
      schoolCode: LEFTOVER_A,
      plan: "Standard",
    } as Subscription & { schoolId: string };

    expect(session.schoolCode).toBe(apiSubscription.schoolCode);
    expect(session.schoolCode).not.toBe(LOGIN_A);
    expect(
      scopedSubscriptions(session, emptyState({ subscriptions: [apiSubscription] })),
    ).toHaveLength(1);
  });

  it("dette latente : schoolCode projeté login_code + leftover JWT viderait les abonnements", () => {
    const session = schoolAdmin();
    const projectedAsLoginCode = {
      id: "sub-1",
      schoolId: SCHOOL_ID_A,
      schoolCode: LOGIN_A,
    } as Subscription & { schoolId: string };
    expect(session.schoolCode).not.toBe(projectedAsLoginCode.schoolCode);
    expect(
      scopedSubscriptions(session, emptyState({ subscriptions: [projectedAsLoginCode] })),
    ).toHaveLength(0);
  });
});

describe("audit #456 — scopedNotifications (SAFE aujourd'hui)", () => {
  it("preuve payload : leftover JWT === leftover notification.schoolCode conserve la notif", () => {
    const session = schoolAdmin();
    const apiNotification = {
      id: "n-1",
      schoolId: SCHOOL_ID_A,
      schoolCode: LEFTOVER_A,
      audience: "BackOffice",
      title: "Info",
      message: "x",
    } as PlatformNotification & { schoolId: string };

    expect(session.schoolCode).toBe(apiNotification.schoolCode);
    expect(
      scopedNotifications(session, emptyState({ notifications: [apiNotification] })),
    ).toHaveLength(1);
  });

  it("dette latente : schoolCode login_code sans audience établissement viderait la notif", () => {
    const session = schoolAdmin();
    const projectedAsLoginCode = {
      id: "n-1",
      schoolId: SCHOOL_ID_A,
      schoolCode: LOGIN_A,
      audience: "BackOffice",
      title: "Info",
      message: "x",
    } as PlatformNotification & { schoolId: string };
    expect(session.schoolCode).not.toBe(projectedAsLoginCode.schoolCode);
    expect(
      scopedNotifications(session, emptyState({ notifications: [projectedAsLoginCode] })),
    ).toHaveLength(0);
  });

  it("filet audience : « etablissement » conserve même si leftover ≠ login_code", () => {
    const session = schoolAdmin();
    const byAudience = {
      id: "n-2",
      schoolCode: LOGIN_A,
      audience: "etablissement",
      title: "Info",
      message: "x",
    } as PlatformNotification;
    expect(session.schoolCode).not.toBe(byAudience.schoolCode);
    expect(scopedNotifications(session, emptyState({ notifications: [byAudience] }))).toHaveLength(1);
  });
});
