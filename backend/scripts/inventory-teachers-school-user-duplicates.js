"use strict";

/**
 * Inventaire strictement read-only des doublons teachers (school_id, user_id).
 *
 * Usage:
 *   DATABASE_URL=... node backend/scripts/inventory-teachers-school-user-duplicates.js
 *
 * - Transaction READ ONLY
 * - Aucune suppression / fusion / choix de canon
 * - Sortie : JSON (stdout) + résumé diagnostic (stderr)
 */

const { Pool } = require("pg");
const {
  inventoryTeachersSchoolUserDuplicates,
  TEACHERS_DOMAIN_CONSTRAINTS_CODE,
} = require("../lib/teachersUniqueness");
const { resolveDatabaseConfig, sanitizeDbErrorMessage } = require("../db/connectionConfig");

async function main() {
  const { poolConfig } = resolveDatabaseConfig(process.env);
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
    await client.query("ROLLBACK");

    const report = {
      code:
        inventory.duplicateGroups > 0 ? TEACHERS_DOMAIN_CONSTRAINTS_CODE : "TEACHERS_SCHOOL_USER_OK",
      duplicateGroups: inventory.duplicateGroups,
      sampleCount: inventory.groups.length,
      groups: inventory.groups.map((row) => ({
        school_code: row.school_code,
        user_id: row.user_id,
        duplicate_count: row.duplicate_count,
        teacher_codes: row.teacher_codes,
      })),
      diagnostic: inventory.diagnostic,
      readOnly: true,
      autoMutation: false,
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (inventory.duplicateGroups > 0) {
      console.error(`[teachers-domain] ${inventory.diagnostic}`);
      process.exitCode = 2;
    } else {
      console.error("[teachers-domain] aucun doublon (school_id, user_id)");
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
