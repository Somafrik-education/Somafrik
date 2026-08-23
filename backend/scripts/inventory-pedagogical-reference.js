"use strict";

/**
 * PR-0 — Inventaire live SELECT-only des référentiels pédagogiques.
 *
 *   DATABASE_URL=... npm run inventory:pedagogical-reference
 *   PREPROD_DATABASE_URL=... npm run inventory:pedagogical-reference
 *
 * stdout = rapport SANITISÉ (sans school_code / school_name / class_code).
 * Dump brut ops uniquement hors dépôt :
 *   INVENTORY_RAW=1 PROOF_OUT=/tmp/pedagogical-inventory.json npm run inventory:pedagogical-reference
 *
 * Interdit : docs/audits/evidence/ et tout chemin dans le repo Git.
 *
 * Transaction BEGIN READ ONLY.
 * Refuse --apply / --write / --fix / --migrate / SOMAFRIK_PEDAGOGICAL_BACKFILL.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  inventoryPedagogicalReference,
  formatMarkdownReport,
  sanitizeInventoryForPublication,
  assertNoWriteFlags,
  assertProofPathAllowed,
} = require("../lib/pedagogicalReferenceInventory");
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
      readOnly: true,
      autoMutation: false,
      classificationVerdict: "PENDING_LIVE_DB",
      diagnostic:
        "DATABASE_URL / PREPROD_DATABASE_URL absent. Inventaire non exécuté. Relancer contre la base live.",
    };
    process.stdout.write(`${JSON.stringify(pending, null, 2)}\n`);
    console.error("inventory-pedagogical-reference: SKIP (DATABASE_URL absent)");
    return;
  }

  const { Pool } = loadPg();
  const { poolConfig, connectionString } = resolveDatabaseConfig(env);
  const pool = new Pool(poolConfig);
  const client = await pool.connect();
  const generatedAt = new Date().toISOString();
  const databaseUrlRedacted = redactDatabaseUrl(connectionString || env.DATABASE_URL);

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

    const inventory = await inventoryPedagogicalReference(db);
    await client.query("ROLLBACK");

    const report = {
      generatedAt,
      target: {
        source: env.source,
        databaseUrlRedacted,
      },
      ...inventory,
    };
    const published = sanitizeInventoryForPublication(report);
    const wantRaw = String(process.env.INVENTORY_RAW ?? "").trim() === "1";
    const payload = wantRaw ? report : published;
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    const markdown = formatMarkdownReport(published, { generatedAt, databaseUrlRedacted });

    const jsonOut = String(process.env.PROOF_OUT ?? "").trim();
    const mdOut = String(process.env.PROOF_MD ?? "").trim();
    const repoRoot = path.resolve(__dirname, "../..");
    if (jsonOut) {
      const resolved = path.resolve(jsonOut);
      assertProofPathAllowed(resolved, repoRoot);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, json, "utf8");
      console.error(`[pedagogical-inventory] JSON (${wantRaw ? "brut ops" : "sanitisé"}): ${resolved}`);
    }
    if (mdOut) {
      const resolved = path.resolve(mdOut);
      assertProofPathAllowed(resolved, repoRoot);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, markdown, "utf8");
      console.error(`[pedagogical-inventory] Markdown sanitisé: ${resolved}`);
    }

    if (String(process.env.INVENTORY_FORMAT ?? "").toLowerCase() === "json") {
      process.stdout.write(`${JSON.stringify(published, null, 2)}\n`);
    } else {
      process.stdout.write(`${markdown}\n`);
      process.stdout.write(`${JSON.stringify(published, null, 2)}\n`);
    }

    console.error(`[pedagogical-inventory] ${inventory.diagnostic}`);
    if (inventory.classificationVerdict === "STOP") {
      console.error("[pedagogical-inventory] STOP — aucune classification silencieuse.");
    }
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    if (
      error?.code === "PEDAGOGICAL_INVENTORY_WRITE_REFUSED" ||
      error?.code === "PEDAGOGICAL_INVENTORY_PROOF_PATH_REFUSED"
    ) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error("inventory-pedagogical-reference: FAIL");
    console.error(sanitizeDbErrorMessage(error));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  if (
    error?.code === "PEDAGOGICAL_INVENTORY_WRITE_REFUSED" ||
    error?.code === "PEDAGOGICAL_INVENTORY_PROOF_PATH_REFUSED"
  ) {
    console.error(error.message);
  } else {
    console.error(sanitizeDbErrorMessage(error));
  }
  process.exitCode = 1;
});
