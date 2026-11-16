"use strict";

/**
 * MONO-T0 — non-régression du retrait LOT 8 (enseignants, affectations,
 * évaluations, notes).
 *
 * Remplace l'ancienne preuve HOTFIX-PRE-E1-02/02B qui testait le pipeline
 * `saveBackOfficeState → syncPedagogyStaffDomainFromBackOffice / syncNotesDomainFromBackOffice`.
 * Ce pipeline a été retiré par LOT 8 (f5e3ad36) : la pédagogie ne s'écrit plus
 * que par les APIs métier canoniques. Ce test vérifie le refus, de façon
 * comportementale, sur les deux implémentations du dépôt :
 *   - rejet BACKOFFICE_STATE_WRITE_REMOVED (410), message exact ;
 *   - aucune requête SQL, aucune transaction ;
 *   - aucun appel aux anciennes synchronisations ou migrations BackOffice ;
 *   - aucune donnée enseignant, affectation, évaluation ou note modifiée ;
 *   - la réponse HTTP de PUT /api/backoffice/state reste 410 avec le même contrat.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PostgresRepository } = require("../db/postgresRepository");
const { FallbackRepository } = require("../db/fallbackRepository");
const {
  BACKOFFICE_STATE_WRITE_REMOVED_CODE,
  BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
  BACKOFFICE_STATE_WRITE_REMOVED_STATUS,
  sendBackOfficeStateWriteRemoved,
} = require("./backofficeStateRemoval");

const LEGACY_PEDAGOGY_SYNC_METHODS = [
  "syncPedagogyStaffDomainFromBackOffice",
  "syncNotesDomainFromBackOffice",
  "migrateEvaluationsFromBackOffice",
  "migrateNotesFromBackOffice",
  "upsertEvaluationFromLegacy",
];

const PEDAGOGY_KEYS = ["teachers", "assignments", "evaluations", "notes"];

function pedagogyPayload() {
  return {
    schools: [{ code: "CD-T0-0001", name: "École A", status: "Actif" }],
    teachers: [{ code: "TCH-T0-1", schoolCode: "CD-T0-0001", firstName: "Marie", lastName: "Ilunga" }],
    assignments: [
      { id: "ASG-T0-1", schoolCode: "CD-T0-0001", teacherCode: "TCH-T0-1", classCode: "CL-A-6A", subject: "Mathématiques" },
    ],
    evaluations: [
      { id: "EVAL-T0-1", schoolCode: "CD-T0-0001", classCode: "CL-A-6A", subject: "Mathématiques", maxScore: 20 },
    ],
    notes: [{ evaluationId: "EVAL-T0-1", studentId: "STU-A-1", score: 14 }],
  };
}

function isWriteRemovedError(error) {
  assert.equal(error.code, BACKOFFICE_STATE_WRITE_REMOVED_CODE);
  assert.equal(error.statusCode, BACKOFFICE_STATE_WRITE_REMOVED_STATUS);
  assert.equal(error.statusCode, 410);
  assert.equal(error.message, BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE);
  return true;
}

/** Dépôt PostgreSQL sans connexion : toute tentative d'accès base est enregistrée. */
function instrumentedPostgresRepository() {
  const calls = [];
  const repo = Object.create(PostgresRepository.prototype);
  repo.engine = "postgresql";
  repo.ready = true;
  repo.cachedDataset = { marker: "dataset-before" };
  const record = (name) => async (...args) => {
    calls.push({ name, sql: typeof args[0] === "string" ? args[0] : undefined });
    return { rows: [], rowCount: 0 };
  };
  repo.query = record("query");
  repo.all = record("all");
  repo.one = record("one");
  repo.get = record("get");
  repo.run = record("run");
  repo.withTransaction = record("withTransaction");
  repo.pool = {
    connect: async () => {
      calls.push({ name: "pool.connect" });
      return { query: record("client.query"), release() {} };
    },
    query: record("pool.query"),
    end: async () => {},
  };
  for (const method of LEGACY_PEDAGOGY_SYNC_METHODS) {
    repo[method] = record(method);
  }
  return { repo, calls };
}

test("PostgreSQL : saveBackOfficeState refuse un payload pédagogie (410) sans aucune écriture", async () => {
  const { repo, calls } = instrumentedPostgresRepository();

  await assert.rejects(() => repo.saveBackOfficeState(pedagogyPayload()), isWriteRemovedError);

  assert.deepEqual(calls, [], "aucune requête, transaction, synchronisation ni migration legacy");
  assert.deepEqual(repo.cachedDataset, { marker: "dataset-before" }, "le cache du dataset n'est pas touché");
});

test("PostgreSQL : chaque domaine pédagogique seul est refusé", async () => {
  const payload = pedagogyPayload();
  for (const key of PEDAGOGY_KEYS) {
    const { repo, calls } = instrumentedPostgresRepository();
    await assert.rejects(() => repo.saveBackOfficeState({ [key]: payload[key] }), isWriteRemovedError);
    assert.deepEqual(calls, [], `aucune écriture pour ${key}`);
  }
});

test("Mémoire : saveBackOfficeState refuse un payload pédagogie (410) et ne modifie aucune donnée", async () => {
  const repo = new FallbackRepository();
  await repo.init();
  const snapshot = async () => {
    const dataset = await repo.getDataset();
    return JSON.stringify({
      teachers: dataset.teachers ?? [],
      assignments: dataset.teacherAssignments ?? [],
      evaluations: dataset.evaluations ?? [],
      notes: dataset.notes ?? [],
    });
  };
  const before = await snapshot();
  let legacyCalls = 0;
  for (const method of LEGACY_PEDAGOGY_SYNC_METHODS) {
    repo[method] = async () => {
      legacyCalls += 1;
    };
  }

  await assert.rejects(() => repo.saveBackOfficeState(pedagogyPayload()), isWriteRemovedError);

  assert.equal(legacyCalls, 0);
  assert.equal(await snapshot(), before);
});

test("HTTP : la réponse de PUT /api/backoffice/state reste 410 avec le contrat de refus", () => {
  const sent = {};
  const res = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return this;
    },
  };

  sendBackOfficeStateWriteRemoved(res);

  assert.equal(sent.status, 410);
  assert.deepEqual(sent.body, {
    code: BACKOFFICE_STATE_WRITE_REMOVED_CODE,
    message: BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
  });
});
