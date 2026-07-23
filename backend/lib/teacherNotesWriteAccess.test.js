/**
 * HOTFIX-SYNC-03 — Autorisation métier enseignant (evaluations + notes).
 */
const assert = require("assert");
const {
  evaluateTeacherNotesTouchedKeys,
  prepareTeacherNotesWritePayload,
  resolveSessionTeacherId,
  teacherHasNotesWritePermission,
  TEACHER_NOTES_WRITABLE_KEYS,
} = require("./teacherNotesWriteAccess");

function buildState(overrides = {}) {
  return {
    teachers: [
      {
        id: "t-math",
        userId: "u-teacher",
        firstName: "Awa",
        lastName: "Diallo",
        schoolCode: "CD-2026-0001",
        assignments: [{ className: "6e A", course: "Mathématiques" }],
      },
      {
        id: "t-other",
        userId: "u-other",
        firstName: "Jean",
        lastName: "Kouassi",
        schoolCode: "CD-2026-0001",
        assignments: [{ className: "5e B", course: "Français" }],
      },
    ],
    assignments: [
      {
        id: "a1",
        teacherId: "t-math",
        className: "6e A",
        course: "Mathématiques",
        schoolCode: "CD-2026-0001",
      },
      {
        id: "a2",
        teacherId: "t-other",
        className: "5e B",
        course: "Français",
        schoolCode: "CD-2026-0001",
      },
    ],
    evaluations: [
      {
        id: "ev-other",
        title: "Autre",
        className: "5e B",
        subject: "Français",
        teacherId: "t-other",
        schoolCode: "CD-2026-0001",
      },
    ],
    notes: [],
    ...overrides,
  };
}

const teacherPrincipal = {
  role: "Enseignant",
  sub: "u-teacher",
  id: "u-teacher",
  schoolCode: "CD-2026-0001",
  authSource: "backoffice",
  permissions: ["Notes:CRUD"],
};

