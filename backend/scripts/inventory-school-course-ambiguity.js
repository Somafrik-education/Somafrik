"use strict";

/**
 * Inventaire PostgreSQL read-only des collisions school_courses.
 *
 * Usage :
 *   DATABASE_URL=... npm run inventory:school-course-ambiguity
 *   PREPROD_DATABASE_URL=... npm run inventory:school-course-ambiguity
 *
 * Preuve ops (hors dépôt) :
 *   PROOF_OUT=/tmp/school-course-ambiguity.json npm run inventory:school-course-ambiguity
 *
 * - Transaction BEGIN READ ONLY
 * - Refuse --apply / --write / --fix / --delete
 * - Aucune suppression, aucun archivage
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  inventorySchoolCourseAmbiguity,
  assertNoWriteFlags,
  UNIQUE_INDEX_NAME,
  SCHOOL_COURSE_AMBIGUITY_OK,
} = require("../lib/schoolCourseAmbiguityInventory");
const {
  resolveDatabaseConfig,
  sanitizeDbErrorMessage,
  redactDatabaseUrl,
} = require("../db/connectionConfig");

function loadPg() {
  try {
    return require("pg");
  } catch (first) {
    try {
      return require(path.join(__dirname, "../node_modules/pg"));
    } catch {
      throw first;
    }
  }
}

function resolveInventoryEnv(env = process.env) {
  const preprodUrl = String(env.PREPROD_DATABASE_URL ?? "").trim();
  if (preprodUrl) {
    return {
      ...env,
      DATABASE_URL: preprodUrl,
      source: "PREPROD_DATABASE_URL",
    };
  }
  return {
    ...env,
    source: env.DATABASE_URL ? "DATABASE_URL" : "ABSENT",
  };
}

async function main() {
  assertNoWriteFlags(process.argv, process.env);

  const env = resolveInventoryEnv(process.env);
  if (!String(env.DATABASE_URL ?? "").trim()) {
    const pending = {
      generatedAt: new Date().toISOString(),
      target: { source: "ABSENT" },
      readOnly: true,
      autoMutation: false,
      code: "PENDING_LIVE_DB",
      diagnostic:
        "DATABASE_URL / PREPROD_DATABASE_URL absent. Inventaire non exécuté. Relancer contre la base qui échoue au boot.",
    };
    process.stdout.write(`${JSON.stringify(pending, null, 2)}\n`);
    console.error("inventory-school-course-ambiguity: SKIP (DATABASE_URL absent)");
    return;
  }

  const { Pool } = loadPg();
  const { poolConfig, connectionString } = resolveDatabaseConfig(env);
  const pool = new Pool(poolConfig);
  const client = await pool.connect();

  try {
    await client.query("BEGIN READ ONLY");
    const db = {
      one: async (sql, params = []) => {
        const result = await client.query(sql, params);
        return result.rows[0] ?? null;
      },
      all: async (sql, params = []) => {
        const result = await client.query(sql, params);
        return result.rows;
      },
    };

    const inventory = await inventorySchoolCourseAmbiguity(db);
    await client.query("ROLLBACK");

    const report = {
      generatedAt: new Date().toISOString(),
      target: {
        source: env.source,
        databaseUrlRedacted: redactDatabaseUrl(connectionString || env.DATABASE_URL),
      },
      code: inventory.code,
      blocksBoot: inventory.blocksBoot,
      readOnly: true,
      autoMutation: false,
      uniqueIndex: inventory.uniqueIndex,
      duplicateGroupCount: inventory.duplicateGroups.length,
      assignmentCollisionCount: inventory.assignmentCollisions.length,
      nonCanonicalAssignmentCount: inventory.nonCanonicalAssignments.length,
      duplicateGroups: inventory.duplicateGroups,
      duplicateRows: inventory.duplicateRows,
      assignmentCollisions: inventory.assignmentCollisions,
      nonCanonicalAssignments: inventory.nonCanonicalAssignments,
      proposal: inventory.proposal,
      diagnostic: inventory.diagnostic,
      note:
        inventory.uniqueIndex.present && inventory.duplicateGroups.length === 0
          ? `Index ${UNIQUE_INDEX_NAME} présent : COUNT(*)>1 actif est impossible. Chercher les collisions affectation vs autre enseignant.`
          : inventory.uniqueIndex.present
            ? `Index ${UNIQUE_INDEX_NAME} présent malgré des doublons signalés — vérifier le filtre status='active'.`
            : `Index ${UNIQUE_INDEX_NAME} absent : les doublons actifs peuvent exister.`,
    };

    const json = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(json);

    const proofOut = String(process.env.PROOF_OUT ?? "").trim();
    if (proofOut) {
      const resolved = path.resolve(proofOut);
      if (resolved.includes(`${path.sep}.git${path.sep}`) || resolved.startsWith(path.resolve("docs"))) {
        throw new Error("PROOF_OUT interdit dans le dépôt / docs.");
      }
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, json, "utf8");
      console.error(`[school-course-ambiguity] preuve écrite: ${resolved}`);
    }

    if (inventory.blocksBoot) {
      console.error(`[school-course-ambiguity] ${inventory.diagnostic}`);
      process.exitCode = 2;
    } else {
      console.error(`[school-course-ambiguity] ${inventory.diagnostic}`);
      process.exitCode = inventory.code === SCHOOL_COURSE_AMBIGUITY_OK ? 0 : 0;
    }
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    console.error("inventory-school-course-ambiguity: FAIL");
    console.error(sanitizeDbErrorMessage(error));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(sanitizeDbErrorMessage(error));
  process.exitCode = 1;
});
