/**
 * FIX V2.1 IDENTITY — unit tests UserTeacherSyncService
 * CONTRAT-FIX-V2.1-IDENTITY.md §4.1 / §4.1.b / §4.1.c / AC-HIST-02
 */
const assert = require("assert");
const {
  UserTeacherSyncService,
  resolveCanonicalTeachersRow,
  isTeachersCode,
  isTeacherTwinCode,
  isIdentityRelatedWrite,
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

  // P0 idempotence : 10 synchronisations conservent le même canon
  {
    let teachers = [];
    const user = teacherUser({ contactId: "CONTACT-1" });
    for (let index = 0; index < 10; index += 1) {
      teachers = service.upsertTeacherFromUser(teachers, user);
    }
    assert.strictEqual(teachers.length, 1);
    const canonicalId = teachers[0].id;
    teachers = service.upsertTeacherFromUser(teachers, user);
    assert.strictEqual(teachers[0].id, canonicalId);
  }

  // P0 résolution fiable : contactId unique, puis identifiant métier unique
  {
    const byContact = [{ id: "TEACHERS-contact", contactId: "CONTACT-1", schoolCode: "SCH-001" }];
    const contactResult = service.upsertTeacherFromUser(
      byContact,
      teacherUser({ id: "USERS-new", contactId: "CONTACT-1" }),
    );
    assert.strictEqual(contactResult.length, 1);
    assert.strictEqual(contactResult[0].id, "TEACHERS-contact");
    assert.strictEqual(contactResult[0].userId, "USERS-new");

    const byIdentifier = [{ id: "TEACHERS-identifier", identifier: "ENS-0001", schoolCode: "SCH-001" }];
    const identifierResult = service.upsertTeacherFromUser(byIdentifier, teacherUser());
    assert.strictEqual(identifierResult.length, 1);
    assert.strictEqual(identifierResult[0].id, "TEACHERS-identifier");
  }

  // P0 ambiguïté fiable : aucune création et erreur structurée
  {
    const teachers = [
      { id: "TEACHERS-contact-a", contactId: "CONTACT-1", schoolCode: "SCH-001" },
      { id: "TEACHERS-contact-b", contactId: "CONTACT-1", schoolCode: "SCH-001" },
    ];
    assert.throws(
      () => service.upsertTeacherFromUser(teachers, teacherUser({ id: "USERS-new", contactId: "CONTACT-1" })),
      (error) => error.code === "TEACHER_CANON_AMBIGUOUS",
    );
    assert.strictEqual(teachers.length, 2);
  }

  // P0 homonymes : le nom/prénom seul ne rattache et ne fusionne jamais
  {
    const teachers = [{
      id: "TEACHERS-homonyme-a",
      schoolCode: "SCH-001",
      identifier: "ENS-0099",
      name: "Lovelace",
      firstName: "Ada",
    }];
    const next = service.upsertTeacherFromUser(teachers, teacherUser({ id: "USERS-distinct" }));
    assert.strictEqual(next.length, 2);
    assert.notStrictEqual(next[0].id, "TEACHERS-homonyme-a");
  }

  // P0 références pédagogiques : sync sans mutation des affectations/notes/présences
  {
    const state = {
      users: [teacherUser()],
      teachers: [{ id: "TEACHERS-canon", userId: "USERS-1", schoolCode: "SCH-001" }],
      assignments: [{ id: "A-1", teacherId: "TEACHERS-canon", schoolCode: "SCH-001" }],
      notes: [{ id: "N-1", teacherId: "TEACHERS-canon" }],
      presences: [{ id: "P-1", teacherId: "TEACHERS-canon" }],
    };
    const assignmentsBefore = JSON.stringify(state.assignments);
    const notesBefore = JSON.stringify(state.notes);
    const presencesBefore = JSON.stringify(state.presences);
    const synced = service.syncTeachersFromUserAccounts(state);
    assert.strictEqual(synced.teachers[0].id, "TEACHERS-canon");
    assert.strictEqual(JSON.stringify(state.assignments), assignmentsBefore);
    assert.strictEqual(JSON.stringify(state.notes), notesBefore);
    assert.strictEqual(JSON.stringify(state.presences), presencesBefore);
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

  // P0 — une affectation ne départage jamais plusieurs identités plausibles
  {
    const teachers = [
      { id: "TEACHERS-a", userId: "USERS-1", schoolCode: "SCH-001" },
      { id: "TEACHERS-b", userId: "USERS-1", schoolCode: "SCH-001" },
    ];
    const assignments = [
      { teacherId: "TEACHERS-b", schoolCode: "SCH-001", status: "active" },
    ];
    assert.throws(
      () => resolveCanonicalTeachersRow(teachers, teacherUser(), "SCH-001", assignments),
      (error) => error.code === "TEACHER_CANON_AMBIGUOUS",
    );
    assert.throws(
      () => service.upsertTeacherFromUser(teachers, teacherUser({ lastName: "B" }), { assignments }),
      (error) => error.code === "TEACHER_CANON_AMBIGUOUS",
    );
    assert.strictEqual(teachers.length, 2, "0 création / 0 fusion");
  }

  // AC-HIST-02 : un seul TEACHER-* → update conservatrice, pas de TEACHERS-*
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

  // §4.1.c — plusieurs TEACHER-* : no-op tracé, pas de twins[0]
  {
    const teachers = [
      { id: "TEACHER-a", userId: "USERS-1", schoolCode: "SCH-001", name: "A" },
      { id: "TEACHER-b", userId: "USERS-1", schoolCode: "SCH-001", name: "B" },
    ];
    const skips = [];
    const next = service.upsertTeacherFromUser(teachers, teacherUser({ lastName: "X" }), { skips });
    assert.strictEqual(next.length, 2);
    assert.strictEqual(next.find((t) => t.id === "TEACHER-a").name, "A");
    assert.strictEqual(next.find((t) => t.id === "TEACHER-b").name, "B");
    assert.ok(!next.some((t) => isTeachersCode(t.id)));
    assert.strictEqual(skips.length, 1);
    assert.strictEqual(skips[0].code, "TEACHER_HISTORICAL_MULTI_TWIN");
    assert.strictEqual(skips[0].action, "noop");
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

  // §4.1.b — PUT étranger : skip tracé, fiches inchangées
  {
    const teachers = [
      { id: "TEACHERS-a", userId: "USERS-1", schoolCode: "SCH-001" },
      { id: "TEACHERS-b", userId: "USERS-1", schoolCode: "SCH-001" },
    ];
    const synced = service.syncTeachersFromUserAccounts(
      {
        users: [teacherUser()],
        teachers,
        contacts: [],
        assignments: [],
      },
      {
        previousUsers: [teacherUser()],
        previousTeachers: teachers,
        nextUsers: [teacherUser()],
        nextTeachers: teachers,
        usersTouched: true,
        teachersTouched: true,
      },
    );
    assert.strictEqual(synced.teachers.length, 2, "historique multi inchangé");
    assert.deepStrictEqual(
      synced.teachers.map((t) => t.id).sort(),
      ["TEACHERS-a", "TEACHERS-b"],
    );
    assert.ok(
      synced.skips.some((s) => s.code === "TEACHER_CANON_AMBIGUOUS_SKIPPED_UNRELATED"),
    );
  }

  // §4.1.b — écriture liée (nouveau TEACHERS-* injecté) → throw
  {
    const previousTeachers = [
      { id: "TEACHERS-a", userId: "USERS-1", schoolCode: "SCH-001" },
    ];
    const nextTeachers = [
      { id: "TEACHERS-a", userId: "USERS-1", schoolCode: "SCH-001" },
      { id: "TEACHERS-b", userId: "USERS-1", schoolCode: "SCH-001" },
    ];
    assert.ok(
      isIdentityRelatedWrite(teacherUser(), {
        previousUsers: [teacherUser()],
        previousTeachers,
        nextUsers: [teacherUser()],
        nextTeachers,
        usersTouched: false,
        teachersTouched: true,
      }),
    );
    assert.throws(
      () =>
        service.syncTeachersFromUserAccounts(
          {
            users: [teacherUser()],
            teachers: nextTeachers,
            contacts: [],
            assignments: [],
          },
          {
            previousUsers: [teacherUser()],
            previousTeachers,
            usersTouched: false,
            teachersTouched: true,
          },
        ),
      (error) => error.code === "TEACHER_CANON_AMBIGUOUS",
    );
  }

  console.log("userTeacherSyncService.test.js : OK");
}

run();
