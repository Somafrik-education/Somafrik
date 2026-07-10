const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateNoteWrite,
  validatePresenceWrite,
  validatePaymentWrite,
  validateGradeValue,
  detectDuplicateNoteKeys,
  detectDuplicatePresenceKeys,
  auditOrphanNotes,
  auditCrossSchoolStudents,
  classNamesMatch,
} = require("../lib/dataIntegrityRules");
const { auditBackOfficeState, validateWritePayload } = require("../services/dataIntegrityService");

function baseState() {
  return {
    schools: [{ code: "CD-2026-0001", name: "École A" }],
    students: [
      {
        id: "STU-1",
        matricule: "ELE-001",
        firstName: "Jean",
        lastName: "Mbuyi",
        className: "1ère A",
        schoolCode: "CD-2026-0001",
        status: "Actif",
      },
    ],
    evaluations: [
      {
        id: "EVAL-1",
        schoolCode: "CD-2026-0001",
        className: "1ère A",
        subject: "Mathématiques",
        status: "Ouverte",
        active: true,
        scale: 20,
      },
    ],
    classes: [{ id: "CLS-1", name: "1ère A", schoolCode: "CD-2026-0001" }],
    notes: [],
    presences: [],
    payments: [],
    teachers: [{ id: "TEA-1", schoolCode: "CD-2026-0001", status: "Actif" }],
  };
}

describe("Intégrité — notes", () => {
  it("refuse une note sans élève existant", () => {
    const message = validateNoteWrite(baseState(), {
      studentId: "GHOST",
      evaluationId: "EVAL-1",
      value: 12,
      scale: 20,
    });
    assert.match(message, /introuvable/i);
  });

  it("refuse une note au-dessus du barème", () => {
    assert.match(validateGradeValue(21, 20), /barème/i);
  });

  it("accepte une note valide", () => {
    assert.equal(
      validateNoteWrite(baseState(), {
        studentId: "STU-1",
        evaluationId: "EVAL-1",
        value: 15,
        scale: 20,
        schoolCode: "CD-2026-0001",
      }),
      null,
    );
  });

  it("refuse une note cross-établissement", () => {
    const state = baseState();
    state.evaluations[0].schoolCode = "CD-2026-0002";
    const message = validateNoteWrite(state, {
      studentId: "STU-1",
      evaluationId: "EVAL-1",
      value: 10,
      scale: 20,
    });
    assert.match(message, /établissement/i);
  });

  it("détecte les doublons élève/évaluation", () => {
    const duplicates = detectDuplicateNoteKeys([
      { studentId: "STU-1", evaluationId: "EVAL-1" },
      { studentId: "STU-1", evaluationId: "EVAL-1" },
    ]);
    assert.equal(duplicates.length, 1);
  });
});

describe("Intégrité — présences", () => {
  it("refuse une présence sans élève", () => {
    assert.match(
      validatePresenceWrite(baseState(), { studentId: "GHOST", date: "10-07-2026", className: "1ère A" }),
      /introuvable/i,
    );
  });

  it("refuse une présence en double le même jour", () => {
    const state = {
      ...baseState(),
      presences: [{ id: "PRE-1", studentId: "STU-1", date: "10-07-2026", className: "1ère A" }],
    };
    const message = validatePresenceWrite(state, {
      studentId: "STU-1",
      date: "10-07-2026",
      className: "1ère A",
    });
    assert.match(message, /déjà/i);
  });

  it("accepte les noms de classe avec accents différents", () => {
    assert.equal(classNamesMatch("1ère A", "1ere a"), true);
    assert.equal(
      validatePresenceWrite(baseState(), {
        studentId: "STU-1",
        date: "11-07-2026",
        className: "1ere a",
      }),
      null,
    );
  });

  it("détecte les doublons présence", () => {
    const duplicates = detectDuplicatePresenceKeys([
      { studentId: "STU-1", date: "10-07-2026", className: "1ère A" },
      { studentId: "STU-1", date: "10-07-2026", className: "1ere a" },
    ]);
    assert.equal(duplicates.length, 1);
  });
});

describe("Intégrité — paiements", () => {
  it("refuse un montant négatif", () => {
    assert.match(
      validatePaymentWrite(baseState(), {
        studentId: "STU-1",
        amount: -10,
        date: "10-07-2026",
        method: "Espèces",
      }),
      /positif/i,
    );
  });

  it("refuse un paiement sans élève", () => {
    assert.match(
      validatePaymentWrite(baseState(), {
        studentId: "GHOST",
        amount: 1000,
        date: "10-07-2026",
        method: "Espèces",
      }),
      /introuvable/i,
    );
  });
});