function run() {
  assert.deepStrictEqual([...TEACHER_NOTES_WRITABLE_KEYS], ["evaluations", "notes"]);
  assert.strictEqual(teacherHasNotesWritePermission(teacherPrincipal), true);
  assert.strictEqual(evaluateTeacherNotesTouchedKeys(["evaluations"]).ok, true);
  assert.strictEqual(evaluateTeacherNotesTouchedKeys(["evaluations", "notes"]).ok, true);
  assert.strictEqual(evaluateTeacherNotesTouchedKeys(["evaluations", "payments"]).ok, false);
  assert.strictEqual(evaluateTeacherNotesTouchedKeys(["auditLog"]).ok, false);
  assert.strictEqual(evaluateTeacherNotesTouchedKeys(["exams"]).ok, false);

  const state = buildState();

  // 1) Enseignant affecté → création acceptée + teacherId session (pas client).
  const accepted = prepareTeacherNotesWritePayload(
    {
      evaluations: [
        {
          id: "ev-new",
          title: "Devoir 1",
          className: "6e A",
          subject: "Mathématiques",
          teacherId: "forged-teacher",
          schoolCode: "CD-2026-0001",
        },
      ],
    },
    teacherPrincipal,
    state,
  );
  assert.strictEqual(accepted.ok, true, accepted.message);
  assert.strictEqual(resolveSessionTeacherId(teacherPrincipal, state), "t-math");
  const created = accepted.payload.evaluations.find((row) => row.id === "ev-new");
  assert.ok(created);
  assert.strictEqual(created.teacherId, "t-math", "teacherId doit venir de la session");
  assert.ok(
    accepted.payload.evaluations.some((row) => row.id === "ev-other"),
    "doit préserver les évaluations des autres enseignants",
  );

  // 2) Enseignant autre classe → 403
  const wrongClass = prepareTeacherNotesWritePayload(
    {
      evaluations: [
        {
          id: "ev-bad-class",
          title: "Intrus",
          className: "5e B",
          subject: "Mathématiques",
          schoolCode: "CD-2026-0001",
        },
      ],
    },
    teacherPrincipal,
    state,
  );
  assert.strictEqual(wrongClass.ok, false);
  assert.match(wrongClass.message, /non affecté|Permission insuffisante/);

  // 3) Enseignant autre matière → 403
  const wrongSubject = prepareTeacherNotesWritePayload(
    {
      evaluations: [
        {
          id: "ev-bad-subject",
          title: "Intrus",
          className: "6e A",
          subject: "Français",
          schoolCode: "CD-2026-0001",
        },
      ],
    },
    teacherPrincipal,
    state,
  );
  assert.strictEqual(wrongSubject.ok, false);
  assert.match(wrongSubject.message, /non affecté|Permission insuffisante/);

  // 4) Admin établissement — hors chemin enseignant (matrice BO) : ce module ne bloque pas.
  //    Vérifie seulement que le rôle Admin School n'est pas traité comme enseignant métier ici.
  const { isTeacherNotesPrincipal } = require("./teacherNotesWriteAccess");
  assert.strictEqual(isTeacherNotesPrincipal({ role: "Admin School" }), false);
  assert.strictEqual(isTeacherNotesPrincipal({ role: "Directeur" }), false);
  assert.strictEqual(isTeacherNotesPrincipal(teacherPrincipal), true);

  // 5) Payload enseignant contenant payments/exams → rejeté
  const withPayments = prepareTeacherNotesWritePayload(
    {
      evaluations: [
        {
          id: "ev-ok",
          title: "OK",
          className: "6e A",
          subject: "Mathématiques",
          schoolCode: "CD-2026-0001",
        },
      ],
      payments: [{ id: "pay-1", amount: 100 }],
    },
    teacherPrincipal,
    state,
  );
  assert.strictEqual(withPayments.ok, false);
  assert.ok(withPayments.forbidden.includes("payments"));

  const withExams = prepareTeacherNotesWritePayload(
    {
      evaluations: [
        {
          id: "ev-ok2",
          title: "OK",
          className: "6e A",
          subject: "Mathématiques",
          schoolCode: "CD-2026-0001",
        },
      ],
      exams: [{ id: "ex-1" }],
    },
    teacherPrincipal,
    state,
  );
  assert.strictEqual(withExams.ok, false);
  assert.ok(withExams.forbidden.includes("exams"));

  // Notes : stamp session + affectation
  const notesOk = prepareTeacherNotesWritePayload(
    {
      notes: [
        {
          id: "n1",
          className: "6e A",
          subject: "Mathématiques",
          teacherId: "forged",
          schoolCode: "CD-2026-0001",
          value: 12,
        },
      ],
    },
    teacherPrincipal,
    state,
  );
  assert.strictEqual(notesOk.ok, true, notesOk.message);
  assert.strictEqual(notesOk.payload.notes[0].teacherId, "t-math");

  // 6) PUT partiel — upsert par id, jamais de suppression implicite (revue CTO #72)
  const stateTwoEvals = buildState({
    evaluations: [
      {
        id: "ev-A",
        title: "Eval A",
        className: "6e A",
        subject: "Mathématiques",
        teacherId: "t-math",
        schoolCode: "CD-2026-0001",
      },
      {
        id: "ev-B",
        title: "Eval B",
        className: "6e A",
        subject: "Mathématiques",
        teacherId: "t-math",
        schoolCode: "CD-2026-0001",
      },
      {
        id: "ev-other",
        title: "Autre",
        className: "5e B",
        subject: "Français",
        teacherId: "t-other",
        schoolCode: "CD-2026-0001",
      },
    ],
  });
  const patchEvalA = prepareTeacherNotesWritePayload(
    {
      evaluations: [
        {
          id: "ev-A",
          title: "Eval A modifiée",
          className: "6e A",
          subject: "Mathématiques",
          schoolCode: "CD-2026-0001",
        },
      ],
    },
    teacherPrincipal,
    stateTwoEvals,
  );
  assert.strictEqual(patchEvalA.ok, true, patchEvalA.message);
  const evalIds = patchEvalA.payload.evaluations.map((row) => row.id).sort();
  assert.deepStrictEqual(evalIds, ["ev-A", "ev-B", "ev-other"]);
  assert.strictEqual(
    patchEvalA.payload.evaluations.find((row) => row.id === "ev-A")?.title,
    "Eval A modifiée",
  );
  assert.strictEqual(
    patchEvalA.payload.evaluations.find((row) => row.id === "ev-B")?.title,
    "Eval B",
    "eval B du même enseignant doit être conservée",
  );
  assert.strictEqual(
    patchEvalA.payload.evaluations.find((row) => row.id === "ev-other")?.teacherId,
    "t-other",
    "ligne d'un autre enseignant toujours conservée",
  );

  const stateTwoNotes = buildState({
    notes: [
      {
        id: "note-1",
        className: "6e A",
        subject: "Mathématiques",
        teacherId: "t-math",
        schoolCode: "CD-2026-0001",
        value: 10,
      },
      {
        id: "note-2",
        className: "6e A",
        subject: "Mathématiques",
        teacherId: "t-math",
        schoolCode: "CD-2026-0001",
        value: 12,
      },
      {
        id: "note-other",
        className: "5e B",
        subject: "Français",
        teacherId: "t-other",
        schoolCode: "CD-2026-0001",
        value: 15,
      },
    ],
  });
  const patchNote1 = prepareTeacherNotesWritePayload(
    {
      notes: [
        {
          id: "note-1",
          className: "6e A",
          subject: "Mathématiques",
          schoolCode: "CD-2026-0001",
          value: 18,
        },
      ],
    },
    teacherPrincipal,
    stateTwoNotes,
  );
  assert.strictEqual(patchNote1.ok, true, patchNote1.message);
  const noteIds = patchNote1.payload.notes.map((row) => row.id).sort();
  assert.deepStrictEqual(noteIds, ["note-1", "note-2", "note-other"]);
  assert.strictEqual(patchNote1.payload.notes.find((row) => row.id === "note-1")?.value, 18);
  assert.strictEqual(
    patchNote1.payload.notes.find((row) => row.id === "note-2")?.value,
    12,
    "note 2 du même enseignant doit être conservée",
  );
  assert.strictEqual(
    patchNote1.payload.notes.find((row) => row.id === "note-other")?.teacherId,
    "t-other",
  );

  console.log("OK teacherNotesWriteAccess HOTFIX-SYNC-03/04 upsert partiel");
}

run();
