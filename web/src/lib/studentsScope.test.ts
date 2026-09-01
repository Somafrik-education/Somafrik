import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import { isLegacySchoolCode, isV2SchoolLoginCode } from "./schoolCanonicalIdentity";
import {
  legacyScopedStudentsBySchoolCode,
  projectScopedStudents,
  scopedStudentsBySchoolId,
} from "./studentsScope";
import { scopedStudents } from "./establishment";
import type { BackOfficeState } from "../types";

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
    publicId: `CD-IN-EL-26-${seq}`,
    studentCode: `CD-IN-EL-26-${seq}`,
    matricule: `CD-IN-EL-26-${seq}`,
    firstName: `Prenom${index + 1}`,
    lastName: `Nom${index + 1}`,
    name: `Prenom${index + 1} Nom${index + 1}`,
    className: index % 2 === 0 ? "6ème A" : "5ème B",
    schoolId: SCHOOL_ID_A,
    schoolCode: LOGIN_A,
    schoolPublicCode: LOGIN_A,
    status: "active",
    ...overrides,
  };
}

function stateOf(students: ReturnType<typeof pgStudent>[]): BackOfficeState {
  return { students } as unknown as BackOfficeState;
}

describe("preuve A — leftover JWT vs GET /students login_code", () => {
  it("documente le contrat préprod : N élèves API, schoolCode V2, leftover session", () => {
    const session = schoolAdmin();
    const payload = Array.from({ length: 15 }, (_, index) => pgStudent(index));

    expect(payload).toHaveLength(15);
    expect(isLegacySchoolCode(session.schoolCode)).toBe(true);
    expect(isV2SchoolLoginCode(payload[0].schoolCode)).toBe(true);
    expect(session.schoolCode).not.toBe(payload[0].schoolCode);
    expect(session.schoolId).toBe(payload[0].schoolId);
    expect(session.schoolPublicCode).toBe(payload[0].schoolPublicCode);
  });

  it("AVANT : comparaison schoolCode → state.students=15, scopedStudents=0", () => {
    const session = schoolAdmin();
    const payload = Array.from({ length: 15 }, (_, index) => pgStudent(index));
    const state = stateOf(payload);

    expect(state.students).toHaveLength(15);
    expect(legacyScopedStudentsBySchoolCode(session, state)).toHaveLength(0);
  });

  it("APRÈS : schoolId membership → scopedStudents=15, leftover jamais autorité", () => {
    const session = schoolAdmin();
    const payload = Array.from({ length: 15 }, (_, index) => pgStudent(index));
    const state = stateOf(payload);
    const projection = projectScopedStudents(session, state);

    expect(projection.error).toBeNull();
    expect(projection.received).toBe(15);
    expect(projection.kept).toBe(15);
    expect(scopedStudentsBySchoolId(session, state)).toHaveLength(15);
    expect(scopedStudents(session, state)).toHaveLength(15);
    expect(projection.trace.kind).toBe("students_scope_trace");
    expect(projection.trace.session.hasSchoolId).toBe(true);
    expect(projection.trace.session.leftoverPresent).toBe(true);
    expect(projection.trace.api.received).toBe(15);
    expect(projection.trace.api.distinctSchoolIds).toBe(1);
    expect(JSON.stringify(projection.trace)).not.toMatch(/Prenom|Nom\d/);
  });
});

describe("scopedStudents — SCHOOL_ADMIN schoolId fail-closed", () => {
  it("SCHOOL_ADMIN A ne conserve aucun élève B", () => {
    const sessionA = schoolAdmin();
    const foreign = [
      pgStudent(0, { schoolId: SCHOOL_ID_B, schoolCode: "BI-EC-26-001", schoolPublicCode: "BI-EC-26-001" }),
    ];
    const projection = projectScopedStudents(sessionA, stateOf(foreign));
    expect(projection.students).toEqual([]);
    expect(projection.error?.code).toBe("SCOPE_LEAK");
    expect(scopedStudents(sessionA, stateOf(foreign))).toEqual([]);
  });

  it("schoolId session absent → fail-closed visible, pas un 0 silencieux", () => {
    const session = schoolAdmin({ schoolId: "" });
    const payload = [pgStudent(0)];
    const projection = projectScopedStudents(session, stateOf(payload));
    expect(projection.students).toEqual([]);
    expect(projection.error?.code).toBe("MISSING_CANONICAL_IDENTITY");
    expect(projection.error?.message).toMatch(/schoolId/i);
  });

  it("schoolId session présent + row sans schoolId → pas d'autorisation par leftover/publicCode", () => {
    const session = schoolAdmin();
    const row = pgStudent(0, { schoolId: "" });
    const projection = projectScopedStudents(session, stateOf([row]));
    expect(projection.students).toEqual([]);
    expect(projection.error?.code).toBe("SCOPE_MISMATCH");
  });

  it("publicCode / leftover ne sont jamais une autorité même s'ils matchent", () => {
    const session = schoolAdmin();
    const leftoverOnly = pgStudent(0, { schoolId: SCHOOL_ID_B, schoolCode: LEFTOVER_A, schoolPublicCode: LOGIN_A });
    expect(legacyScopedStudentsBySchoolCode(session, stateOf([leftoverOnly]))).toHaveLength(1);
    expect(scopedStudents(session, stateOf([leftoverOnly]))).toEqual([]);
  });
});
