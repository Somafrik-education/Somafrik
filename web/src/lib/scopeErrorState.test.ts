import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import {
  combinedScopeError,
  EMPTY_DOMAIN_SCOPE_ERRORS,
  mergeDomainScopeErrors,
  scopeErrorPatchFromLoadedDomains,
} from "./scopeErrorState";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOGIN_A = "CD-IN-26-001";
const LEFTOVER_A = "CD-2026-0001";

function schoolAdmin(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "admin-nuru",
    firstName: "Admin",
    lastName: "Nuru",
    role: SCHOOL_ADMIN_ROLE,
    schoolCode: LEFTOVER_A,
    schoolPublicCode: LOGIN_A,
    schoolId: SCHOOL_ID_A,
    identifier: "admin-nuru",
    ...overrides,
  } as SessionUser;
}

function pgStudent(index: number, overrides: Record<string, unknown> = {}) {
  const seq = String(index + 1).padStart(5, "0");
  return {
    id: `CD-IN-EL-26-${seq}`,
    schoolId: SCHOOL_ID_A,
    schoolCode: LOGIN_A,
    schoolPublicCode: LOGIN_A,
    ...overrides,
  };
}

describe("scopeErrorState — cycle de vie par domaine", () => {
  it("merge : un GET users propre ne touche pas students", () => {
    const previous = {
      users: null,
      students: "Alerte sécurité : la réponse élèves contient un autre établissement. Ces élèves sont masqués.",
    };
    const next = mergeDomainScopeErrors(previous, { users: null });
    expect(next.users).toBeNull();
    expect(next.students).toBe(previous.students);
  });

  it("merge : un GET students propre pose students = null", () => {
    const previous = {
      users: "Alerte sécurité : la réponse utilisateurs contient un autre établissement. Ces comptes sont masqués.",
      students: "Alerte sécurité : la réponse élèves contient un autre établissement. Ces élèves sont masqués.",
    };
    const next = mergeDomainScopeErrors(previous, { students: null });
    expect(next.users).toBe(previous.users);
    expect(next.students).toBeNull();
  });

  it("combinedScopeError concatène users puis students", () => {
    expect(combinedScopeError(EMPTY_DOMAIN_SCOPE_ERRORS)).toBeNull();
    expect(combinedScopeError({ users: "U", students: null })).toBe("U");
    expect(combinedScopeError({ users: null, students: "S" })).toBe("S");
    expect(combinedScopeError({ users: "U", students: "S" })).toBe("U S");
  });

  it("patch users seul : GET users propre → users null, students absent du patch", () => {
    const user = schoolAdmin();
    const leakStudents = [
      pgStudent(0),
      pgStudent(1, { schoolId: SCHOOL_ID_B, schoolCode: "BI-EC-26-001" }),
    ];
    const patch = scopeErrorPatchFromLoadedDomains(["users"], user, {
      users: [{ id: "u1", schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A } as never],
      students: leakStudents as never,
    });
    expect(patch).toEqual({ users: null });
    expect(patch).not.toHaveProperty("students");
  });

  it("patch students seul : payload mixte → INCOMPLETE_ROW_IDENTITY, users absent du patch", () => {
    const user = schoolAdmin();
    const mixed = [...Array.from({ length: 14 }, (_, index) => pgStudent(index)), pgStudent(14, { schoolId: "" })];
    const patch = scopeErrorPatchFromLoadedDomains(["students"], user, {
      users: [],
      students: mixed as never,
    });
    expect(patch.users).toBeUndefined();
    expect(patch.students).toMatch(/schoolId/i);
    expect(patch.students).toMatch(/masqu/i);
  });

  it("patch students seul : GET students propre → students null", () => {
    const user = schoolAdmin();
    const clean = Array.from({ length: 15 }, (_, index) => pgStudent(index));
    const patch = scopeErrorPatchFromLoadedDomains(["students"], user, {
      users: [],
      students: clean as never,
    });
    expect(patch).toEqual({ students: null });
  });
});
