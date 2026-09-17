"use strict";

/**
 * DEMO-FINANCE-ASSIGNMENTS-P0 — GREEN-A Finance (tenant = schoolId UUID).
 *
 * Triplet Démo :
 *   schoolId      UUID PostgreSQL
 *   schoolCode    SCH-BULK-CD-0001  (schools.school_code / JWT)
 *   loginCode     CD-IN-26-001      (schools.login_code / finance mappedSchoolCode)
 *
 * DEMO-PRES-RED-01 reste skippé — GREEN-B Affectations.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TenantScopeService } = require("../services/tenantScopeService");
const { mapPaymentRow, mapObligationRow } = require("./financeManagement");
const { mapAssignment } = require("../db/teacherAssignmentsRepository");
const { resolveAssignmentsSyncScope } = require("./mobileSyncScope");
const { isLegacySchoolCodeFormat, isV2SchoolLoginCode } = require("./schoolCodeV2");

const DEMO_SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEMO_SCHOOL_CODE = "SCH-BULK-CD-0001";
const DEMO_LOGIN_CODE = "CD-IN-26-001";
const FOREIGN_SCHOOL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLASS_1ERE_A_ID = "11111111-1111-4111-8111-111111111111";

const tenantScope = new TenantScopeService();

function demoJwtPrincipal(overrides = {}) {
  return {
    role: "Admin School",
    schoolId: DEMO_SCHOOL_ID,
    schoolCode: DEMO_SCHOOL_CODE,
    sub: "user-demo-admin",
    ...overrides,
  };
}

test("DEMO-FIN-RED-01 — mapObligationRow projette login_code, pas school_code ; filterRows JWT SCH-BULK match schoolId", () => {
  const row = mapObligationRow({
    id: "fee-uuid-1",
    school_id: DEMO_SCHOOL_ID,
    school_code: DEMO_SCHOOL_CODE,
    login_code: DEMO_LOGIN_CODE,
    student_id: "stu-uuid-1",
    student_code: "STU-DEMO-1",
    amount_due: 100000,
    amount_paid: 20000,
    exemption: 0,
    due_date: "2026-01-31",
    fee_type: "Minerval",
    label: "Minerval",
    currency: "CDF",
    academic_year: "2025-2026",
    country_iso: "CD",
  });

  assert.equal(row.schoolId, DEMO_SCHOOL_ID);
  assert.equal(row.schoolCode, DEMO_LOGIN_CODE);
  assert.notEqual(row.schoolCode, DEMO_SCHOOL_CODE);

  const kept = tenantScope.filterRows([row], demoJwtPrincipal(), { countryField: "countryIso" });
  assert.equal(
    kept.length,
    1,
    "GET /api/finance/student-fees ne doit pas jeter les obligations du schoolId sous JWT school_code",
  );
});

test("DEMO-FIN-RED-02 — mapPaymentRow émet schoolId ; filterRows JWT SCH-BULK conserve le tenant UUID", () => {
  const row = mapPaymentRow({
    id: "pay-uuid-1",
    school_id: DEMO_SCHOOL_ID,
    school_code: DEMO_SCHOOL_CODE,
    login_code: DEMO_LOGIN_CODE,
    payment_code: "PAY-DEMO-1",
    student_id: "stu-uuid-1",
    student_code: "STU-DEMO-1",
    amount: 20000,
    currency: "CDF",
    payment_method: "Cash",
    payment_date: "2026-01-15",
    payment_status: "paid",
    country_iso: "CD",
  });

  assert.equal(row.schoolCode, DEMO_LOGIN_CODE);
  assert.equal(row.schoolId, DEMO_SCHOOL_ID);
  assert.notEqual(row.schoolCode, DEMO_SCHOOL_CODE);

  const kept = tenantScope.filterRows([row], demoJwtPrincipal());
  assert.equal(
    kept.length,
    1,
    "GET /api/payments ne doit pas jeter les paiements du tenant sous JWT school_code SCH-BULK",
  );
});

test(
  "DEMO-PRES-RED-01 — GET /api/assignments live roles vides ⇒ scope none alors qu'une affectation PG existe",
  { skip: "GREEN-B Affectations : hors GREEN-A Finance" },
  () => {
    const pgRow = mapAssignment({
      id: "ta-uuid-1",
      school_id: DEMO_SCHOOL_ID,
      school_code: DEMO_SCHOOL_CODE,
      teacher_code: "TCH-SCH-BULK-CD-0001-001",
      first_name: "Seke",
      last_name: "Mwamba",
      class_id: CLASS_1ERE_A_ID,
      class_name: "1ère A",
      class_code: "CLS-1ERE-A",
      subject_name: "Mathématiques",
      subject_code: "MATH",
      academic_year_name: "2025-2026",
      assignment_role: "primary",
      status: "active",
    });

    assert.equal(pgRow.classId, CLASS_1ERE_A_ID);
    assert.equal(pgRow.className, "1ère A");
    assert.equal(pgRow.status, "active");
    assert.equal(pgRow.schoolCode, DEMO_SCHOOL_CODE);
    assert.equal(pgRow.teacherId, "TCH-SCH-BULK-CD-0001-001");

    const jwtAdmin = resolveAssignmentsSyncScope({
      role: "Admin School",
      schoolCode: DEMO_SCHOOL_CODE,
    });
    assert.equal(jwtAdmin.scopeKind, "school-wide");

    const liveEmpty = resolveAssignmentsSyncScope({
      role: "",
      roles: [],
      roleKeys: [],
      schoolCode: DEMO_SCHOOL_CODE,
    });
    assert.notEqual(
      liveEmpty.scopeKind,
      "none",
      "Un Admin School Démo ne doit pas voir GET /api/assignments retomber en scope none (HTTP [])",
    );
  },
);

test("DEMO-TENANT-RED-01 — schoolId, school_code et login_code ne sont pas interchangeables", () => {
  assert.notEqual(DEMO_SCHOOL_ID, DEMO_SCHOOL_CODE);
  assert.notEqual(DEMO_SCHOOL_CODE, DEMO_LOGIN_CODE);
  assert.equal(isV2SchoolLoginCode(DEMO_LOGIN_CODE), true);
  assert.equal(isV2SchoolLoginCode(DEMO_SCHOOL_CODE), false);
  assert.equal(isLegacySchoolCodeFormat(DEMO_SCHOOL_CODE), false);
  assert.equal(isLegacySchoolCodeFormat(DEMO_LOGIN_CODE), false);

  const codes = tenantScope.principalSchoolCodes({
    schoolCode: DEMO_SCHOOL_CODE,
    financeLoginCode: DEMO_LOGIN_CODE,
  });
  assert.equal(codes.has(DEMO_SCHOOL_CODE), true);
  assert.equal(
    codes.has(DEMO_LOGIN_CODE),
    false,
    "login_code V2 n'est pas un alias équivalent de school_code interne",
  );

  // Mélanger school_code et login_code dans le même Set, c'est les traiter
  // comme identifiants équivalents. L'autorité reste schoolId UUID.
  assert.equal(
    codes.size,
    1,
    "principalSchoolCodes ne doit pas fusionner school_code interne et login_code V2 comme alias équivalents",
  );
});

test("GREEN-A multi-tenant — même login_code, UUID différent ⇒ filterRows fail-closed", () => {
  const home = mapPaymentRow({
    id: "pay-home",
    school_id: DEMO_SCHOOL_ID,
    school_code: DEMO_SCHOOL_CODE,
    login_code: DEMO_LOGIN_CODE,
    payment_code: "PAY-HOME",
    amount: 20000,
    payment_status: "paid",
  });
  const foreign = mapPaymentRow({
    id: "pay-foreign",
    school_id: FOREIGN_SCHOOL_ID,
    school_code: "SCH-BULK-CD-0002",
    login_code: DEMO_LOGIN_CODE,
    payment_code: "PAY-FOREIGN",
    amount: 1,
    payment_status: "paid",
  });

  const kept = tenantScope.filterRows([home, foreign], demoJwtPrincipal());
  assert.deepEqual(kept.map((row) => row.id), ["PAY-HOME"]);
});
