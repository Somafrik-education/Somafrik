import { describe, expect, it } from "vitest";
import type { FeeGrid, SessionUser } from "../types";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import { scopedFeeGrids } from "./fees";

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

function grid(overrides: Partial<FeeGrid> = {}): FeeGrid {
  return {
    id: "FEEGRID-1",
    schoolId: SCHOOL_ID_A,
    schoolCode: LOGIN_A,
    className: "1ère Primaire A",
    academicYear: "2026-2027",
    currency: "CDF",
    status: "Brouillon",
    ...overrides,
  };
}

describe("scopedFeeGrids — identité établissement canonique", () => {
  it("même schoolId, leftover JWT ≠ login_code API → grille visible", () => {
    const user = schoolAdmin();
    expect(user.schoolCode).not.toBe(LOGIN_A);
    expect(scopedFeeGrids(user, { feeGrids: [grid()] } as never)).toHaveLength(1);
  });

  it("schoolId différent, code alias/login_code ressemblant → jamais visible", () => {
    const user = schoolAdmin();
    const spoofed = [
      grid({ id: "g-b-login", schoolId: SCHOOL_ID_B, schoolCode: LOGIN_A }),
      grid({ id: "g-b-leftover", schoolId: SCHOOL_ID_B, schoolCode: LEFTOVER_A }),
    ];
    expect(scopedFeeGrids(user, { feeGrids: spoofed } as never)).toHaveLength(0);
  });
});
