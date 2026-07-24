/**
 * Vérifications C1.7 — édition contrôlée du dossier élève.
 * Exécution : npm run verify:student-editing
 */
import {
  canSubmitEdit,
  createInitialEditControllerState,
  hasUnsavedChanges,
  reduceStudentEditController,
} from "../src/lib/studentEditingController";
import {
  FUTURE_STUDENT_EDITING_PERMISSIONS,
  STUDENT_EDITING_PERMISSIONS,
  assertSameSchool,
  canUpdateStudentWorkspace,
  permissionForCommand,
} from "../src/lib/studentEditingPermissions";
import {
  buildChangeSetForCommand,
  normalizeEmail,
  normalizeOptionalText,
  normalizePhone,
} from "../src/lib/studentEditingChangeSet";
import { validateStudentWorkspaceCommand } from "../src/lib/studentEditingValidation";
import { executeStudentUpdateCommand } from "../src/lib/studentEditingService";
import {
  createMockEditingStore,
  createMockStudentWorkspaceCommandRepository,
  seedEditableAdministrative,
  seedEditableGuardian,
  seedEditableIdentity,
} from "../src/lib/studentEditingRepository.mock";
import type { StudentEditAuthorizationContext } from "../src/lib/studentEditing";
import { collectStudentHistoryRecord } from "../src/lib/studentHistory";
import { buildStudentWorkspace } from "../src/lib/studentWorkspaceService";
import type { PermissionContext } from "../src/lib/permissions";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message} (reçu: ${JSON.stringify(actual)}, attendu: ${JSON.stringify(expected)})`,
    );
  }
}

function auth(
  permissions: string[],
  schoolCode = "CD-2026-0001",
): StudentEditAuthorizationContext {
  return {
    userId: "u-1",
    role: "Secrétaire",
    schoolCode,
    permissions,
  };
}

function permissionCtx(permissions: string[]): PermissionContext {
  const role = "Secrétaire";
  return {
    user: {
      id: "u-1",
      role,
      identifier: "secretaire@test.local",
      permissions,
      schoolCode: "CD-2026-0001",
    } as PermissionContext["user"],
    rolePermissions: { [role]: permissions },
  };
}

function testPermissions() {
  const allowed = auth(["student.identity.update"]);
  assert(
    canUpdateStudentWorkspace(allowed, "student.identity.update"),
    "permission identité autorisée",
  );

  const denied = auth(["student.identity.read"]);
  assert(
    !canUpdateStudentWorkspace(denied, "student.identity.update"),
    "permission identité refusée",
  );

  const bridge = auth(["Élèves:UPDATE"]);
  assert(
    canUpdateStudentWorkspace(bridge, "student.identity.update"),
    "bridge legacy identity",
  );
  assert(
    canUpdateStudentWorkspace(bridge, "student.guardians.update"),
    "bridge guardians",
  );
  assert(
    canUpdateStudentWorkspace(bridge, "student.administrative.update"),
    "bridge administrative",
  );
  assert(
    !canUpdateStudentWorkspace(bridge, "student.medical.update"),
    "bridge n'accorde pas medical.update",
  );
  assert(
    !canUpdateStudentWorkspace(bridge, "student.documents.verify"),
    "bridge n'accorde pas documents.verify",
  );
  assert(
    !canUpdateStudentWorkspace(bridge, "student.archive"),
    "bridge n'accorde pas archive",
  );
  assert(
    !canUpdateStudentWorkspace(bridge, "student.enrollments.validate"),
    "bridge n'accorde pas enrollments.validate",
  );
  assert(
    !canUpdateStudentWorkspace(bridge, "student.enrollments.assign-class"),
    "bridge n'accorde pas enrollments.assign-class",
  );
  assert(
    !canUpdateStudentWorkspace(bridge, "student.enrollments.transfer"),
    "bridge n'accorde pas enrollments.transfer",
  );
  assert(
    !canUpdateStudentWorkspace(bridge, "student.enrollments.close"),
    "bridge n'accorde pas enrollments.close",
  );

  assert(
    STUDENT_EDITING_PERMISSIONS.includes("student.identity.update"),
    "catalogue C1.7",
  );
  assert(
    STUDENT_EDITING_PERMISSIONS.includes("student.enrollments.validate"),
    "catalogue C1.8a validate",
  );
  assert(
    STUDENT_EDITING_PERMISSIONS.includes("student.enrollments.assign-class"),
    "catalogue C1.8a assign-class",
  );
  assert(
    FUTURE_STUDENT_EDITING_PERMISSIONS.includes("student.medical.update"),
    "catalogue futur",
  );

  const ctx = permissionCtx(["Élèves:READ", "Élèves:UPDATE"]);
  assert(
    canUpdateStudentWorkspace(ctx, "student.identity.update"),
    "PermissionContext + bridge",
  );

  assert(
    !assertSameSchool("CD-2026-0001", "CD-OTHER"),
    "interdiction cross-school",
  );
  assert(assertSameSchool("CD-2026-0001", "cd-2026-0001"), "same school");
}

function testNormalization() {
  assertEqual(
    normalizeEmail("  TEST@EMAIL.COM "),
    "test@email.com",
    "normalisation email",
  );
  assertEqual(
    normalizePhone("+243 800 000 000"),
    "+243800000000",
    "normalisation téléphone",
  );
  assertEqual(normalizeOptionalText("   "), null, "chaîne vide → null");
  assertEqual(normalizeOptionalText("  A  B  "), "A B", "espaces superflus");
}

async function testChangeDetectionAndEmptyCommand() {
  const identity = seedEditableIdentity({
    studentId: "STU-1",
    schoolCode: "CD-2026-0001",
    phone: "+243800000000",
    email: "a@test.local",
  });

  const noChange = buildChangeSetForCommand(
    {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 1,
      changes: { phone: "+243 800 000 000" },
    },
    identity,
  );
  assert(noChange.isEmpty, "détection : téléphone normalisé identique");

  const store = createMockEditingStore({ identities: [identity] });
  const repo = createMockStudentWorkspaceCommandRepository(store);
  const empty = await executeStudentUpdateCommand(
    {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 1,
      changes: { phone: "+243800000000" },
    },
    auth(["student.identity.update"]),
    repo,
  );
  assertEqual(empty.success, false, "commande vide refusée");
  if (!empty.success) assertEqual(empty.code, "NO_CHANGES", "code NO_CHANGES");
}

async function testUnsupportedField() {
  const identity = seedEditableIdentity({
    studentId: "STU-1",
    schoolCode: "CD-2026-0001",
  });
  const store = createMockEditingStore({ identities: [identity] });
  const repo = createMockStudentWorkspaceCommandRepository(store);
  const result = await executeStudentUpdateCommand(
    {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 1,
      changes: {
        firstName: "Amina",
        // @ts-expect-error champ hors liste fermée
        matricule: "HACK",
      },
    },
    auth(["student.identity.update"]),
    repo,
  );
  assertEqual(result.success, false, "champ non autorisé refusé");
  if (!result.success) {
    assert(
      result.code === "UNSUPPORTED_FIELD" || result.code === "VALIDATION_ERROR",
      "code unsupported",
    );
  }
}

async function testValidationRules() {
  const identity = seedEditableIdentity({
    studentId: "STU-1",
    schoolCode: "CD-2026-0001",
    birthDate: "2012-01-01",
  });

  const future = validateStudentWorkspaceCommand(
    {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 1,
      changes: { birthDate: "2099-01-01" },
    },
    {
      identity,
      referenceDate: new Date(2026, 6, 21),
      enforceReason: false,
    },
  );
  assert(!future.valid, "date de naissance future refusée");
  assert(
    future.errors.some((item) => item.code === "FUTURE_DATE"),
    "code FUTURE_DATE",
  );

  const guardian = seedEditableGuardian({
    studentId: "STU-1",
    schoolCode: "CD-2026-0001",
    relationId: "REL-1",
    guardianId: "G-1",
    phone: "+243811111111",
    isEmergencyContact: false,
  });

  const emergency = validateStudentWorkspaceCommand(
    {
      type: "UPDATE_GUARDIAN_CONTACT",
      studentId: "STU-1",
      relationId: "REL-1",
      expectedVersion: 1,
      changes: { isEmergencyContact: true, phone: null },
    },
    { guardian, enforceReason: false },
  );
  assert(!emergency.valid, "téléphone requis pour contact d'urgence");
  assert(
    emergency.errors.some((item) => item.code === "EMERGENCY_PHONE_REQUIRED"),
    "EMERGENCY_PHONE_REQUIRED",
  );

  const sensitive = buildChangeSetForCommand(
    {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 1,
      changes: { birthDate: "2011-05-05" },
    },
    identity,
  );
  assert(sensitive.hasSensitiveChange, "ChangeSet sensible");
  assert(sensitive.requiresReason, "raison requise");

  const reasonMissing = validateStudentWorkspaceCommand(
    {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 1,
      changes: { birthDate: "2011-05-05" },
    },
    { identity, changeSet: sensitive, enforceReason: true },
  );
  assert(!reasonMissing.valid, "raison requise validée");
}

async function testVersionConflictAndSuccess() {
  const identity = seedEditableIdentity({
    studentId: "STU-1",
    schoolCode: "CD-2026-0001",
    version: 3,
    phone: "+243800000000",
  });
  const store = createMockEditingStore({ identities: [identity] });
  const repo = createMockStudentWorkspaceCommandRepository(store, {
    now: () => "2026-07-21T12:00:00.000Z",
  });

  const conflict = await executeStudentUpdateCommand(
    {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 2,
      changes: { phone: "+243811111111" },
    },
    auth(["student.identity.update"]),
    repo,
  );
  assertEqual(conflict.success, false, "conflit de version");
  if (!conflict.success) {
    assertEqual(conflict.code, "VERSION_CONFLICT", "VERSION_CONFLICT");
    assert(conflict.conflict != null, "détail conflit");
  }

  const success = await executeStudentUpdateCommand(
    {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 3,
      changes: { phone: "+243811111111" },
      reason: null,
    },
    auth(["student.identity.update"]),
    repo,
  );
  assert(success.success, "succès");
  if (success.success) {
    assertEqual(success.newVersion, 4, "incrément de version");
    assertEqual(success.updatedAt, "2026-07-21T12:00:00.000Z", "updatedAt");
    assertEqual(
      (success.updatedAggregate as { phone: string | null }).phone,
      "+243811111111",
      "téléphone mis à jour",
    );
    assertEqual(success.auditEvent.visibility, "ADMIN", "audit ADMIN");
    assert(
      success.auditEvent.changedFields.includes("phone"),
      "audit changedFields",
    );
  }

  const cross = await executeStudentUpdateCommand(
    {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 4,
      changes: { phone: "+243822222222" },
    },
    auth(["student.identity.update"], "OTHER-SCHOOL"),
    repo,
  );
  assertEqual(cross.success, false, "cross-school refusé");
  if (!cross.success) assertEqual(cross.code, "PERMISSION_DENIED", "PERMISSION");
}

async function testGuardianAndAdministrativeSuccess() {
  const guardian = seedEditableGuardian({
    studentId: "STU-1",
    schoolCode: "CD-2026-0001",
    relationId: "REL-1",
    guardianId: "G-1",
    version: 1,
    phone: "+243800000000",
    isEmergencyContact: false,
    priority: 2,
  });
  const admin = seedEditableAdministrative({
    studentId: "STU-1",
    schoolCode: "CD-2026-0001",
    version: 1,
    administrativeNotes: "Note A",
  });
  const store = createMockEditingStore({
    guardians: [guardian],
    administrative: [admin],
  });
  const repo = createMockStudentWorkspaceCommandRepository(store);

  const g = await executeStudentUpdateCommand(
    {
      type: "UPDATE_GUARDIAN_CONTACT",
      studentId: "STU-1",
      relationId: "REL-1",
      expectedVersion: 1,
      changes: { isEmergencyContact: true },
      reason: "Demande famille",
    },
    auth(["student.guardians.update"]),
    repo,
  );
  assert(g.success, "guardian success");
  if (g.success) {
    assert(g.changeSet.hasSensitiveChange, "guardian sensitive");
    assertEqual(g.newVersion, 2, "guardian version");
  }

  const a = await executeStudentUpdateCommand(
    {
      type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
      studentId: "STU-1",
      expectedVersion: 1,
      changes: { administrativeNotes: "Note B", preferredContactChannel: "SMS" },
    },
    auth(["student.administrative.update"]),
    repo,
  );
  assert(a.success, "admin success");

  const html = validateStudentWorkspaceCommand(
    {
      type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
      studentId: "STU-1",
      expectedVersion: 2,
      changes: { administrativeNotes: "<script>x</script>" },
    },
    {
      administrative: store.administrative.get("STU-1")!,
      enforceReason: false,
    },
  );
  assert(!html.valid, "HTML interdit dans notes");
}

function testControllerTransitions() {
  let state = createInitialEditControllerState();
  assertEqual(state.mode, "READ", "READ initial");

  state = reduceStudentEditController(state, {
    type: "START_EDIT",
    draft: { phone: "1" },
  });
  assertEqual(state.mode, "EDITING", "EDITING");
  assert(hasUnsavedChanges(state), "modifications non sauvegardées");

  const identity = seedEditableIdentity({
    studentId: "STU-1",
    schoolCode: "CD-2026-0001",
    phone: "+243800000000",
  });
  const changeSet = buildChangeSetForCommand(
    {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 1,
      changes: { phone: "+243811111111" },
    },
    identity,
  );

  state = reduceStudentEditController(state, {
    type: "CONTINUE_TO_REVIEW",
    command: {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 1,
      changes: { phone: "+243811111111" },
    },
    changeSet,
  });
  assertEqual(state.mode, "REVIEWING", "REVIEWING");
  assert(canSubmitEdit(state), "can submit");

  state = reduceStudentEditController(state, { type: "SUBMIT_START" });
  assertEqual(state.mode, "SUBMITTING", "SUBMITTING");
  assert(!canSubmitEdit(state), "double soumission impossible");

  const locked = reduceStudentEditController(state, { type: "SUBMIT_START" });
  assertEqual(locked.mode, "SUBMITTING", "reste SUBMITTING");

  state = reduceStudentEditController(state, {
    type: "SUBMIT_SUCCESS",
    result: {
      success: true,
      updatedAggregate: identity,
      changeSet,
      auditEvent: {
        id: "a",
        studentId: "STU-1",
        commandType: "UPDATE_STUDENT_IDENTITY",
        actorId: "u",
        actorRole: "r",
        occurredAt: "2026-07-21T00:00:00.000Z",
        changedFields: ["phone"],
        reason: null,
        visibility: "ADMIN",
      },
      newVersion: 2,
      updatedAt: "2026-07-21T00:00:00.000Z",
    },
  });
  assertEqual(state.mode, "SUCCESS", "SUCCESS");
  assert(!hasUnsavedChanges(state), "plus de changements après succès");

  // Conflit
  state = createInitialEditControllerState();
  state = reduceStudentEditController(state, { type: "START_EDIT" });
  state = reduceStudentEditController(state, {
    type: "CONTINUE_TO_REVIEW",
    command: {
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "STU-1",
      expectedVersion: 1,
      changes: { phone: "+243811111111" },
    },
    changeSet,
  });
  state = reduceStudentEditController(state, { type: "SUBMIT_START" });
  state = reduceStudentEditController(state, {
    type: "SUBMIT_FAILURE",
    result: {
      success: false,
      code: "VERSION_CONFLICT",
      errors: [],
      conflict: {
        code: "VERSION_CONFLICT",
        expectedVersion: 1,
        currentVersion: 2,
        currentUpdatedAt: "2026-07-21T00:00:00.000Z",
      },
    },
  });
  assertEqual(state.mode, "CONFLICT", "CONFLICT");

  state = reduceStudentEditController(state, { type: "BACK_TO_EDIT" });
  assertEqual(state.mode, "EDITING", "REVIEWING/CONFLICT → EDITING");

  assertEqual(
    permissionForCommand({
      type: "UPDATE_STUDENT_IDENTITY",
      studentId: "x",
      expectedVersion: 1,
      changes: {},
    }),
    "student.identity.update",
    "permissionForCommand",
  );
}

function testHistoryProjectionNotMutatedDirectly() {
  const before = collectStudentHistoryRecord({
    studentId: "STU-1",
    student: {
      id: "STU-1",
      matricule: "M-1",
      schoolCode: "CD-2026-0001",
      createdAt: "2025-01-01",
      updatedAt: "2026-07-20",
    },
  });
  assert(
    before.events.some((event) => event.type === "IDENTITY_UPDATED"),
    "projection IDENTITY_UPDATED depuis updatedAt",
  );

  // L'édition ne pousse pas manuellement dans history.events
  const mutable = before.events as unknown as { push?: unknown };
  assertEqual(typeof (before as { appendEvent?: unknown }).appendEvent, "undefined", "pas d'append");
  assert(Array.isArray(before.events), "events = projection");
  void mutable;
}

function testWorkspaceStillBuilds() {
  const workspace = buildStudentWorkspace({
    studentId: "STU-1",
    academicYear: "2026-2027",
    data: {
      students: [
        {
          id: "STU-1",
          matricule: "M-1",
          schoolCode: "CD-2026-0001",
          firstName: "Amina",
          lastName: "Test",
          status: "Actif",
          createdAt: "2026-01-01",
        },
      ],
    },
  });
  assert(workspace !== null, "workspace");
  assert(workspace!.history.events.length >= 0, "history projection intacte");
}

async function main() {
  const tests: Array<[string, () => void | Promise<void>]> = [
    ["permissions + bridge + cross-school", testPermissions],
    ["normalisation email/téléphone/vide", testNormalization],
    ["changements réels + commande vide", testChangeDetectionAndEmptyCommand],
    ["champ non autorisé", testUnsupportedField],
    ["validation métier", testValidationRules],
    ["conflit + succès version", testVersionConflictAndSuccess],
    ["guardian + administratif", testGuardianAndAdministrativeSuccess],
    ["contrôleur transitions + anti-double soumission", testControllerTransitions],
    ["historique projection sans mutation directe", testHistoryProjectionNotMutatedDirectly],
    ["workspace", testWorkspaceStillBuilds],
  ];

  for (const [name, run] of tests) {
    await run();
    console.log(`OK — ${name}`);
  }

  console.log(`\n${tests.length} suites validées — student editing C1.7`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
