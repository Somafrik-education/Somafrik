import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AcademicYear } from "./academicYearsApi";
import {
  legacyScopedAcademicYearsBySchoolCode,
  scopeAcademicYearsForConfiguration,
} from "./academicYearsScope";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { isLegacySchoolCode, isV2SchoolLoginCode } from "./schoolCanonicalIdentity";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOGIN_A = "CD-IN-26-001";
const LEFTOVER_A = "CD-2026-0001";

function yearA(overrides: Partial<AcademicYear> = {}): AcademicYear {
  return {
    id: "ay-nuru-2026",
    schoolId: SCHOOL_ID_A,
    schoolCode: LOGIN_A,
    name: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-07-31",
    status: "Ouverte",
    isCurrent: true,
    ...overrides,
  };
}

describe("preuve leftover school_code ≠ login_code V2", () => {
  it("documente le mismatch préprod : session leftover vs année projetée login_code", () => {
    expect(isLegacySchoolCode(LEFTOVER_A)).toBe(true);
    expect(isV2SchoolLoginCode(LOGIN_A)).toBe(true);
    expect(LEFTOVER_A).not.toBe(LOGIN_A);
    expect(yearA().schoolCode).toBe(LOGIN_A);
    expect(yearA().schoolCode).not.toBe(LEFTOVER_A);
  });

  it("AVANT : year.schoolCode === configTarget leftover masque l'année existante", () => {
    const hidden = legacyScopedAcademicYearsBySchoolCode([yearA()], LEFTOVER_A);
    expect(hidden).toEqual([]);
  });

  it("APRÈS : school_code leftover + login_code V2 + année existante → année visible", () => {
    const scoped = scopeAcademicYearsForConfiguration({
      role: SCHOOL_ADMIN_ROLE,
      rows: [yearA()],
      selectedSchool: { id: SCHOOL_ID_A, code: LEFTOVER_A, publicId: LOGIN_A },
      sessionSchoolId: SCHOOL_ID_A,
    });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.name).toBe("2026-2027");
    expect(scoped[0]?.schoolCode).toBe(LOGIN_A);
  });
});

describe("Admin établissement — confiance au scope serveur UUID", () => {
  it("ne refait pas un filtre leftover même si schoolId session est absent", () => {
    const scoped = scopeAcademicYearsForConfiguration({
      role: SCHOOL_ADMIN_ROLE,
      rows: [yearA()],
      selectedSchool: { code: LEFTOVER_A },
      sessionSchoolId: "",
    });
    expect(scoped).toHaveLength(1);
  });

  it("garde l'année serveur sans schoolId (identité incomplète ≠ leftover)", () => {
    const scoped = scopeAcademicYearsForConfiguration({
      role: SCHOOL_ADMIN_ROLE,
      rows: [yearA({ schoolId: "" })],
      selectedSchool: { id: SCHOOL_ID_A, code: LEFTOVER_A },
      sessionSchoolId: SCHOOL_ID_A,
    });
    expect(scoped).toHaveLength(1);
  });

  it("schoolId UUID écarte une année étrangère sans autoriser leftover", () => {
    const foreign = yearA({
      id: "ay-b",
      schoolId: SCHOOL_ID_B,
      schoolCode: LEFTOVER_A,
      name: "2025-2026",
    });
    const scoped = scopeAcademicYearsForConfiguration({
      role: SCHOOL_ADMIN_ROLE,
      rows: [yearA(), foreign],
      selectedSchool: { id: SCHOOL_ID_A, code: LEFTOVER_A },
      sessionSchoolId: SCHOOL_ID_A,
    });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.schoolId).toBe(SCHOOL_ID_A);
    expect(scoped.some((row) => row.schoolCode === LEFTOVER_A)).toBe(false);
  });
});

describe("Superadmin / Admin Pays — filtre fail-closed schoolId", () => {
  it("garde l'année de l'établissement sélectionné par UUID malgré leftover code", () => {
    const scoped = scopeAcademicYearsForConfiguration({
      role: SUPER_ADMIN_ROLE,
      rows: [
        yearA(),
        yearA({ id: "ay-b", schoolId: SCHOOL_ID_B, schoolCode: "BI-EC-26-001", name: "2025-2026" }),
      ],
      selectedSchool: { id: SCHOOL_ID_A, code: LEFTOVER_A, publicId: LOGIN_A },
    });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.schoolId).toBe(SCHOOL_ID_A);
  });

  it("Admin Pays : même autorité UUID, leftover n'est pas une clé", () => {
    const scoped = scopeAcademicYearsForConfiguration({
      role: COUNTRY_ADMIN_ROLE,
      rows: [yearA({ schoolCode: LEFTOVER_A })],
      selectedSchool: { id: SCHOOL_ID_A, code: LEFTOVER_A },
    });
    expect(scoped).toHaveLength(1);
  });

  it("école sélectionnée sans schoolId → fail-closed, leftover code ignoré", () => {
    const scoped = scopeAcademicYearsForConfiguration({
      role: SUPER_ADMIN_ROLE,
      rows: [yearA(), yearA({ schoolCode: LEFTOVER_A })],
      selectedSchool: { code: LEFTOVER_A, publicId: LOGIN_A },
    });
    expect(scoped).toEqual([]);
  });

  it("année sans schoolId → exclue (pas d'autorisation par login_code ni leftover)", () => {
    const scoped = scopeAcademicYearsForConfiguration({
      role: SUPER_ADMIN_ROLE,
      rows: [yearA({ schoolId: "" }), yearA({ schoolId: undefined, schoolCode: LEFTOVER_A })],
      selectedSchool: { id: SCHOOL_ID_A, code: LEFTOVER_A, publicId: LOGIN_A },
    });
    expect(scoped).toEqual([]);
  });

  it("year.schoolCode leftover + schoolId étranger → masquée", () => {
    const scoped = scopeAcademicYearsForConfiguration({
      role: SUPER_ADMIN_ROLE,
      rows: [yearA({ schoolId: SCHOOL_ID_B, schoolCode: LEFTOVER_A })],
      selectedSchool: { id: SCHOOL_ID_A, code: LEFTOVER_A },
    });
    expect(scoped).toEqual([]);
  });
});

describe("garde source ConfigurationPage — leftover n'est plus une autorité", () => {
  const page = readFileSync(resolve(__dirname, "../pages/ConfigurationPage.tsx"), "utf8");

  it("supprime year.schoolCode === configTarget du chargement et de reloadAcademicYears", () => {
    expect(page).not.toMatch(/year\.schoolCode\s*===\s*configTarget/);
    expect(page).toMatch(/scopeAcademicYearsForConfiguration/);
    expect(page.match(/scopeAcademicYearsForConfiguration/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page).toMatch(/async function reloadAcademicYears/);
  });

  it("n'autorise aucun fallback leftover school_code comme autorité", () => {
    expect(page).not.toMatch(/isLegacySchoolCode\([^)]*\)\s*&&/);
    expect(page).not.toMatch(/year\.schoolCode\s*===\s*.*schoolCode/);
  });
});
