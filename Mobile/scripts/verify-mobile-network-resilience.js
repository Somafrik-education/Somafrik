/**
 * LOT 5 — réseau faible, anti-double POST, retry borné, outbox contrôlée.
 *
 * Usage : npm run verify:mobile-network-resilience
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");
const SRC = path.join(MOBILE, "src");
const BACKEND = path.join(ROOT, "backend");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd, env: process.env });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || result.error}`,
    );
  }
  process.stdout.write(result.stdout);
}

function main() {
  run("npx", ["--yes", "tsx", path.join("src", "lib", "networkResilience.test.ts")], MOBILE);
  run("npx", ["--yes", "tsx", path.join("src", "lib", "mutationGuard.test.ts")], MOBILE);
  run("npx", ["--yes", "tsx", path.join("src", "lib", "outbox.test.ts")], MOBILE);
  run("node", ["--test", path.join("lib", "idempotencyService.test.js")], BACKEND);
  run("node", ["--test", path.join("lib", "idempotency.pg.test.js")], BACKEND);

  const attendance = read(path.join(SRC, "screens", "TeacherAttendanceScreen.tsx"));
  assert.doesNotMatch(attendance, /refreshBackOfficeState/);
  assert.match(attendance, /loadPresences/);
  assert.match(attendance, /submitProtectedMutation/);
  assert.match(attendance, /idempotencyKey/);
  assert.match(attendance, /tryBegin/);
  console.log("OK: présences — pas de refreshBackOfficeState, outbox + clé + inFlight");

  const grades = read(path.join(SRC, "screens", "TeacherGradesScreen.tsx"));
  assert.doesNotMatch(grades, /refreshBackOfficeState/);
  assert.match(grades, /submitProtectedMutation/);
  assert.match(grades, /noteIntentionRef/);
  console.log("OK: notes — replay ciblé, pas de refresh global");

  const messages = read(path.join(SRC, "screens", "MessagesScreen.tsx"));
  assert.match(messages, /submitProtectedMutation/);
  assert.match(messages, /domain: "messages"/);
  console.log("OK: messages en outbox");

  const timetable = read(path.join(SRC, "screens", "TimetableScreen.tsx"));
  assert.doesNotMatch(timetable, /submitProtectedMutation/);
  assert.doesNotMatch(timetable, /enqueueOutbox/);
  assert.match(timetable, /idempotencyKey/);
  assert.match(timetable, /COURSE_SCHEDULE_CONFLICT|mapPlanningConflictMessage/);
  console.log("OK: planning hors outbox, retry manuel / 409 non auto-replay");

  const outbox = read(path.join(SRC, "lib", "outbox.ts"));
  assert.match(outbox, /OUTBOX_ALLOWED_DOMAINS/);
  assert.doesNotMatch(outbox, /course-schedules/);
  assert.match(outbox, /blocked_scope_mismatch/);
  assert.match(outbox, /blocked_logout/);
  assert.match(outbox, /OUTBOX_SECRET_FORBIDDEN/);
  assert.match(outbox, /accessToken\|refreshToken\|password\|pin\|secret/);
  console.log("OK: allowlist stricte + binding tenant/user + interdiction secrets");

  const resilience = read(path.join(SRC, "lib", "networkResilience.ts"));
  assert.match(resilience, /function classifyMutationFailure/);
  assert.match(resilience, /MAX_MUTATION_ATTEMPTS = 3/);
  assert.doesNotMatch(resilience, /Date\.now\(\)/);
  assert.match(resilience, /randomUUID/);
  console.log("OK: classification + retry borné + UUID");

  const httpClient = read(path.join(SRC, "services", "httpClient.ts"));
  assert.match(httpClient, /Idempotency-Key/);
  assert.match(httpClient, /idempotencyKey/);
  console.log("OK: httpClient centralise Idempotency-Key");

  const service = read(path.join(BACKEND, "services", "idempotencyService.js"));
  assert.match(service, /IDEMPOTENCY_KEY_REUSED/);
  assert.match(service, /requestHash/);
  assert.match(service, /schoolScope/);
  console.log("OK: backend réutilise idempotency_keys + hash + tenant");

  const schema = read(path.join(BACKEND, "db", "schema.sql"));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS idempotency_keys/);
  assert.match(schema, /request_hash/);
  assert.match(schema, /school_scope/);
  const tableCount = (schema.match(/CREATE TABLE IF NOT EXISTS idempotency_/g) || []).length;
  assert.equal(tableCount, 1, "un seul mécanisme idempotency_keys");
  console.log("OK: un seul schéma idempotency PostgreSQL");

  const pgRepo = read(path.join(BACKEND, "db", "postgresRepository.js"));
  assert.match(pgRepo, /withIdempotencyTransaction/);
  assert.match(pgRepo, /pg_advisory_xact_lock/);
  assert.match(pgRepo, /purgeExpiredIdempotencyRecords/);
  assert.match(pgRepo, /getIdempotencyTx/);
  assert.match(pgRepo, /current\?\.tx/);
  console.log("OK: transaction unique claim+mutation+idempotence + cleanup");

  const idempotency = read(path.join(BACKEND, "services", "idempotencyService.js"));
  assert.match(idempotency, /withIdempotencyTransaction/);
  assert.match(idempotency, /beforeStoreHook/);
  assert.match(idempotency, /logicalPayload/);
  console.log("OK: withIdempotency exécute store dans la même TX que le handler");

  const pgTest = read(path.join(BACKEND, "lib", "idempotency.pg.test.js"));
  assert.match(pgTest, /crash after payment insert, before idempotency store/);
  assert.match(pgTest, /rollback : aucun payment/);
  assert.match(pgTest, /1 payment/);
  assert.match(pgTest, /3 payment_items/);
  console.log("OK: test PG crash-before-store (rollback + retry 1 payment / 3 items / 1 réf)");

  const ci = read(path.join(ROOT, ".github", "workflows", "ci.yml"));
  const security = read(path.join(ROOT, ".github", "workflows", "security.yml"));
  assert.match(
    ci,
    /name: verify:mobile-network-resilience[\s\S]*DATABASE_URL: postgresql:\/\/somafrik:somafrik123@localhost:5432\/somafrik[\s\S]*npm run verify:mobile-network-resilience/,
  );
  assert.match(
    security,
    /name: verify:mobile-network-resilience[\s\S]*DATABASE_URL: postgresql:\/\/somafrik:somafrik123@localhost:5432\/somafrik[\s\S]*npm run verify:mobile-network-resilience/,
  );
  assert.match(security, /image: postgres:16/);
  if (process.env.CI) {
    assert.ok(String(process.env.DATABASE_URL || "").trim(), "DATABASE_URL requis en CI pour le test PG d'idempotence");
  }
  console.log("OK: CI + Security exécutent verify:mobile-network-resilience avec DATABASE_URL");

  const server = read(path.join(BACKEND, "server.js"));
  assert.match(server, /routeKey: "POST \/api\/backoffice\/messages"/);
  assert.match(server, /routeKey: "POST \/api\/course-schedules"/);
  assert.match(server, /routeKey: "POST \/api\/course-schedule-replacements"/);
  assert.match(server, /routeKey: "POST \/api\/payments"/);
  assert.match(server, /routeKey: "POST \/api\/presences"/);
  assert.match(server, /routeKey: "POST \/api\/notes"/);
  console.log("OK: mutations P0 wrappées withIdempotency");

  const auth = read(path.join(SRC, "context", "AuthContext.tsx"));
  assert.match(auth, /blockOutboxOnLogout/);
  console.log("OK: logout bloque l'outbox sans replay cross-compte");

  const banner = read(path.join(SRC, "components", "OfflineBanner.tsx"));
  assert.doesNotMatch(banner, /Vos données seront automatiquement synchronisées/);
  const spec = read(path.join(SRC, "lib", "offlineModeSpec.ts"));
  assert.doesNotMatch(spec, /Vos données seront automatiquement synchronisées/);
  assert.doesNotMatch(spec, /Les modifications reprendront dès le retour du réseau/);
  console.log("OK: banner sans fausse promesse de sync globale");

  const inventory = read(path.join(SRC, "lib", "mobileMutationInventory.ts"));
  assert.match(inventory, /savePresences/);
  assert.match(inventory, /createSchoolPayment/);
  console.log("OK: matrice mutations livrée");

  console.log("verify:mobile-network-resilience OK");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
