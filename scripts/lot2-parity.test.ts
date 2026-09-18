/**
 * Contrats LOT 2 — PARITY-013 / 014 / 031 / 032.
 *
 *   npx --yes tsx --test scripts/lot2-parity.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("PARITY-013 fiche Mobile charge GET /api/students/:id et 6 cartes repliées", () => {
  const fiche = read("Mobile/src/screens/StudentDetailScreen.tsx");
  const ids = read("Mobile/src/lib/studentFicheLot2.ts");
  assert.match(fiche, /getSchoolStudent/);
  assert.doesNotMatch(fiche, /findStudentByIdentity\(studentsData/);
  assert.match(fiche, /ExpandableEntityCard/);
  assert.match(fiche, /STUDENT_FICHE_LOT2_TEST_IDS\.identityCard/);
  assert.match(fiche, /STUDENT_FICHE_LOT2_TEST_IDS\.enrollmentCard/);
  assert.match(fiche, /STUDENT_FICHE_LOT2_TEST_IDS\.guardiansCard/);
  assert.match(fiche, /STUDENT_FICHE_LOT2_TEST_IDS\.notesCard/);
  assert.match(fiche, /STUDENT_FICHE_LOT2_TEST_IDS\.presencesCard/);
  assert.match(fiche, /STUDENT_FICHE_LOT2_TEST_IDS\.paymentsCard/);
  assert.match(ids, /student-fiche-identity-card/);
  assert.match(ids, /student-fiche-enrollment-card/);
  assert.match(ids, /student-fiche-guardians-card/);
  assert.match(ids, /student-fiche-notes-card/);
  assert.match(ids, /student-fiche-presences-card/);
  assert.match(ids, /student-fiche-payments-card/);
});

test("PARITY-014 responsables : lecture relations + link/archive existants, pas EntityPage ni backoffice/relations", () => {
  const fiche = read("Mobile/src/screens/StudentDetailScreen.tsx");
  const server = read("backend/server.js");
  const api = read("Mobile/src/services/api.ts");
  assert.match(fiche, /getParentRelations/);
  assert.match(fiche, /linkParent/);
  assert.match(fiche, /archiveParentRelation/);
  assert.match(server, /app\.get\("\/api\/parents\/relations"/);
  assert.match(api, /\/parents\/identity/);
  assert.match(api, /\/parents\/link/);
  assert.doesNotMatch(fiche, /EntityPage/);
  assert.doesNotMatch(api, /\/backoffice\/relations/);
});

test("PARITY-031 classe-first : pas de CTA Toutes les classes, POST /classes/:classCode/students, jamais POST /students", () => {
  const students = read("Mobile/src/screens/StudentsScreen.tsx");
  const mutation = read("Mobile/src/components/StudentMutationControls.tsx");
  const server = read("backend/server.js");
  assert.match(students, /Toutes les classes/);
  assert.match(students, /isAllClassesView/);
  assert.match(mutation, /enrollClassStudent/);
  assert.match(server, /app\.post\("\/api\/classes\/:classCode\/students"/);
  assert.doesNotMatch(server, /app\.post\("\/api\/students"/);
  assert.doesNotMatch(mutation, /request\(["']\/students["']/);
});

test("PARITY-032 C18 REST canonique PostgreSQL, pas de machine Expo", () => {
  const server = read("backend/server.js");
  const c18 = read("backend/lib/studentEnrollmentC18.js");
  const hook = read("web/src/hooks/useStudentEditingContext.ts");
  const httpApi = read("web/src/lib/studentEnrollmentC18Api.ts");
  const mobileFiche = read("Mobile/src/screens/StudentDetailScreen.tsx");
  const mobileApi = read("Mobile/src/services/api.ts");
  assert.match(server, /\/api\/students\/:studentId\/enrollments/);
  assert.match(server, /\/enrollments\/:enrollmentId\/validate/);
  assert.match(server, /\/assign-class/);
  assert.match(server, /\/transfer/);
  assert.match(server, /\/close/);
  assert.match(c18, /PRE_REGISTERED/);
  assert.match(c18, /PENDING_REVIEW/);
  assert.match(c18, /INCOMPLETE/);
  assert.match(c18, /APPROVED/);
  assert.match(c18, /ENROLLED/);
  assert.match(c18, /TRANSFERRED/);
  assert.match(c18, /CLOSED/);
  assert.match(hook, /studentEnrollmentC18Api|wrapRepositoryWithHttpC18/);
  assert.match(httpApi, /\/enrollments/);
  assert.match(mobileApi, /validateStudentEnrollment/);
  assert.match(mobileApi, /assignStudentEnrollmentClass/);
  assert.match(mobileApi, /transferStudentEnrollment/);
  assert.match(mobileApi, /closeStudentEnrollment/);
  assert.match(mobileFiche, /validateStudentEnrollment/);
  assert.match(mobileFiche, /STUDENT_FICHE_LOT2_TEST_IDS\.c18ValidateButton/);
  assert.doesNotMatch(mobileFiche, /nextStatusAfterValidate/);
  assert.doesNotMatch(mobileFiche, /nextStatusAfterAssignClass/);
  const classStudents = read("backend/db/classStudentsRepository.js");
  assert.match(classStudents, /enrollments: enrollments\.map\(mapEnrollmentRow\)/);
  assert.match(classStudents, /VALUES \(\$1, \$2, \$3, \$4, CURRENT_DATE, 'ENROLLED'\)/);
  assert.match(classStudents, /st\.student_code = \$1 OR st\.id::text = \$1/);
  const c18Http = read("backend/lib/studentEnrollmentC18.http.pg.test.js");
  assert.match(c18Http, /student_code FROM students WHERE id/);
  const identity = read("backend/lib/studentIdentityMatch.js");
  assert.match(identity, /studentCode/);
  assert.match(server, /findStudentByIdentity/);
  const ficheGuardians = read("Mobile/src/lib/studentFicheGuardians.ts");
  assert.match(ficheGuardians, /GuardiansLoadState/);
  assert.match(mobileFiche, /classifyGuardiansLoad/);
  assert.match(mobileFiche, /guardiansUnavailable/);
  const inventory = read("Mobile/src/lib/mobileMutationInventory.ts");
  assert.match(inventory, /validateStudentEnrollment[\s\S]*outbox: false/);
  assert.match(c18Http, /autre tenant|tokenB/);
  assert.match(c18Http, /X-Somafrik-School-Code/);
  assert.match(c18Http, /tokenParent/);
  assert.match(c18Http, /tokenStudent/);
  assert.match(c18Http, /tokenTeacher/);
  const financePg = read("backend/db/financePgStore.js");
  assert.match(financePg, /ROSTER_ENROLLMENT_SQL/);
  assert.doesNotMatch(financePg, /e\.status = 'active'/);

  assert.match(c18, /persistC18Audit/);
  assert.match(c18, /repository\.recordAudit/);
  assert.match(c18, /withTransaction/);
  assert.match(c18, /ensureEnrollmentObligationsInTx/);
  assert.match(c18, /classChanged && !effectiveDate/);
  const httpRepo = read("web/src/lib/studentEnrollmentHttpRepository.ts");
  const webActions = read("web/src/components/students/StudentEnrollmentActions.tsx");
  const c18Unit = read("backend/lib/studentEnrollmentC18.test.js");
  assert.match(httpRepo, /toApiDate\(command\.changes\.effectiveDate\)/);
  assert.match(webActions, /assignEffectiveDate/);
  assert.match(webActions, /enrollment-assign-effective-date/);
  assert.match(mobileApi, /effectiveDate\?: string/);
  assert.match(mobileFiche, /toApiDate\(assignEffectiveDate\)/);
  assert.match(c18Http, /latestAudit\("c18_validate"\)/);
  assert.match(c18Http, /latestAudit\("c18_assign-class"\)/);
  assert.match(c18Http, /latestAudit\("c18_transfer"\)/);
  assert.match(c18Http, /latestAudit\("c18_close"\)/);
  assert.match(c18Http, /noDate\.status, 409/);
  assert.match(c18Http, /effectiveDate: "2026-09-18"/);
  assert.match(c18Http, /moved\.status, 200/);
  assert.match(c18Http, /CLASS_OLD/);
  assert.match(c18Unit, /FINANCE_INJECTED_FAILURE/);
  assert.match(c18Unit, /state\.class_id, "class-a"/);
  const fallback = read("backend/db/fallbackRepository.js");
  assert.match(fallback, /ST\.STUDENT_CODE = \$1/);
  assert.doesNotMatch(
    fallback,
    /includes\("WHERE ST\.STUDENT_CODE"\)/,
  );
});

test("PARITY-032 migration C18 : dollar-quote PostgreSQL valide", () => {
  const schema = read("backend/db/enrollmentC18Schema.js");
  const migration = read("backend/db/migrations/20260918_enrollments_c18_additive.sql");
  assert.doesNotMatch(schema, /\$c18\$class\$/);
  assert.doesNotMatch(migration, /\$c18\$class\$/);
  assert.match(schema, /\$c18_enroll\$/);
  assert.match(migration, /\$c18_enroll\$/);
});

test("LOT 2 CI gate exécute test:lot2-parity sans casser LOT 0/1", () => {
  const gates = read(".github/workflows/pr-gates.yml");
  const requiredJob = gates.slice(gates.indexOf("name: Required"));
  assert.match(gates, /name: LOT 0 parity/);
  assert.match(gates, /name: LOT 1 parity/);
  assert.match(gates, /name: LOT 2 parity/);
  assert.match(gates, /npm run test:lot2-parity/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot0[^\]]*\]/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot1[^\]]*\]/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot2[^\]]*\]/);
  assert.match(requiredJob, /LOT2: \$\{\{ needs\.lot2\.result \}\}/);
  assert.match(requiredJob, /"\$LOT2"/);
});
