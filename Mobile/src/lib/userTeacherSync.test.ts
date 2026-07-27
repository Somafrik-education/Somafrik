/**
 * Unit tests Lot 1 — exécutent le VRAI module Mobile userTeacherSync.
 *   npx tsx Mobile/src/lib/userTeacherSync.test.ts
 */
import assert from "node:assert/strict";
import {
  applyTeacherSyncUiAfterUserSave,
  createTeacherRecordId,
  isTeacherUserRole,
  upsertTeacherFromUser,
  resolveCanonicalTeachersRow,
  type TeacherIdentitySkip,
} from "./userTeacherSync";

type Row = Record<string, unknown>;

function teacherUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "USERS-1",
    publicId: "CD-2026-0001-ENS-0001",
    lastName: "Diallo",
    firstName: "Awa",
    gender: "Féminin",
    phone: "+221770000001",
    role: "Enseignant",
    scopeLevel: "Établissement",
    schoolCode: "CD-2026-0001",
    accessChannel: "Application",
    identifier: "ENS-0001",
    status: "Actif",
    permissions: [],
    createdAt: new Date().toISOString(),
    createdBy: "test",
    history: [],
    ...overrides,
  } as any;
}

function run() {
  // AC-M1
  {
    const next = upsertTeacherFromUser([], teacherUser());
    assert.equal(next.length, 1);
    assert.match(String(next[0].id), /^TEACHERS-/i);
  }

  // AC-M2
  {
    const existing: Row = {
      id: "TEACHERS-EXISTING",
      userId: "USERS-1",
      schoolCode: "CD-2026-0001",
      identifier: "ENS-0001",
      status: "Actif",
    };
    const next = upsertTeacherFromUser([existing], teacherUser({ lastName: "Updated" }));
    assert.equal(next.length, 1);
    assert.equal(String(next[0].id), "TEACHERS-EXISTING");
    assert.equal(String(next[0].name), "Updated");
  }

  // AC-M4 HIST-02
  {
    const twin: Row = {
      id: "TEACHER-LEGACY-1",
      userId: "USERS-1",
      schoolCode: "CD-2026-0001",
      identifier: "ENS-0001",
      status: "Actif",
    };
    const next = upsertTeacherFromUser([twin], teacherUser({ lastName: "Kept" }));
    assert.equal(next.length, 1);
    assert.equal(String(next[0].id), "TEACHER-LEGACY-1");
    assert.equal(String(next[0].name), "Kept");
    assert.ok(!next.some((row) => /^TEACHERS-/i.test(String(row.id))));
  }

  // AC-M7 helper multi-twin no-op + skip
  {
    const teachers: Row[] = [
      { id: "TEACHER-A", userId: "USERS-1", schoolCode: "CD-2026-0001", identifier: "ENS-0001" },
      { id: "TEACHER-B", userId: "USERS-1", schoolCode: "CD-2026-0001", identifier: "ENS-0001" },
    ];
    const skips: TeacherIdentitySkip[] = [];
    const next = upsertTeacherFromUser(teachers, teacherUser(), { skips });
    assert.deepEqual(
      next.map((row) => row.id),
      ["TEACHER-A", "TEACHER-B"],
    );
    assert.equal(skips.length, 1);
    assert.equal(skips[0].code, "TEACHER_HISTORICAL_MULTI_TWIN");
    assert.equal(skips[0].action, "noop");
  }

  // AC-M7 UI parcours complet — 0 createItem / 0 updateItem
  {
    const teachersBefore: Row[] = [
      { id: "TEACHER-MT-1", userId: "USERS-1", schoolCode: "CD-2026-0001", identifier: "ENS-0001" },
      { id: "TEACHER-MT-2", userId: "USERS-1", schoolCode: "CD-2026-0001", identifier: "ENS-0001" },
    ];
    const skips: TeacherIdentitySkip[] = [];
    const user = teacherUser();
    const syncedTeachers = upsertTeacherFromUser(teachersBefore, user, { skips });
    assert.equal(skips[0]?.code, "TEACHER_HISTORICAL_MULTI_TWIN");

    let createCalls = 0;
    let updateCalls = 0;
    const ui = applyTeacherSyncUiAfterUserSave({
      teachersBefore,
      user,
      syncedTeachers,
      skips,
      createTeacher: () => {
        createCalls += 1;
      },
      updateTeacher: () => {
        updateCalls += 1;
      },
    });

    const proof = {
      helperNoop: ui.helperNoop,
      uiTeacherCreateCalls: ui.uiTeacherCreateCalls,
      uiTeacherUpdateCalls: ui.uiTeacherUpdateCalls,
      teacherIdsBefore: ui.teacherIdsBefore,
      teacherIdsAfter: ui.teacherIdsAfter,
    };
    assert.deepEqual(proof, {
      helperNoop: true,
      uiTeacherCreateCalls: 0,
      uiTeacherUpdateCalls: 0,
      teacherIdsBefore: ["TEACHER-MT-1", "TEACHER-MT-2"],
      teacherIdsAfter: ["TEACHER-MT-1", "TEACHER-MT-2"],
    });
    assert.equal(createCalls, 0);
    assert.equal(updateCalls, 0);
    assert.equal(ui.stopped, true);
    assert.equal(ui.stopCode, "TEACHER_HISTORICAL_MULTI_TWIN");
    console.log("AC-M7-UI proof", JSON.stringify(proof));
  }

  // AC-M5a ambiguous
  {
    const teachers: Row[] = [
      { id: "TEACHERS-1", userId: "USERS-1", schoolCode: "CD-2026-0001" },
      { id: "TEACHERS-2", userId: "USERS-1", schoolCode: "CD-2026-0001" },
    ];
    assert.throws(
      () => upsertTeacherFromUser(teachers, teacherUser()),
      (error: any) => error?.code === "TEACHER_CANON_AMBIGUOUS",
    );
  }

  // Tie-break via assignment
  {
    const teachers: Row[] = [
      { id: "TEACHERS-1", userId: "USERS-1", schoolCode: "CD-2026-0001" },
      { id: "TEACHERS-2", userId: "USERS-1", schoolCode: "CD-2026-0001" },
    ];
    const assignments: Row[] = [
      { teacherId: "TEACHERS-2", schoolCode: "CD-2026-0001", status: "active", className: "6ème A" },
    ];
    const canon = resolveCanonicalTeachersRow(teachers, teacherUser(), "CD-2026-0001", assignments);
    assert.equal(String(canon?.id), "TEACHERS-2");
  }

  // AC-M6 generator
  {
    const id = createTeacherRecordId();
    assert.match(id, /^TEACHERS-/i);
    assert.ok(!/^TEACHER-/i.test(id) || /^TEACHERS-/i.test(id));
    assert.ok(!id.toLowerCase().startsWith("teachers-") || id.startsWith("TEACHERS-"));
  }

  // role helper
  assert.equal(isTeacherUserRole("Enseignant"), true);
  assert.equal(isTeacherUserRole("teacher"), true);
  assert.equal(isTeacherUserRole("Secrétaire"), false);

  // Lot 1: do not awaken Inactif
  {
    const existing: Row = {
      id: "TEACHERS-INACTIVE",
      userId: "USERS-1",
      schoolCode: "CD-2026-0001",
      status: "Inactif",
    };
    const next = upsertTeacherFromUser([existing], teacherUser({ status: "Actif" }));
    assert.equal(String(next[0].status), "Inactif");
  }

  console.log("OK Mobile userTeacherSync Lot 1 unit tests");
}

run();
