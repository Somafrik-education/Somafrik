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

export function assertPocConnectionString(connectionString) {
  let url;
  try {
    url = new URL(String(connectionString ?? ""));
  } catch {
    throw new PocDatabaseError("POC_DATABASE_URL_INVALID");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new PocDatabaseError("POC_DATABASE_URL_INVALID");
  }
  if (BLOCKED_HOST.test(url.hostname)) {
    throw new PocDatabaseError("POC_DATABASE_HOST_REFUSED");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database.includes("workers_poc")) {
    throw new PocDatabaseError("POC_DATABASE_NAME_REFUSED");
  }
  return database;
}

async function withClient(connectionString, fn) {
  assertPocConnectionString(connectionString);
  const client = new Client({ connectionString });
  await client.connect();
  try {
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

export async function runPocTransaction(connectionString) {
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
  });
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