describe("Intégrité — audit état", () => {
  it("signale les notes orphelines", () => {
    const state = {
      ...baseState(),
      notes: [{ id: "NOTE-1", studentId: "GHOST", evaluationId: "EVAL-1", value: 10 }],
    };
    const issues = auditOrphanNotes(state);
    assert.ok(issues.some((item) => item.code === "orphan_note"));
  });

  it("signale un élève sans établissement", () => {
    const state = {
      ...baseState(),
      students: [{ id: "STU-2", firstName: "A", lastName: "B", className: "1ère A" }],
    };
    const issues = auditCrossSchoolStudents(state);
    assert.ok(issues.some((item) => item.code === "student_without_school"));
  });

  it("valide un payload PUT touché", () => {
    const state = baseState();
    const result = validateWritePayload(
      state,
      {
        notes: [{ studentId: "STU-1", evaluationId: "EVAL-1", value: 14, scale: 20 }],
      },
      ["notes"],
    );
    assert.equal(result.ok, true);
  });

  it("rejette un payload PUT avec note invalide", () => {
    const state = baseState();
    const result = validateWritePayload(
      state,
      { notes: [{ studentId: "GHOST", evaluationId: "EVAL-1", value: 14, scale: 20 }] },
      ["notes"],
    );
    assert.equal(result.ok, false);
  });

  it("ignore les notes orphelines inchangées dans un PUT état complet", () => {
    const state = {
      ...baseState(),
      notes: [{ id: "NOTE-ORPHAN", studentId: "GHOST", evaluationId: "EVAL-1", value: 12, scale: 20 }],
    };
    const result = validateWritePayload(
      state,
      {
        users: state.users,
        notes: state.notes,
      },
      ["users", "notes"],
    );
    assert.equal(result.ok, true);
  });

  it("produit un rapport d'audit sans critique sur état sain", () => {
    const report = auditBackOfficeState(baseState());
    assert.equal(report.summary.bySeverity.critical ?? 0, 0);
  });
});

describe("Concurrence optimiste — notes", () => {
  const { assertNoteOptimisticLock, bumpNoteVersion, noteVersion } = require("../lib/noteConcurrency");
  const { BusinessError } = require("../services/authService");

  it("refuse une mise à jour avec version obsolète", () => {
    const current = { id: "NOTE-1", version: 2, value: 12 };
    assert.throws(
      () => assertNoteOptimisticLock(current, 1),
      (error) => error instanceof BusinessError && error.statusCode === 409,
    );
  });

  it("incrémente la version à chaque sauvegarde", () => {
    const bumped = bumpNoteVersion({ id: "NOTE-1", version: 1 }, { sub: "TEA-1" });
    assert.equal(bumped.version, 2);
    assert.ok(bumped.updatedAt);
  });
});

describe("Import élèves — validation", () => {
  const { validateStudentImportRows } = require("../services/importValidationService");

  it("accepte une ligne valide et rejette une ligne incomplète", () => {
    const state = baseState();
    const report = validateStudentImportRows(
      [
        {
          Nom: "Mbuyi",
          Prénom: "Jean",
          "Code établissement": "CD-2026-0001",
          Classe: "1ère A",
        },
        { Nom: "", Prénom: "Sans nom" },
      ],
      state,
    );
    assert.equal(report.summary.accepted, 1);
    assert.equal(report.summary.rejected, 1);
  });
});

describe("Idempotence", () => {
  const { IdempotencyService } = require("../services/idempotencyService");

  it("rejoue une réponse stockée", async () => {
    const memoryRepo = {
      async findIdempotencyRecord() {
        return null;
      },
      async saveIdempotencyRecord() {},
    };
    const service = new IdempotencyService(memoryRepo);
    await service.store("key-1", "POST /api/notes", "user-1", 201, { id: "NOTE-1" });
    const replay = await service.findReplay("key-1", "POST /api/notes", "user-1");
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.body.id, "NOTE-1");
    assert.equal(replay.replay, true);
  });
});

describe("CONTACT-004 — provisionnement via Contacts", () => {
  const { validateContactProvision } = require("../lib/contactProvisionRules");
  const { UserTeacherSyncService } = require("../services/userTeacherSyncService");

  it("refuse un nouvel élève sans contact", () => {
    const state = baseState();
    const errors = validateContactProvision(
      state,
      {
        students: [
          ...(state.students ?? []),
          { id: "STU-NEW", firstName: "Nouveau", lastName: "SansContact", schoolCode: "CD-2026-0001" },
        ],
      },
      ["students"],
    );
    assert.ok(errors.some((item) => item.entity === "students"));
  });

  it("autorise un compte Admin School sans contact", () => {
    const errors = validateContactProvision(
      baseState(),
      {
        users: [
          {
            id: "ADM-NEW",
            role: "Admin School",
            identifier: "ADM-0099",
            schoolCode: "CD-2026-0001",
            firstName: "Admin",
            lastName: "Test",
          },
        ],
      },
      ["users"],
    );
    assert.equal(errors.length, 0);
  });

  it("refuse un compte enseignant sans contact", () => {
    const errors = validateContactProvision(
      baseState(),
      {
        users: [
          {
            id: "USR-NEW",
            role: "Enseignant",
            identifier: "ENS-0099",
            schoolCode: "CD-2026-0001",
            firstName: "Prof",
            lastName: "SansContact",
          },
        ],
      },
      ["users"],
    );
    assert.ok(errors.some((item) => item.entity === "users"));
  });

  it("propage contactId user → fiche teacher", () => {
    const service = new UserTeacherSyncService();
    const result = service.syncTeachersFromUserAccounts({
      contacts: [{ id: "CONTACT-1", contactType: "Enseignant", firstName: "Jean", lastName: "Prof", schoolCode: "CD-2026-0001" }],
      teachers: [],
      users: [
        {
          id: "USR-1",
          role: "Enseignant",
          identifier: "ENS-0001",
          schoolCode: "CD-2026-0001",
          firstName: "Jean",
          lastName: "Prof",
          contactId: "CONTACT-1",
        },
      ],
    });
    assert.equal(result.teachers[0].contactId, "CONTACT-1");
    assert.equal(result.contacts[0].teacherId, result.teachers[0].id);
  });
});
