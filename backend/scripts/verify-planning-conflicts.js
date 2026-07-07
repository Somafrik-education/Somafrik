"use strict";

/**
 * Vérifie le moteur de conflits de planning côté backend (filet de sécurité).
 * Exécution : node scripts/verify-planning-conflicts.js
 */

const assert = require("assert");
const {
  detectIntroducedConflicts,
  changedScheduleIds,
  conflictMessages,
} = require("../lib/planningConflicts");

const base = {
  id: "CS-1",
  schoolCode: "CD-2026-0001",
  className: "6ème A",
  subject: "Mathématiques",
  teacherId: "T1",
  teacherName: "Seke Kilombo",
  start: "2026-09-14T10:00:00.000Z",
  end: "2026-09-14T11:00:00.000Z",
  kind: "course",
  periodName: "Trimestre 1",
  periodStart: "10-09-2026",
  periodEnd: "23-12-2026",
};

const checks = [];
function test(label, fn) {
  checks.push([label, fn]);
}

test("Chevauchement enseignant sur deux classes", () => {
  const other = {
    ...base,
    id: "CS-2",
    className: "5ème B",
    subject: "Physique",
    start: "2026-09-14T10:30:00.000Z",
    end: "2026-09-14T11:30:00.000Z",
  };
  const messages = conflictMessages(base, other);
  assert.ok(
    messages.some((m) => m.includes("Conflit enseignant")),
    "Double réservation enseignant attendue",
  );
});

test("Professeurs différents → aucun conflit enseignant", () => {
  const other = {
    ...base,
    id: "CS-3",
    className: "5ème B",
    subject: "Physique",
    teacherId: "T2",
    teacherName: "Autre Prof",
    start: "2026-09-14T10:30:00.000Z",
    end: "2026-09-14T11:30:00.000Z",
  };
  const messages = conflictMessages(base, other);
  assert.ok(!messages.some((m) => m.includes("Conflit enseignant")), "Aucun conflit attendu");
});

test("Créneaux adjacents (10-11 / 11-12) → aucun conflit", () => {
  const other = {
    ...base,
    id: "CS-4",
    className: "5ème B",
    teacherId: "T1",
    start: "2026-09-14T11:00:00.000Z",
    end: "2026-09-14T12:00:00.000Z",
  };
  assert.strictEqual(conflictMessages(base, other).length, 0, "Adjacents = pas de conflit");
});

test("Jours de semaine différents → aucun conflit", () => {
  const other = {
    ...base,
    id: "CS-5",
    className: "5ème B",
    teacherId: "T1",
    start: "2026-09-15T10:30:00.000Z", // mardi
    end: "2026-09-15T11:30:00.000Z",
  };
  assert.strictEqual(conflictMessages(base, other).length, 0, "Jours différents = pas de conflit");
});

test("Périodes disjointes → aucun conflit", () => {
  const other = {
    ...base,
    id: "CS-6",
    className: "5ème B",
    teacherId: "T1",
    start: "2026-09-14T10:30:00.000Z",
    end: "2026-09-14T11:30:00.000Z",
    periodName: "Trimestre 2",
    periodStart: "06-01-2027",
    periodEnd: "31-03-2027",
  };
  assert.strictEqual(conflictMessages(base, other).length, 0, "Périodes disjointes = pas de conflit");
});

test("Écoles différentes → aucun conflit", () => {
  const other = {
    ...base,
    id: "CS-7",
    schoolCode: "CD-2026-0002",
    className: "5ème B",
    teacherId: "T1",
    start: "2026-09-14T10:30:00.000Z",
    end: "2026-09-14T11:30:00.000Z",
  };
  assert.strictEqual(conflictMessages(base, other).length, 0, "Écoles différentes = pas de conflit");
});

test("detectIntroducedConflicts ne bloque que le delta", () => {
  // Deux créneaux historiques déjà en conflit : ne doivent PAS bloquer si non modifiés.
  const legacyA = { ...base, id: "L1" };
  const legacyB = {
    ...base,
    id: "L2",
    className: "5ème B",
    subject: "Physique",
    start: "2026-09-14T10:30:00.000Z",
    end: "2026-09-14T11:30:00.000Z",
  };
  const noDelta = detectIntroducedConflicts([legacyA, legacyB], []);
  assert.strictEqual(noDelta.length, 0, "Aucun delta = aucun blocage sur historique");

  // Nouveau créneau introduisant une double réservation → bloqué.
  const nextSlots = [legacyA, { ...legacyB, id: "NEW" }];
  const introduced = detectIntroducedConflicts(nextSlots, ["NEW"]);
  assert.ok(
    introduced.some((i) => i.message.includes("Conflit enseignant")),
    "Le créneau introduit doit être bloqué",
  );
});

test("changedScheduleIds détecte ajout et modification", () => {
  const prev = [base];
  const next = [
    { ...base, start: "2026-09-14T14:00:00.000Z", end: "2026-09-14T15:00:00.000Z" }, // modifié
    { ...base, id: "CS-NEW" }, // ajouté
  ];
  const ids = changedScheduleIds(prev, next).sort();
  assert.deepStrictEqual(ids, ["CS-1", "CS-NEW"], "Delta = créneau modifié + ajouté");

  const unchanged = changedScheduleIds([base], [base]);
  assert.strictEqual(unchanged.length, 0, "Aucun changement = delta vide");
});

let passed = 0;
for (const [label, fn] of checks) {
  fn();
  passed += 1;
  console.log(`\u2713 ${label}`);
}
console.log(`\n${passed}/${checks.length} vérifications conflits planning OK.`);
