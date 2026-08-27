"use strict";

/**
 * Inventaire read-only teacher ↔ user ↔ assignments.
 *
 *   PREPROD_DATABASE_URL=... node backend/scripts/audit-teacher-canonical-identity.js --name "KILOMBO SEKE"
 *   DATABASE_URL=... node backend/scripts/audit-teacher-canonical-identity.js --user-id <uuid>
 *
 * Mutation (uniquement REPAIRABLE_UNLINKED) :
 *   ... --apply --expected-assignments 4
 */

const { Pool } = require("pg");
const {
  resolveDatabaseConfig,
  redactDatabaseUrl,
} = require("../db/connectionConfig");
const {
  loadInventory,
  classifyInventory,
  applyCanonicalLink,
} = require("../lib/teacherCanonicalIdentityAudit");

function parseArgs(argv) {
  const options = {
    name: "KILOMBO SEKE",
    userId: "",
    schoolCode: "",
    expectedAssignments: 4,
    apply: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--name") options.name = String(argv[++i] ?? "");
    else if (arg === "--user-id") options.userId = String(argv[++i] ?? "");
    else if (arg === "--school-code") options.schoolCode = String(argv[++i] ?? "");
    else if (arg === "--expected-assignments") options.expectedAssignments = Number(argv[++i]);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  return options;
}

function resolveInventoryEnv(env = process.env) {
  const preprodUrl = String(env.PREPROD_DATABASE_URL ?? "").trim();
  if (preprodUrl) {
    return { ...env, DATABASE_URL: preprodUrl, source: "PREPROD_DATABASE_URL" };
  }
  return { ...env, source: env.DATABASE_URL ? "DATABASE_URL" : "DISCRETE" };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = resolveInventoryEnv(process.env);
  const { poolConfig, connectionString } = resolveDatabaseConfig(env);
  const ssl =
    /supabase\.com|amazonaws\.com/i.test(String(connectionString ?? env.DATABASE_URL ?? ""))
      ? { rejectUnauthorized: false }
      : undefined;
  const pool = new Pool({ ...poolConfig, ssl: ssl ?? poolConfig.ssl });
  const client = await pool.connect();
  const db = {
    one: async (sql, params = []) => (await client.query(sql, params)).rows[0] ?? null,
    all: async (sql, params = []) => (await client.query(sql, params)).rows,
  };

  try {
    await client.query("BEGIN READ ONLY");
    const inventory = await loadInventory(db, {
      name: options.name,
      userId: options.userId,
      schoolCode: options.schoolCode,
    });
    const classification = classifyInventory(inventory, {
      expectedAssignments: options.expectedAssignments,
    });
    await client.query("ROLLBACK");

    const report = {
      generatedAt: new Date().toISOString(),
      target: {
        source: env.source,
        databaseUrlRedacted: redactDatabaseUrl(connectionString || env.DATABASE_URL),
        name: options.name,
        userId: options.userId || null,
        schoolCode: options.schoolCode || null,
      },
      readOnly: !options.apply,
      autoMutation: false,
      inventory,
      classification: {
        verdict: classification.verdict,
        repairable: classification.repairable,
        reason: classification.reason,
        assignmentCount: classification.assignmentCount ?? null,
        userId: classification.user?.user_id ?? null,
        teacherId: classification.teacher?.teacher_id ?? null,
        teacherUserId: classification.teacher?.teacher_user_id ?? null,
      },
    };

    if (options.apply) {
      if (!classification.repairable) {
        report.apply = { ok: false, skipped: true, reason: classification.reason };
      } else {
        await client.query("BEGIN");
        try {
          const applied = await applyCanonicalLink(db, classification);
          await client.query("COMMIT");
          report.readOnly = false;
          report.apply = { ok: true, teacherId: applied.teacher_id, teacherUserId: applied.teacher_user_id };
        } catch (error) {
          await client.query("ROLLBACK");
          report.apply = { ok: false, code: error.code, reason: error.message };
        }
      }
    }

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (options.apply && report.apply && report.apply.ok === false && !report.apply.skipped) {
      process.exitCode = 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
