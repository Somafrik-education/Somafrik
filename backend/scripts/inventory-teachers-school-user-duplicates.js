"use strict";

/**
 * Inventaire strictement read-only des doublons teachers (school_id, user_id).
 *
 * Usage:
 *   PREPROD_DATABASE_URL=... npm run inventory:teachers-school-user-duplicates
 *   DATABASE_URL=... node backend/scripts/inventory-teachers-school-user-duplicates.js
 *
 * Preuve ops (optionnel) :
 *   PROOF_OUT=/tmp/teachers-domain-inventory.json npm run inventory:teachers-school-user-duplicates
 *
 * - Transaction READ ONLY
 * - Aucune suppression / fusion / choix de canon
 * - Sortie : JSON (stdout) + résumé diagnostic (stderr)
 */

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const {
  inventoryTeachersSchoolUserDuplicates,
  TEACHERS_DOMAIN_CONSTRAINTS_CODE,
  TEACHERS_SCHOOL_USER_UNIQUE_INDEX,
  CHECK_TEACHERS_SCHOOL_USER_UNIQUE_INDEX_SQL,
} = require("../lib/teachersUniqueness");
const {
  resolveDatabaseConfig,
  sanitizeDbErrorMessage,
  redactDatabaseUrl,
} = require("../db/connectionConfig");

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
    source: env.DATABASE_URL ? "DATABASE_URL" : "DISCRETE",
  };
}

async function main() {
  const env = resolveInventoryEnv(process.env);
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

    const inventory = await inventoryTeachersSchoolUserDuplicates(db);
    const indexRow = await db.one(CHECK_TEACHERS_SCHOOL_USER_UNIQUE_INDEX_SQL, [
      TEACHERS_SCHOOL_USER_UNIQUE_INDEX,
    ]);
    const indexPresent = Boolean(indexRow?.present);
    await client.query("ROLLBACK");

    const diagnostic =
      inventory.duplicateGroups > 0
        ? inventory.diagnostic
        : `Teachers : 0 groupe(s) en doublon (school_id, user_id). Index ${TEACHERS_SCHOOL_USER_UNIQUE_INDEX}=${
            indexPresent ? "présent" : "absent"
          }. Aucune suppression automatique n'est effectuée.`;

    const report = {
      generatedAt: new Date().toISOString(),
      target: {
        source: env.source,
        databaseUrlRedacted: redactDatabaseUrl(connectionString || env.DATABASE_URL),
      },
      code:
        inventory.duplicateGroups > 0 ? TEACHERS_DOMAIN_CONSTRAINTS_CODE : "TEACHERS_SCHOOL_USER_OK",
      duplicateGroups: inventory.duplicateGroups,
      sampleCount: inventory.groups.length,
      index: {
        name: TEACHERS_SCHOOL_USER_UNIQUE_INDEX,
        present: indexPresent,
      },
      groups: inventory.groups.map((row) => ({
        school_code: row.school_code,
        user_id: row.user_id,
        duplicate_count: row.duplicate_count,
        teacher_codes: row.teacher_codes,
      })),
      diagnostic,
      readOnly: true,
      autoMutation: false,
      gate: {
        readyForApiBoot: inventory.duplicateGroups === 0 && indexPresent,
        note:
          inventory.duplicateGroups > 0
            ? "Maintenir Draft — correction données contrôlée requise (aucune suppression auto)."
            : indexPresent
              ? "duplicateGroups=0 et index présent — un déploiement diagnostique de la branche peut confirmer le boot."
              : "duplicateGroups=0 mais index absent — le boot de la branche doit créer/vérifier l'index.",
      },
    };

    const json = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(json);

    const proofOut = String(process.env.PROOF_OUT ?? "").trim();
    if (proofOut) {
      fs.mkdirSync(path.dirname(path.resolve(proofOut)), { recursive: true });
      fs.writeFileSync(path.resolve(proofOut), json, "utf8");
      console.error(`[teachers-domain] preuve écrite: ${path.resolve(proofOut)}`);
    }

    if (inventory.duplicateGroups > 0) {
      console.error(`[teachers-domain] ${inventory.diagnostic}`);
      process.exitCode = 2;
    } else {
      console.error(
        `[teachers-domain] aucun doublon (school_id, user_id) ; index ${TEACHERS_SCHOOL_USER_UNIQUE_INDEX}=${
          indexPresent ? "présent" : "absent"
        }`,
      );
    }
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    console.error("inventory-teachers-school-user-duplicates: FAIL");
    console.error(sanitizeDbErrorMessage(error));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
