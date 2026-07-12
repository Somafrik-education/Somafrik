const path = require("path");
const { execSync } = require("child_process");

try {
  require(path.join(__dirname, "..", "backend", "node_modules", "dotenv")).config({
    path: path.join(__dirname, "..", ".env"),
  });
} catch {
  // optional
}

function resolveScriptDatabaseUrl() {
  const { buildDatabaseUrl } = require(path.join(__dirname, "..", "backend", "db", "connectionConfig"));
  let databaseUrl = process.env.DATABASE_URL || buildDatabaseUrl();
  const hostPort = process.env.POSTGRES_HOST_PORT || "5433";
  if (!process.env.POSTGRES_PORT && !String(databaseUrl).includes(`:${hostPort}/`)) {
    databaseUrl = databaseUrl.replace(/:(\d+)\/([^/]+)$/, `:${hostPort}/$2`);
  }
  return databaseUrl;
}

function createPgPool() {
  const { Pool } = require(path.join(__dirname, "..", "backend", "node_modules", "pg"));
  return new Pool({ connectionString: resolveScriptDatabaseUrl() });
}

async function queryPostgres(sql, params = []) {
  const pool = createPgPool();
  try {
    return await pool.query(sql, params);
  } finally {
    await pool.end().catch(() => {});
  }
}

function queryPostgresViaDocker(sql) {
  const composeFile = path.join(__dirname, "..", "docker-compose.yml");
  const user = process.env.POSTGRES_USER ?? "somafrik";
  const database = process.env.POSTGRES_DB ?? "somafrik";
  const compactSql = String(sql).replace(/\s+/g, " ").trim();
  return execSync(
    `docker compose -f "${composeFile}" exec -T postgres psql -U ${user} -d ${database} -t -A -c "${compactSql}"`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

async function loadBackofficeStateFromPostgres() {
  try {
    const row = await queryPostgres(
      "SELECT state_payload, updated_at FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
    );
    return {
      state: row.rows[0]?.state_payload ?? {},
      updatedAt: row.rows[0]?.updated_at ?? null,
      source: "postgres",
    };
  } catch (error) {
    console.warn(`Connexion PostgreSQL locale indisponible (${error.code ?? error.message}) — repli Docker.`);
    const payload = queryPostgresViaDocker(
      "SELECT state_payload::text FROM backoffice_state WHERE state_key = 'default' LIMIT 1",
    );
    if (!payload) {
      throw new Error("backoffice_state introuvable via Docker.");
    }
    return {
      state: JSON.parse(payload),
      updatedAt: null,
      source: "docker-postgres",
    };
  }
}

async function loadUsersFromPostgres() {
  try {
    const result = await queryPostgres(
      "SELECT id, user_code, first_name, last_name, role FROM users ORDER BY created_at",
    );
    return result.rows;
  } catch {
    const output = queryPostgresViaDocker(
      `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text FROM (SELECT id::text, user_code, first_name, last_name, role FROM users ORDER BY created_at) t`,
    );
    return output ? JSON.parse(output) : [];
  }
}

module.exports = {
  resolveScriptDatabaseUrl,
  createPgPool,
  queryPostgres,
  queryPostgresViaDocker,
  loadBackofficeStateFromPostgres,
  loadUsersFromPostgres,
};
