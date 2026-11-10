"use strict";

/**
 * MONO-T0 — non-régression du retrait LOT 8 (élèves).
 *
 * Remplace l'ancienne preuve HOTFIX-PRE-E1-01 qui testait le pipeline
 * `saveBackOfficeState → syncStudentsDomainFromBackOffice → materializeBackOfficeStudent`.
 * Ce pipeline a été retiré par LOT 8 (f5e3ad36) : les élèves ne s'écrivent plus
 * que par les APIs métier canoniques. Ce test vérifie le refus, de façon
 * comportementale, sur les deux implémentations du dépôt :
 *   - rejet BACKOFFICE_STATE_WRITE_REMOVED (410), message exact ;
 *   - aucune requête SQL, aucune transaction ;
 *   - aucun appel aux anciennes synchronisations élèves ;
 *   - aucune donnée élève modifiée, même avec un payload multi-établissements.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PostgresRepository } = require("../db/postgresRepository");
const { FallbackRepository } = require("../db/fallbackRepository");
const {
  BACKOFFICE_STATE_WRITE_REMOVED_CODE,
  BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
  BACKOFFICE_STATE_WRITE_REMOVED_STATUS,
} = require("./backofficeStateRemoval");

const LEGACY_STUDENT_SYNC_METHODS = [
  "syncStudentsDomainFromBackOffice",
  "materializeBackOfficeStudent",
];

function studentsPayload() {
  return {
    schools: [
      { code: "CD-T0-0001", name: "École A", status: "Actif" },
      { code: "CD-T0-0002", name: "École B", status: "Actif" },
    ],
    classes: [
      { code: "CL-A-6A", schoolCode: "CD-T0-0001", name: "6e A" },
      { code: "CL-B-6A", schoolCode: "CD-T0-0002", name: "6e A" },
    ],
    students: [
      { id: "STU-A-1", schoolCode: "CD-T0-0001", classCode: "CL-A-6A", firstName: "Awa", lastName: "Kabila" },
      { id: "STU-B-1", schoolCode: "CD-T0-0002", classCode: "CL-B-6A", firstName: "Jean", lastName: "Mbala" },
    ],
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
  for (const method of LEGACY_STUDENT_SYNC_METHODS) {
    repo[method] = record(method);
  }
  return { repo, calls };
}

test("PostgreSQL : saveBackOfficeState refuse un payload élèves (410) sans aucune écriture", async () => {
  const { repo, calls } = instrumentedPostgresRepository();

  await assert.rejects(() => repo.saveBackOfficeState(studentsPayload()), isWriteRemovedError);

  assert.deepEqual(calls, [], "aucune requête, transaction ni synchronisation legacy");
  assert.deepEqual(repo.cachedDataset, { marker: "dataset-before" }, "le cache du dataset n'est pas touché");
});

test("PostgreSQL : le refus ne dépend pas du contenu (payload vide, élèves seuls, null)", async () => {
  for (const payload of [{}, { students: studentsPayload().students }, null, undefined]) {
    const { repo, calls } = instrumentedPostgresRepository();
    await assert.rejects(() => repo.saveBackOfficeState(payload), isWriteRemovedError);
    assert.deepEqual(calls, []);
  }
});

test("PostgreSQL : la lecture du snapshot global reste supprimée", async () => {
  const { repo, calls } = instrumentedPostgresRepository();
  assert.equal(await repo.getBackOfficeState(), null);
  assert.deepEqual(calls, []);
});

test("Mémoire : saveBackOfficeState refuse un payload élèves (410) et ne modifie aucun élève", async () => {
  const repo = new FallbackRepository();
  await repo.init();
  const before = JSON.stringify((await repo.getDataset()).students ?? []);
  let legacyCalls = 0;
  for (const method of LEGACY_STUDENT_SYNC_METHODS) {
    repo[method] = async () => {
      legacyCalls += 1;
    };
  }

  await assert.rejects(() => repo.saveBackOfficeState(studentsPayload()), isWriteRemovedError);

  assert.equal(legacyCalls, 0);
  assert.equal(JSON.stringify((await repo.getDataset()).students ?? []), before);
  assert.equal(await repo.getBackOfficeState(), null);
});
