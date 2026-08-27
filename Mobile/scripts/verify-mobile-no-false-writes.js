/**
 * L0b / P0 CRUD parity — aucune action Mobile ne doit annoncer une mutation
 * locale comme une écriture PostgreSQL. Les écrans canoniques appellent les APIs.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const SRC = path.join(MOBILE, "src");

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

function runUnit(rel) {
  const unit = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", rel)], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || `${rel} failed`);
  }
  process.stdout.write(unit.stdout || "");
}

function main() {
  runUnit("mobileMutationSafety.test.ts");
  runUnit("mobileCrudParity.test.ts");

  const navigator = read(path.join("navigation", "AppNavigator.tsx"));
  const gate = read(path.join("screens", "SafeAdminCrudScreen.tsx"));
  const permissions = read(path.join("screens", "PermissionsScreen.tsx"));
  const rawAdminCrud = read(path.join("screens", "AdminCrudScreen.tsx"));
  const users = read(path.join("screens", "UsersScreen.tsx"));
  const classes = read(path.join("screens", "ClassesScreen.tsx"));
  const teachers = read(path.join("screens", "TeachersScreen.tsx"));
  const students = read(path.join("screens", "StudentsScreen.tsx"));
  const payments = read(path.join("screens", "PaymentsScreen.tsx"));
  const announcements = read(path.join("screens", "AnnouncementsScreen.tsx"));
  const adminCtx = read(path.join("context", "AdminDataContext.tsx"));

  assert.match(navigator, /SafeAdminCrudScreen/);
  assert.doesNotMatch(
    navigator,
    /component=\{AdminCrudScreen\}/,
    "AppNavigator ne doit jamais exposer AdminCrudScreen sans gate fail-closed",
  );
  assert.match(gate, /canRunGenericAdminCrud/);
  assert.match(gate, /Aucune modification locale n&apos;est appliquée/);
  assert.match(gate, /SAFE_ADMIN_CRUD_ENTITIES|canRunGenericAdminCrud/);

  assert.doesNotMatch(
    permissions,
    /updateRoleFeatureAccess/,
    "PermissionsScreen ne doit plus simuler une attribution ou un retrait de droit local",
  );
  assert.doesNotMatch(permissions, /synchronis[ée]s automatiquement/i);
  assert.match(permissions, /Modification Mobile désactivée/);
  assert.match(permissions, /L’attribution et le retrait des droits ne sont plus simulés localement/);

  assert.match(rawAdminCrud, /if \(entity === "assignments"\)[\s\S]*?await createTeacherAssignment/);
  assert.match(rawAdminCrud, /if \(entity === "courses"\)[\s\S]*?await createCourse/);
  assert.match(rawAdminCrud, /if \(entity === "assignments"\)[\s\S]*?deleteTeacherAssignment/);
  assert.match(rawAdminCrud, /if \(entity === "courses"\)[\s\S]*?deleteCourse/);

  const safety = read(path.join("lib", "mobileMutationSafety.ts"));
  assert.match(safety, /MOBILE_GENERIC_ADMIN_CRUD_IN_RC1 = false/);
  assert.match(safety, /MOBILE_ROLE_PERMISSION_MUTATION_ENABLED = false/);

  assert.match(classes, /ClassMutationControls/);
  assert.match(read(path.join("components", "ClassMutationControls.tsx")), /createSchoolClass/);
  assert.match(read(path.join("components", "ClassMutationControls.tsx")), /updateSchoolClass/);
  assert.match(read(path.join("components", "ClassMutationControls.tsx")), /testID="classes-create"/);
  assert.match(read(path.join("lib", "mobileCrudParity.ts")), /canMutateEntity\(session, entity, "CREATE"\)/);

  assert.match(users, /UserMutationControls/);
  assert.doesNotMatch(users, /resetUserPassword|updateItem\(/);
  const userControls = read(path.join("components", "UserMutationControls.tsx"));
  assert.match(userControls, /createClientsUser/);
  assert.match(userControls, /updateClientsUser/);
  assert.match(userControls, /grantClientsUserRole/);
  assert.match(userControls, /revokeClientsUserRole/);
  assert.match(userControls, /testID="users-create"/);
  assert.match(userControls, /testID="users-grant-teacher"/);
  assert.match(userControls, /testID="users-revoke-teacher"/);
  assert.match(userControls, /SecretHandoffModal/);

  assert.match(teachers, /TeacherMutationControls/);
  assert.match(teachers, /AssignmentMutationControls/);
  const teacherControls = read(path.join("components", "TeacherMutationControls.tsx"));
  assert.match(teacherControls, /createTeacherIdentityFromUsers/);
  assert.match(teacherControls, /canCreateTeacherIdentity/);
  assert.match(teacherControls, /SecretHandoffModal/);
  assert.doesNotMatch(teacherControls, /createSchoolTeacher/);
  assert.doesNotMatch(teacherControls, /["']\/teachers["']/);
  assert.match(read(path.join("components", "AssignmentMutationControls.tsx")), /teacherCode/);
  assert.match(read(path.join("components", "AssignmentMutationControls.tsx")), /subjectCode/);
  assert.doesNotMatch(teachers, /AdminCrud/);

  assert.match(students, /StudentMutationControls/);
  assert.doesNotMatch(students, /AdminCrud/);
  const studentControls = read(path.join("components", "StudentMutationControls.tsx"));
  assert.match(studentControls, /enrollClassStudent/);
  assert.match(studentControls, /deleteSchoolStudent/);
  assert.match(studentControls, /updateSchoolStudent/);
  assert.match(studentControls, /credentials\?\.temporarySecret/);
  assert.match(studentControls, /SecretHandoffModal/);
  assert.match(studentControls, /OverflowActions/);
  assert.match(studentControls, /studentRowOverflowActions/);
  assert.doesNotMatch(studentControls, /persistOutbox|enqueueOutbox|AsyncStorage/);
  assert.doesNotMatch(studentControls, /marginTop:\s*8/, "pas de rangée 44 dp sous la fiche élève");
  runUnit("overflowActions.test.ts");
  runUnit("studentDisplayName.test.ts");

  assert.match(payments, /PaymentMutationControls/);
  assert.match(payments, /getPaymentStudentOptions/);
  assert.match(payments, /paymentStudentsFromOptions/);
  assert.match(payments, /getFinanceCatalog/);
  assert.doesNotMatch(payments, /AdminCrud/);
  assert.doesNotMatch(payments, /writePaymentsWebOnly/);
  const paymentControls = read(path.join("components", "PaymentMutationControls.tsx"));
  assert.match(paymentControls, /createSchoolPayment\(payload, \{ idempotencyKey \}\)/);
  const paymentCancel = read(path.join("components", "PaymentCancelControls.tsx"));
  assert.match(paymentCancel, /cancelSchoolPayment/);
  assert.match(paymentCancel, /canCancelSchoolPayment/);
  assert.match(paymentCancel, /Le motif d'annulation est obligatoire/);
  assert.match(payments, /PaymentCancelControls/);
  assert.match(paymentControls, /createIntentionStore/);
  assert.match(paymentControls, /getOrCreate\(PAYMENT_DRAFT_INTENTION\)/);
  assert.match(paymentControls, /label="Élève"/);
  assert.match(paymentControls, /label="Classe"/);
  assert.match(paymentControls, /buildSchoolPaymentPayload/);
  assert.match(paymentControls, /preselectPaymentClassId/);
  assert.match(paymentControls, /collectOpenPaymentFees/);
  assert.match(paymentControls, /obligationId/);
  assert.doesNotMatch(paymentControls, /\["Scolarité", "Inscription", "Cantine"\]/);
  assert.doesNotMatch(paymentControls, /\["Espèces", "Mobile money", "Virement"\]/);
  assert.doesNotMatch(paymentControls, /setMethod\("Espèces"\)/);
  assert.match(paymentControls, /paymentMethods/);
  assert.match(paymentControls, /Catalogue des moyens de paiement indisponible/);
  assert.doesNotMatch(paymentControls, /createIdempotencyKey\(\)/);
  const eleveAt = paymentControls.indexOf('label="Élève"');
  const classeAt = paymentControls.indexOf('label="Classe"');
  const montantAt = paymentControls.indexOf('label="Montant"');
  assert.ok(eleveAt >= 0 && eleveAt < classeAt && classeAt < montantAt, "ordre Élève → Classe → Montant");

  const studentPayments = read(path.join("screens", "StudentPaymentsScreen.tsx"));
  assert.match(studentPayments, /PaymentMutationControls/);
  assert.match(studentPayments, /PaymentCancelControls/);
  assert.match(studentPayments, /initialStudentId/);
  assert.match(studentPayments, /getPaymentStudentOptions/);
  assert.match(studentPayments, /getFinanceCatalog/);
  assert.match(studentPayments, /paymentMethods=\{paymentMethods\}/);

  assert.match(announcements, /AnnouncementMutationControls/);
  assert.doesNotMatch(announcements, /AdminCrud/);
  assert.match(read(path.join("components", "AnnouncementMutationControls.tsx")), /createClientsAnnouncement/);

  assert.match(adminCtx, /LOCAL_WRITE_FORBIDDEN_ENTITIES/);
  assert.match(adminCtx, /if \(LOCAL_WRITE_FORBIDDEN_ENTITIES.has\(entity\)\) return;/);

  console.log("OK: faux writes AdminCrud/RBAC bloqués; CRUD canonique branché sur les APIs PostgreSQL");
}

main();
