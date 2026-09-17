"use strict";

/**
 * DEMO-FINANCE-ASSIGNMENTS-P0 — GREEN-A Finance + GREEN-B Affectations.
 *
 * Triplet Démo :
 *   schoolId      UUID PostgreSQL
 *   schoolCode    SCH-BULK-CD-0001  (schools.school_code / JWT)
 *   loginCode     CD-IN-26-001      (schools.login_code / finance mappedSchoolCode)
 *
 * DEMO-PRES-RED-01 : GREEN-B Affectations / Présences.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TenantScopeService } = require("../services/tenantScopeService");
const { mapPaymentRow, mapObligationRow } = require("./financeManagement");
const { mapAssignment } = require("../db/teacherAssignmentsRepository");
const {
  resolveAssignmentsSyncScope,
  resolveAssignmentsLiveSchoolId,
  resolveLiveAssignmentsSyncSnapshot,
} = require("./mobileSyncScope");
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

function canonicalAssignmentRow(overrides = {}) {
  return mapAssignment({
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
    ...overrides,
  });
}

function liveRolesRepo(roleKeysBySchool = {}) {
  return {
    async listActiveUserRoleKeys() {
      throw new Error("listActiveUserRoleKeys unscoped ne doit pas être appelé par Assignments");
    },
    async listActiveUserRoleKeysForSchool(_userId, schoolId) {
      return roleKeysBySchool[String(schoolId)] ?? [];
    },
    async resolveEffectivePermissions() {
      return { permissions: ["Affectations:READ", "Enseignants:READ"] };
    },
  };
}

test("DEMO-PRES-RED-01 — affectation PG canonique + Admin établissement live ⇒ school-wide", async () => {
  const pgRow = canonicalAssignmentRow();
  assert.equal(pgRow.classId, CLASS_1ERE_A_ID);
  assert.equal(pgRow.classCode, "CLS-1ERE-A");
  assert.equal(pgRow.status, "active");
  assert.equal(pgRow.schoolId, DEMO_SCHOOL_ID);
  assert.equal(pgRow.schoolCode, DEMO_SCHOOL_CODE);
  assert.equal(pgRow.teacherId, "TCH-SCH-BULK-CD-0001-001");

  const liveAdmin = resolveAssignmentsSyncScope({
    role: "Admin School",
    roles: ["Admin School"],
    roleKeys: ["SCHOOL_ADMIN"],
    schoolId: DEMO_SCHOOL_ID,
    schoolCode: DEMO_SCHOOL_CODE,
  });
  assert.equal(liveAdmin.scopeKind, "school-wide");

  const liveEmpty = resolveAssignmentsSyncScope({
    role: "",
    roles: [],
    roleKeys: [],
    schoolCode: DEMO_SCHOOL_CODE,
  });
  assert.equal(
    liveEmpty.scopeKind,
    "none",
    "rôles live vides : fail-closed, aucun fallback JWT",
  );

  const snapshot = await resolveLiveAssignmentsSyncSnapshot(
    liveRolesRepo({ [DEMO_SCHOOL_ID]: ["SCHOOL_ADMIN"] }),
    {
      sub: "user-demo-admin",
      role: "",
      roles: [],
      roleKeys: [],
      schoolCode: DEMO_SCHOOL_CODE,
      schoolId: DEMO_SCHOOL_ID,
    },
    { schoolCode: DEMO_SCHOOL_CODE },
  );
  assert.equal(snapshot.scope.scopeKind, "school-wide");
  assert.equal(
    resolveAssignmentsLiveSchoolId(
      { schoolId: DEMO_SCHOOL_ID, schoolCode: DEMO_SCHOOL_CODE },
      { schoolCode: DEMO_SCHOOL_CODE },
    ),
    DEMO_SCHOOL_ID,
  );

  const assignmentsHandler = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert.match(
    assignmentsHandler,
    /effectiveSchoolId \|\| req\.principal\.schoolId/,
    "GET /api/assignments doit injecter users.school_id (principal.schoolId)",
  );
  const verifyDemo = fs.readFileSync(
    path.join(__dirname, "../scripts/verify-demo-runtime-data.js"),
    "utf8",
  );
  assert.match(verifyDemo, /\/api\/assignments/);
});

test("GREEN-B HTTP/runtime — Admin établissement + teacher_assignment actif ⇒ scope school-wide", async () => {
  const rows = [canonicalAssignmentRow()];
  const snapshot = await resolveLiveAssignmentsSyncSnapshot(
    {
      ...liveRolesRepo({ [DEMO_SCHOOL_ID]: ["SCHOOL_ADMIN"] }),
      async listSchoolTeacherAssignments() {
        return rows;
      },
    },
    {
      sub: "user-demo-admin",
      role: "Admin School",
      roles: ["Admin School"],
      roleKeys: ["SCHOOL_ADMIN"],
      schoolId: DEMO_SCHOOL_ID,
      schoolCode: DEMO_SCHOOL_CODE,
    },
    { schoolCode: DEMO_SCHOOL_CODE, schoolId: DEMO_SCHOOL_ID },
  );
  assert.equal(snapshot.scope.scopeKind, "school-wide");
  const listed =
    snapshot.scope.scopeKind === "none"
      ? []
      : rows.filter((row) => row.schoolId === DEMO_SCHOOL_ID);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].classId, CLASS_1ERE_A_ID);
  assert.equal(listed[0].status, "active");
});

test("GREEN-B fail-closed — même classCode, schoolId étranger ⇒ 0 fuite", async () => {
  const home = canonicalAssignmentRow();
  const foreign = canonicalAssignmentRow({
    id: "ta-foreign",
    school_id: FOREIGN_SCHOOL_ID,
    school_code: "SCH-BULK-CD-0002",
    class_code: "CLS-1ERE-A",
    class_id: CLASS_1ERE_A_ID,
  });
  const snapshot = await resolveLiveAssignmentsSyncSnapshot(
    liveRolesRepo({ [FOREIGN_SCHOOL_ID]: [] }),
    {
      sub: "user-demo-admin",
      schoolId: DEMO_SCHOOL_ID,
      schoolCode: DEMO_SCHOOL_CODE,
    },
    { schoolCode: DEMO_SCHOOL_CODE, schoolId: FOREIGN_SCHOOL_ID },
  );
  assert.equal(snapshot.scope.scopeKind, "none");
  const kept = tenantScope.filterRows([home, foreign], demoJwtPrincipal());
  assert.deepEqual(
    kept.map((row) => row.id),
    ["ta-uuid-1"],
  );
});

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
