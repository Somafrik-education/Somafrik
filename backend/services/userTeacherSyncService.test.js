/**
 * FIX V2.1 IDENTITY — unit tests UserTeacherSyncService
 * CONTRAT-FIX-V2.1-IDENTITY.md §4.1 / §3.2 / AC-HIST-02
 */
const assert = require("assert");
const {
  UserTeacherSyncService,
  resolveCanonicalTeachersRow,
  isTeachersCode,
  isTeacherTwinCode,
} = require("../services/userTeacherSyncService");

const service = new UserTeacherSyncService();

function teacherUser(overrides = {}) {
  return {
    id: "USERS-1",
    role: "Enseignant",
    schoolCode: "SCH-001",
    identifier: "ENS-0001",
    publicId: "SCH-001-ENS-0001",
    firstName: "Ada",
    lastName: "Lovelace",
    status: "Actif",
    ...overrides,
  };
}

function run() {
  // AC-NEW-01 : compte nouveau → TEACHERS-* uniquement
  {
    const next = service.upsertTeacherFromUser([], teacherUser());
    assert.strictEqual(next.length, 1);
    assert.ok(isTeachersCode(next[0].id), `attendu TEACHERS-*, reçu ${next[0].id}`);
    assert.strictEqual(next[0].userId, "USERS-1");
    assert.ok(!isTeacherTwinCode(next[0].id));
  }

  // Réutilisation canon unique
  {
    const existing = [
      {
        id: "TEACHERS-canon",
        userId: "USERS-1",
        schoolCode: "SCH-001",
        identifier: "ENS-0001",
      },
    ];
    const next = service.upsertTeacherFromUser(existing, teacherUser({ lastName: "Updated" }));
    assert.strictEqual(next.length, 1);
    assert.strictEqual(next[0].id, "TEACHERS-canon");
    assert.strictEqual(next[0].name, "Updated");
  }

  // §4.1 — multi TEACHERS-* sans affectation unique → ambiguïté
  {
    const teachers = [
      { id: "TEACHERS-a", userId: "USERS-1", schoolCode: "SCH-001" },
      { id: "TEACHERS-b", userId: "USERS-1", schoolCode: "SCH-001" },
    ];
    assert.throws(
      () => resolveCanonicalTeachersRow(teachers, teacherUser(), "SCH-001", []),
      (error) => {
        assert.strictEqual(error.code, "TEACHER_CANON_AMBIGUOUS");
        return true;
      },
    );
    assert.throws(
      () => service.upsertTeacherFromUser(teachers, teacherUser()),
      (error) => error.code === "TEACHER_CANON_AMBIGUOUS",
    );
  }

  // §4.1 — multi TEACHERS-* départagés par une affectation active unique
  {
    const teachers = [
      { id: "TEACHERS-a", userId: "USERS-1", schoolCode: "SCH-001" },
      { id: "TEACHERS-b", userId: "USERS-1", schoolCode: "SCH-001" },
    ];
    const assignments = [
      { teacherId: "TEACHERS-b", schoolCode: "SCH-001", status: "active" },
    ];
    const canon = resolveCanonicalTeachersRow(teachers, teacherUser(), "SCH-001", assignments);
    assert.strictEqual(canon.id, "TEACHERS-b");
    const next = service.upsertTeacherFromUser(teachers, teacherUser({ lastName: "B" }), {
      assignments,
    });
    assert.strictEqual(next.find((t) => t.id === "TEACHERS-b").name, "B");
    assert.strictEqual(next.length, 2, "pas de fusion / suppression historique");
  }

  // AC-HIST-02 : TEACHER-* seul → pas de création TEACHERS-*
  {
    const teachers = [
      {
        id: "TEACHER-legacy",
        userId: "USERS-1",
        schoolCode: "SCH-001",
        identifier: "ENS-0001",
        name: "Old",
      },
    ];
    const next = service.upsertTeacherFromUser(teachers, teacherUser({ lastName: "StillLegacy" }));
    assert.strictEqual(next.length, 1);
    assert.strictEqual(next[0].id, "TEACHER-legacy");
    assert.ok(isTeacherTwinCode(next[0].id));
    assert.ok(!next.some((t) => isTeachersCode(t.id)));
    assert.strictEqual(next[0].name, "StillLegacy");
  }

  // Historique jumelé : réutilise TEACHERS-*, ne crée pas, ne fusionne pas
  {
    const teachers = [
      { id: "TEACHER-legacy", userId: "USERS-1", schoolCode: "SCH-001" },
      { id: "TEACHERS-canon", userId: "USERS-1", schoolCode: "SCH-001" },
    ];
    const next = service.upsertTeacherFromUser(teachers, teacherUser({ lastName: "Canon" }));
    assert.strictEqual(next.length, 2);
    assert.ok(next.some((t) => t.id === "TEACHER-legacy"));
    assert.strictEqual(next.find((t) => t.id === "TEACHERS-canon").name, "Canon");
  }

  // §4.1 — même id dupliqué dans le tableau ≠ ambiguïté
  {
    const teachers = [
      { id: "TEACHERS-canon", userId: "USERS-1", schoolCode: "SCH-001" },
      { id: "TEACHERS-canon", userId: "USERS-1", schoolCode: "SCH-001" },
    ];
    const canon = resolveCanonicalTeachersRow(teachers, teacherUser(), "SCH-001", []);
    assert.strictEqual(canon.id, "TEACHERS-canon");
  }

  // Isolation établissement
  {
    const teachers = [
      { id: "TEACHERS-other", userId: "USERS-1", schoolCode: "SCH-OTHER" },
    ];
    const next = service.upsertTeacherFromUser(teachers, teacherUser());
    assert.strictEqual(next.length, 2);
    assert.ok(next.some((t) => isTeachersCode(t.id) && t.schoolCode === "SCH-001"));
  }

  // Bulk sync : ambiguïté historique → skip (pas de choix silencieux, pas de fail PUT)
  {
    const teachers = [
      { id: "TEACHERS-a", userId: "USERS-1", schoolCode: "SCH-001" },
      { id: "TEACHERS-b", userId: "USERS-1", schoolCode: "SCH-001" },
    ];
    const synced = service.syncTeachersFromUserAccounts({
      users: [teacherUser()],
      teachers,
      contacts: [],
      assignments: [],
    });
    assert.strictEqual(synced.teachers.length, 2, "historique multi inchangé");
    assert.deepStrictEqual(
      synced.teachers.map((t) => t.id).sort(),
      ["TEACHERS-a", "TEACHERS-b"],
    );
  }

  console.log("userTeacherSyncService.test.js : OK");
}

run();
