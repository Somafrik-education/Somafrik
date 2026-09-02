"use strict";

/**
 * Reproduction de l'échec de démarrage préprod Teachers :
 * doublons (school_id, user_id) → inventaire read-only → diagnostic exact →
 * refus de démarrage, avec cause préservée via initializeRepository (production).
 *
 * Aucune suppression / fusion / choix de canon.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  TEACHERS_SCHOOL_USER_UNIQUE_INDEX,
  TEACHERS_DOMAIN_CONSTRAINTS_CODE,
  formatTeachersSchoolUserDuplicateDiagnostic,
  inventoryTeachersSchoolUserDuplicates,
  ensureTeachersDomainConstraints,
  isTeachersDomainConstraintsError,
  createTeachersDomainConstraintsError,
} = require("./teachersUniqueness");
const { DbConfigError, sanitizeDbErrorMessage } = require("../db/connectionConfig");
const { initializeRepository } = require("../db/repositoryFactory");

const SAMPLE_GROUPS = [
  {
    school_code: "CD-2026-0001",
    user_id: "11111111-2222-3333-4444-555555555555",
    duplicate_count: 2,
    teacher_codes: ["CD-2026-0001-ENS-0001", "CD-2026-0001-ENS-0009"],
  },
];

function expectedDiagnostic(groups = SAMPLE_GROUPS, count = 1) {
  return formatTeachersSchoolUserDuplicateDiagnostic(groups, count);
}

function createDuplicateDbMock({
  duplicateGroups = 1,
  groups = SAMPLE_GROUPS,
  indexPresent = false,
  createIndexThrows = null,
} = {}) {
  const calls = { query: [], one: [], all: [] };
  return {
    calls,
    async one(sql, params) {
      calls.one.push({ sql, params });
      if (/duplicate_groups/i.test(sql)) {
        return { duplicate_groups: duplicateGroups };
      }
      if (/pg_indexes/i.test(sql)) {
        return indexPresent ? { present: 1 } : null;
      }
      return null;
    },
    async all(sql) {
      calls.all.push({ sql });
      if (/GROUP BY s\.school_code, t\.user_id/i.test(sql) || /HAVING COUNT\(\*\) > 1/i.test(sql)) {
        return groups;
      }
      return [];
    },
    async query(sql) {
      calls.query.push({ sql });
      if (createIndexThrows) {
        throw createIndexThrows;
      }
      return { rowCount: 0 };
    },
  };
}

describe("teachers domain constraints — boot préprod P0", () => {
  it("formate le diagnostic exact sans données sensibles", () => {
    const message = expectedDiagnostic();
    assert.match(message, /Teachers : 1 groupe\(s\) en doublon \(school_id, user_id\)/);
    assert.match(message, new RegExp(TEACHERS_SCHOOL_USER_UNIQUE_INDEX));
    assert.match(message, /Aucune suppression automatique/);
    assert.match(message, /CD-2026-0001\/user=11111111-2222-3333-4444-555555555555×2/);
    assert.match(message, /CD-2026-0001-ENS-0001,CD-2026-0001-ENS-0009/);
    assert.doesNotMatch(message, /password|email|phone|mot de passe|@/i);
  });

  it("inventaire read-only : compte + échantillon, sans écriture", async () => {
    const db = createDuplicateDbMock({ duplicateGroups: 1 });
    const inventory = await inventoryTeachersSchoolUserDuplicates(db);
    assert.equal(inventory.duplicateGroups, 1);
    assert.equal(inventory.groups.length, 1);
    assert.equal(inventory.diagnostic, expectedDiagnostic());
    assert.equal(db.calls.query.length, 0, "inventaire strictement read-only");
  });

  it("reproduit l'échec de démarrage : doublons → diagnostic exact + code domaine", async () => {
    const logs = [];
    const logger = {
      info: (msg) => logs.push(String(msg)),
      error: (msg) => logs.push(String(msg)),
      warn: (msg) => logs.push(String(msg)),
    };
    const db = createDuplicateDbMock({ duplicateGroups: 1 });

    await assert.rejects(
      () => ensureTeachersDomainConstraints(db, logger),
      (error) => {
        assert.equal(isTeachersDomainConstraintsError(error), true);
        assert.equal(error.code, TEACHERS_DOMAIN_CONSTRAINTS_CODE);
        assert.equal(error.message, expectedDiagnostic());
        assert.equal(error.inventory?.duplicateGroups, 1);
        return true;
      },
    );

    assert.equal(db.calls.query.length, 0, "aucune création d'index si doublons");
    assert.ok(logs.some((line) => line.includes("[teachers-domain] inventaire read-only")));
    assert.ok(logs.some((line) => line.includes(expectedDiagnostic())));
  });

  it("n'autorise le démarrage que si contraintes réellement satisfaites", async () => {
    const logs = [];
    const logger = {
      info: (msg) => logs.push(String(msg)),
      error: (msg) => logs.push(String(msg)),
    };

    // 0 doublon mais index absent après CREATE → refus
    const dbMissingIndex = createDuplicateDbMock({
      duplicateGroups: 0,
      groups: [],
      indexPresent: false,
    });
    await assert.rejects(
      () => ensureTeachersDomainConstraints(dbMissingIndex, logger),
      (error) => {
        assert.equal(isTeachersDomainConstraintsError(error), true);
        assert.match(error.message, /index teachers_school_user_unique absent/i);
        return true;
      },
    );

    // 0 doublon + index présent → OK
    const dbOk = createDuplicateDbMock({
      duplicateGroups: 0,
      groups: [],
      indexPresent: true,
    });
    await ensureTeachersDomainConstraints(dbOk, logger);
    assert.ok(dbOk.calls.query.some((c) => /CREATE UNIQUE INDEX/i.test(c.sql)));
    assert.ok(logs.some((line) => /contraintes satisfaites/i.test(line)));
  });

  it("initializeRepository (production) expose la cause réelle sanitisée", async () => {
    const diagnostic = expectedDiagnostic();
    const domainError = createTeachersDomainConstraintsError(diagnostic, {
      code: TEACHERS_DOMAIN_CONSTRAINTS_CODE,
      inventory: { duplicateGroups: 1, sampleCount: 1 },
    });

    const logs = [];
    const logger = {
      error: (msg) => logs.push(String(msg)),
      warn: (msg) => logs.push(String(msg)),
      info: (msg) => logs.push(String(msg)),
    };

    const fakeRepository = {
      engine: "postgresql",
      async init() {
        throw domainError;
      },
    };

    await assert.rejects(
      () =>
        initializeRepository({
          repository: fakeRepository,
          required: true,
          logger,
          env: {
            NODE_ENV: "production",
            SOMAFRIK_DB_REQUIRED: "true",
            SOMAFRIK_SKIP_DEMO_SEED: "true",
            DB_HOST: "db.example.com",
            DB_PORT: "5432",
            DB_NAME: "somafrik",
            DB_USER: "somafrik_app",
            DB_PASSWORD: "unit-test-password-value",
            DB_SSL: "require",
          },
        }),
      (error) => {
        assert.ok(error instanceof DbConfigError);
        assert.match(error.message, /Connexion PostgreSQL obligatoire impossible/);
        assert.match(error.message, /Cause:/);
        assert.match(error.message, /Teachers : 1 groupe/);
        assert.match(error.message, /Aucune suppression automatique/);
        assert.equal(error.domainCode, TEACHERS_DOMAIN_CONSTRAINTS_CODE);
        assert.equal(error.cause, domainError);
        // Pas de fuite du mot de passe BD.
        assert.doesNotMatch(error.message, /unit-test-password-value/);
        return true;
      },
    );

    assert.ok(logs.some((line) => line.includes("Échec initialisation PostgreSQL:")));
    assert.ok(logs.some((line) => line.includes(diagnostic)));
    assert.ok(logs.some((line) => line.includes(`Code domaine: ${TEACHERS_DOMAIN_CONSTRAINTS_CODE}`)));
  });

  it("sanitizeDbErrorMessage conserve le diagnostic Teachers", () => {
    const diagnostic = expectedDiagnostic();
    const sanitized = sanitizeDbErrorMessage(new Error(diagnostic));
    assert.equal(sanitized, diagnostic);
  });
});
