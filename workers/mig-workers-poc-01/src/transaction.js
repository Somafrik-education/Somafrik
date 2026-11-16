import pg from "pg";
import { randomUUID } from "node:crypto";

const { Client } = pg;

const BLOCKED_HOST =
  /(^|\.)supabase\.(co|com)$|(^|\.)onrender\.com$|(^|\.)somafrik\.app$|(^|\.)pooler\.supabase\.com$/i;

export class PocDatabaseError extends Error {
  constructor(code) {
    super(code);
    this.name = "PocDatabaseError";
    this.code = code;
  }
}

export function assertPocConnectionString(connectionString, target = "local") {
  let url;
  try {
    url = new URL(String(connectionString ?? ""));
  } catch {
    throw new PocDatabaseError("POC_DATABASE_URL_INVALID");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new PocDatabaseError("POC_DATABASE_URL_INVALID");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (target === "supabase-preprod-hyperdrive") {
    // Les credentials et la base viennent du binding Hyperdrive épinglé par ID
    // dans wrangler.hyperdrive-preprod.jsonc. Aucun DATABASE_URL externe accepté.
    // Hyperdrive émet une URI de proxy dont le username peut différer
    // du rôle PostgreSQL réel. Contrôler l'identité APRES connexion,
    // avant toute écriture, plutôt que de comparer le username du proxy.
    // L'appelant utilise uniquement env.HYPERDRIVE.connectionString.
    if (!url.hostname || !url.username || !database) {
      throw new PocDatabaseError("POC_DATABASE_TARGET_REFUSED");
    }
  } else if (target === "local") {
    if (BLOCKED_HOST.test(url.hostname)) {
      throw new PocDatabaseError("POC_DATABASE_HOST_REFUSED");
    }
    if (!database.includes("workers_poc")) {
      throw new PocDatabaseError("POC_DATABASE_NAME_REFUSED");
    }
  } else {
    throw new PocDatabaseError("POC_DATABASE_TARGET_REFUSED");
  }
  return database;
}

async function withClient(connectionString, fn, target = "local") {
  assertPocConnectionString(connectionString, target);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    if (target === "supabase-preprod-hyperdrive") {
      // Aucune table publique ne doit être créée/modifiée par ce POC.
      await client.query("SET search_path TO somafrik_workers_poc");
      const identity = await client.query("SELECT current_user AS username, current_schema() AS schema, current_database() AS db");
      if (identity.rows[0]?.username !== "somafrik_hyperdrive_poc" ||
          identity.rows[0]?.schema !== "somafrik_workers_poc" ||
          identity.rows[0]?.db !== "postgres") {
        throw new PocDatabaseError("POC_DATABASE_TARGET_REFUSED");
      }
    }
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensurePocTables(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS poc_ledger (
    id text PRIMARY KEY,
    note text NOT NULL
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS poc_outbox (
    id text PRIMARY KEY,
    status text NOT NULL
  )`);
}

export async function runPocTransaction(connectionString, target = "local") {
  return withClient(connectionString, async (client) => {
    await ensurePocTables(client);
    const id = randomUUID();
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO poc_ledger (id, note) VALUES ($1, $2)", [
        id,
        "mig-workers-poc-01",
      ]);
      const inserted = await client.query("SELECT note FROM poc_ledger WHERE id = $1", [id]);
      if (inserted.rows[0]?.note !== "mig-workers-poc-01") {
        throw new PocDatabaseError("POC_TRANSACTION_READ_FAILED");
      }
      await client.query("ROLLBACK");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // La transaction est déjà close.
      }
      throw error;
    }
    const after = await client.query("SELECT id FROM poc_ledger WHERE id = $1", [id]);
    if (after.rowCount !== 0) {
      throw new PocDatabaseError("POC_TRANSACTION_ROLLBACK_FAILED");
    }
    return { rolledBack: true };
  }, target);
}

export async function insertQueuedOutbox(connectionString, id) {
  return withClient(connectionString, async (client) => {
    await ensurePocTables(client);
    await client.query("BEGIN");
    try {
      await client.query(
        "INSERT INTO poc_outbox (id, status) VALUES ($1, 'queued')",
        [id],
      );
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Déjà annulée.
      }
      throw error;
    }
    return { id, status: "queued" };
  });
}

export async function markOutboxProcessed(connectionString, id) {
  return withClient(connectionString, async (client) => {
    await ensurePocTables(client);
    await client.query("BEGIN");
    try {
      const updated = await client.query(
        "UPDATE poc_outbox SET status = 'processed' WHERE id = $1 AND status = 'queued'",
        [id],
      );
      await client.query("COMMIT");
      return { updated: updated.rowCount === 1 };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Déjà annulée.
      }
      throw error;
    }
  });
}

export async function readOutbox(connectionString, id) {
  return withClient(connectionString, async (client) => {
    await ensurePocTables(client);
    const found = await client.query("SELECT status FROM poc_outbox WHERE id = $1", [id]);
    if (found.rowCount === 0) return null;
    return { id, status: found.rows[0].status };
  });
}
