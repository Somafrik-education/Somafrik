"use strict";

/**
 * MONO-T0 — tests négatifs des garde-fous de la baseline des tests backend.
 *
 * 1. Garde-fous purs (aucune base requise) : URL, noms de bases, cluster, env.
 * 2. Exécuteur en ligne de commande : configurations dangereuses refusées
 *    AVANT toute connexion (code de sortie 1, message explicite).
 * 3. Couverture : demandée mais absente ⇒ échec (jamais SUCCESS).
 * 4. Cluster réel (si SOMAFRIK_TEST_PG_URL est fourni, comme dans le job CI pg) :
 *    un cluster contenant une base étrangère ou une sentinelle sans commentaire
 *    est refusé ; preuves négatives : une base étrangère (même nommée *_test,
 *    *_it, somafrik_test_run_* ou nfc_encoding_test) n'est jamais supprimée ni
 *    modifiée ; seule une base créée ET marquée par l'exécution courante est
 *    supprimable, y compris sur les chemins d'erreur et d'interruption.
 *
 *   node --test scripts/backend-test-baseline.test.js
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const guards = require("./backend-test-baseline-guards");

const ROOT = path.resolve(__dirname, "..");
const RUNNER = path.join(__dirname, "backend-test-baseline.js");
const SENTINEL_URL = `postgres://postgres:postgres@127.0.0.1:5432/${guards.SENTINEL_DATABASE}`;
const CLUSTER_URL = process.env[guards.TEST_PG_URL_VAR];

function refusedWith(pattern) {
  return (error) => {
    assert.ok(error instanceof guards.BaselineGuardError, `BaselineGuardError attendue, reçu ${error}`);
    assert.match(error.message, pattern);
    return true;
  };
}

function runRunner(args, env) {
  const base = { PATH: process.env.PATH, HOME: process.env.HOME };
  return spawnSync(process.execPath, [RUNNER, ...args], {
    cwd: ROOT,
    env: { ...base, SOMAFRIK_TEST_BASELINE_OUT: fs.mkdtempSync(path.join(os.tmpdir(), "mono-t0-")), ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
}

// ---------------------------------------------------------------------------
// 1. Garde-fous purs
// ---------------------------------------------------------------------------

test("URL : variable absente ou vide refusée (DATABASE_URL n'est jamais un repli)", () => {
  for (const value of [undefined, "", "   "]) {
    assert.throws(() => guards.parseTestClusterUrl(value), refusedWith(/SOMAFRIK_TEST_PG_URL est obligatoire/));
  }
});

test("URL : hôte non loopback refusé, y compris les leurres", () => {
  for (const host of [
    "db.example.com",
    "localhost.evil.example",
    "127.0.0.1.nip.io",
    "10.0.0.5",
    "192.168.1.10",
    "0.0.0.0",
    "[::ffff:10.0.0.5]",
    "[2001:db8::1]",
  ]) {
    assert.throws(
      () => guards.parseTestClusterUrl(`postgres://u:p@${host}:5432/${guards.SENTINEL_DATABASE}`),
      refusedWith(/hôte loopback/),
      host,
    );
  }
});

test("URL : paramètres de connexion refusés (host/hostaddr/options peuvent rediriger)", () => {
  for (const query of ["host=/var/run/postgresql", "hostaddr=10.0.0.5", "options=-csearch_path%3Dpublic", "sslmode=disable"]) {
    assert.throws(
      () => guards.parseTestClusterUrl(`${SENTINEL_URL}?${query}`),
      refusedWith(/aucun paramètre/),
      query,
    );
  }
});

test("URL : seule la base sentinelle est acceptée (pas postgres, somafrik, base vide…)", () => {
  for (const database of ["postgres", "somafrik", "somafrik_dev", "somafrik_test_ci", ""]) {
    assert.throws(
      () => guards.parseTestClusterUrl(`postgres://u:p@localhost:5432/${database}`),
      refusedWith(/base sentinelle/),
      database || "(vide)",
    );
  }
  assert.throws(() => guards.parseTestClusterUrl("mysql://u:p@localhost/x"), refusedWith(/protocole/));
  assert.throws(() => guards.parseTestClusterUrl("pas une url"), refusedWith(/URL valide/));
});

test("URL : configuration conforme acceptée (localhost, 127.0.0.1, ::1)", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const url = guards.parseTestClusterUrl(`postgresql://postgres:postgres@${host}:5432/${guards.SENTINEL_DATABASE}`);
    assert.equal(url.pathname, `/${guards.SENTINEL_DATABASE}`);
  }
});

test("Cluster : sentinelle sans commentaire, mauvaise base courante ou base étrangère refusés", () => {
  const ok = {
    currentDatabase: guards.SENTINEL_DATABASE,
    sentinelComment: guards.SENTINEL_COMMENT,
    databases: ["postgres", "template0", "template1", guards.SENTINEL_DATABASE],
  };
  guards.assertDedicatedTestCluster(ok);

  assert.throws(() => guards.assertDedicatedTestCluster({ ...ok, sentinelComment: null }), refusedWith(/pas déclaré jetable/));
  assert.throws(() => guards.assertDedicatedTestCluster({ ...ok, sentinelComment: "autre" }), refusedWith(/pas déclaré jetable/));
  assert.throws(() => guards.assertDedicatedTestCluster({ ...ok, currentDatabase: "somafrik" }), refusedWith(/Connexion inattendue/));
  for (const foreign of ["somafrik", "somafrik_dev", "somafrik_preprod_202610261234", "app", "production"]) {
    assert.throws(
      () => guards.assertDedicatedTestCluster({ ...ok, databases: [...ok.databases, foreign] }),
      refusedWith(new RegExp(`pas des bases de test \\(${foreign}\\)`)),
      foreign,
    );
  }
});

test("Cluster : les bases créées par les tests du dépôt sont reconnues", () => {
  for (const name of [
    "somafrik_test_run_main_123_abcd1234",
    "somafrik_users_gp003_it",
    "somafrik_report_card_lot9_it",
    "somafrik_report_card_lot9_it_scope_mismatch",
    "somafrik_report_card_publication_it_xver",
    "nfc_encoding_test",
    "nfc_prog_02_test",
    `nfc_prog_05_${"a".repeat(32)}`,
    "somafrik_sec_auth_04_0123456789ab",
    "somafrik_tt_0123456789ab",
  ]) {
    assert.equal(guards.isTestDatabaseName(name), true, name);
  }
  for (const name of ["somafrik", "somafrik_dev", "somafrik_tt", "nfc_prog_05_short", "somafrik_preprod_202610261234"]) {
    assert.equal(guards.isTestDatabaseName(name), false, name);
  }
});

test("Bases gérées : seuls somafrik_test_run_* et nfc_encoding_test peuvent être créés ou supprimés", () => {
  assert.equal(guards.runDatabaseName("main", "42_ab"), "somafrik_test_run_main_42_ab");
  assert.equal(guards.assertRunDatabaseName("nfc_encoding_test"), "nfc_encoding_test");
  for (const name of [
    "somafrik",
    "postgres",
    "template1",
    guards.SENTINEL_DATABASE,
    "nfc_prog_02_test",
    "somafrik_users_gp003_it",
    "somafrik_test_run_",
    "somafrik_test_run_x; DROP DATABASE somafrik",
  ]) {
    assert.throws(() => guards.assertRunDatabaseName(name), refusedWith(/Nom de base de travail refusé/), name);
  }
});

test("Marqueur de propriété : identifiant d'exécution strict (pas d'injection SQL dans le commentaire)", () => {
  assert.equal(guards.ownershipMarker("1234_0123456789ab"), "somafrik:test-run:1234_0123456789ab");
  for (const runId of ["", "abc", "1234_XYZ", "1_0123456789ab'; DROP DATABASE somafrik; --", "1_0123456789abc"]) {
    assert.throws(() => guards.ownershipMarker(runId), refusedWith(/Identifiant d'exécution invalide/), runId);
  }
});

test("Environnement : toute variable de base héritée est retirée avant les tests", () => {
  const { env, removed } = guards.sanitizeDatabaseEnv({
    PATH: "/usr/bin",
    NODE_ENV: "test",
    JWT_SECRET: "y",
    DATABASE_URL: "postgres://dev@localhost/somafrik",
    SUPABASE_DB_URL: "postgres://prod",
    SOMAFRIK_NFC_TEST_DATABASE_URL: "postgres://dev@localhost/nfc_encoding_test",
    SOMAFRIK_USERS_GP003_IT_DATABASE: "somafrik",
    PGHOST: "db.example.com",
    PGDATABASE: "somafrik",
    PGPASSWORD: "x",
    DB_HOST: "db.example.com",
    DB_NAME: "somafrik",
    SOMAFRIK_TEST_PG_URL: SENTINEL_URL,
  });
  assert.deepEqual(Object.keys(env).sort(), ["JWT_SECRET", "NODE_ENV", "PATH"]);
  assert.deepEqual(removed, [
    "DATABASE_URL",
    "DB_HOST",
    "DB_NAME",
    "PGDATABASE",
    "PGHOST",
    "PGPASSWORD",
    "SOMAFRIK_NFC_TEST_DATABASE_URL",
    "SOMAFRIK_TEST_PG_URL",
    "SOMAFRIK_USERS_GP003_IT_DATABASE",
    "SUPABASE_DB_URL",
  ]);
});

// ---------------------------------------------------------------------------
// 2. Exécuteur : refus avant toute connexion
// ---------------------------------------------------------------------------

test("Exécuteur pg : DATABASE_URL seule (base de développement) est refusée", () => {
  const result = runRunner(["pg"], { DATABASE_URL: "postgres://postgres:postgres@localhost:5432/somafrik" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SOMAFRIK_TEST_PG_URL est obligatoire/);
});

test("Exécuteur pg : hôte distant, paramètre host ou base non sentinelle refusés", () => {
  const cases = [
    [`postgres://u:p@db.example.com:5432/${guards.SENTINEL_DATABASE}`, /hôte loopback/],
    [`${SENTINEL_URL}?host=db.example.com`, /aucun paramètre/],
    ["postgres://u:p@localhost:5432/somafrik", /base sentinelle/],
    ["postgres://u:p@localhost:5432/postgres", /base sentinelle/],
  ];
  for (const [url, pattern] of cases) {
    const result = runRunner(["pg"], { SOMAFRIK_TEST_PG_URL: url });
    assert.equal(result.status, 1, url);
    assert.match(result.stderr, pattern, url);
  }
});

test("Exécuteur pg : cluster injoignable = échec (jamais de repli)", () => {
  const result = runRunner(["pg"], {
    SOMAFRIK_TEST_PG_URL: `postgres://postgres:postgres@127.0.0.1:1/${guards.SENTINEL_DATABASE}`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cluster de test injoignable/);
});

// ---------------------------------------------------------------------------
// 3. Couverture
// ---------------------------------------------------------------------------

test("Couverture : rapport absent, vide ou sans ligne = non produite", () => {
  const { lcovTotals } = require("./backend-test-baseline");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mono-t0-lcov-"));
  const empty = path.join(dir, "empty.info");
  const noLines = path.join(dir, "nolines.info");
  const valid = path.join(dir, "valid.info");
  fs.writeFileSync(empty, "");
  fs.writeFileSync(noLines, "SF:backend/a.js\nLF:0\nLH:0\nend_of_record\n");
  fs.writeFileSync(valid, "SF:backend/a.js\nLF:10\nLH:5\nBRF:4\nBRH:1\nend_of_record\n");
  assert.equal(lcovTotals(path.join(dir, "absent.info")), null);
  assert.equal(lcovTotals(null), null);
  assert.equal(lcovTotals(empty), null);
  assert.equal(lcovTotals(noLines), null);
  assert.deepEqual(lcovTotals(valid), { files: 1, lines: "50.0 %", branches: "25.0 %" });
});

// ---------------------------------------------------------------------------
// 4. Cluster réel (job CI pg, ou local avec SOMAFRIK_TEST_PG_URL)
// ---------------------------------------------------------------------------

const realCluster = { skip: CLUSTER_URL ? false : "SOMAFRIK_TEST_PG_URL absent : contrôles sur cluster réel non exécutés" };

function pgClient(url) {
  const { Client } = require(require.resolve("pg", { paths: [path.join(ROOT, "backend")] }));
  return new Client({ connectionString: url });
}

async function onCluster(fn) {
  const client = pgClient(CLUSTER_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

test("Cluster réel : conforme, puis refusé dès qu'une base étrangère existe", realCluster, async () => {
  const { verifyTestCluster } = require("./backend-test-baseline");
  const clusterUrl = guards.parseTestClusterUrl(CLUSTER_URL);
  const verified = await verifyTestCluster(clusterUrl);
  assert.match(String(verified.serverVersion), /^\d+/);

  await onCluster((client) => client.query("DROP DATABASE IF EXISTS somafrik_dev_like"));
  await onCluster((client) => client.query("CREATE DATABASE somafrik_dev_like"));
  try {
    await assert.rejects(() => verifyTestCluster(clusterUrl), refusedWith(/somafrik_dev_like/));
  } finally {
    await onCluster((client) => client.query("DROP DATABASE IF EXISTS somafrik_dev_like"));
  }
  await verifyTestCluster(clusterUrl);
});

test("Cluster réel : sentinelle sans commentaire refusée", realCluster, async () => {
  const { verifyTestCluster } = require("./backend-test-baseline");
  const clusterUrl = guards.parseTestClusterUrl(CLUSTER_URL);
  const database = guards.SENTINEL_DATABASE;
  await onCluster((client) => client.query(`COMMENT ON DATABASE ${database} IS NULL`));
  try {
    await assert.rejects(() => verifyTestCluster(clusterUrl), refusedWith(/pas déclaré jetable/));
  } finally {
    await onCluster((client) => client.query(`COMMENT ON DATABASE ${database} IS '${guards.SENTINEL_COMMENT}'`));
  }
  await verifyTestCluster(clusterUrl);
});

// Bases « étrangères » : créées hors de l'exécuteur, nommées comme des bases de
// test, et contenant une donnée témoin qui doit survivre à toute tentative.
const FOREIGN_DATABASES = [
  "nfc_encoding_test", //            nom géré par l'exécuteur, mais pas créé par lui
  "somafrik_test_run_foreign_probe", // motif des bases de travail, mais pas créé par lui
  "somafrik_foreign_probe_it", //    motif *_it des tests du dépôt
  "foreign_probe_test", //           motif *_test
];

async function databaseUrlFor(name) {
  return guards.databaseUrl(guards.parseTestClusterUrl(CLUSTER_URL), name);
}

async function createForeignDatabaseWithWitness(name, comment = null) {
  await onCluster(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
    if (comment) await client.query(`COMMENT ON DATABASE ${name} IS '${comment}'`);
  });
  const client = pgClient(await databaseUrlFor(name));
  await client.connect();
  try {
    await client.query("CREATE TABLE mono_t0_witness (value text NOT NULL)");
    await client.query("INSERT INTO mono_t0_witness VALUES ('donnée étrangère')");
  } finally {
    await client.end();
  }
}

async function readWitness(name) {
  const exists = await onCluster((client) => client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]));
  if (!exists.rowCount) return { exists: false, rows: [] };
  const client = pgClient(await databaseUrlFor(name));
  await client.connect();
  try {
    const result = await client.query("SELECT value FROM mono_t0_witness");
    return { exists: true, rows: result.rows.map((row) => row.value) };
  } finally {
    await client.end();
  }
}

async function dropForeignDatabase(name) {
  await onCluster((client) => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
}

test("Preuve négative : bases étrangères *_test / *_it / gérées jamais supprimées ni modifiées par l'exécuteur", realCluster, async () => {
  const runner = require("./backend-test-baseline");
  const clusterUrl = guards.parseTestClusterUrl(CLUSTER_URL);
  for (const name of FOREIGN_DATABASES) await createForeignDatabaseWithWitness(name);
  try {
    for (const name of FOREIGN_DATABASES) {
      // Suppression : refusée (nom hors liste fermée, ou base non créée par cette exécution).
      await assert.rejects(() => runner.dropOwnedDatabase(clusterUrl, name), refusedWith(/(refusé)/), name);
      // Création par-dessus : refusée sans suppression préalable (noms gérés uniquement).
      if (name === "nfc_encoding_test" || name.startsWith(guards.RUN_DATABASE_PREFIX)) {
        await assert.rejects(() => runner.createOwnedDatabase(clusterUrl, name), refusedWith(/existe déjà/), name);
      } else {
        await assert.rejects(() => runner.createOwnedDatabase(clusterUrl, name), refusedWith(/Nom de base de travail refusé/), name);
      }
      assert.deepEqual(await readWitness(name), { exists: true, rows: ["donnée étrangère"] }, `${name} intacte`);
    }
    // Nettoyage global de l'exécuteur : ne touche à aucune base étrangère.
    assert.deepEqual(await runner.dropAllOwnedDatabases(clusterUrl), []);
    for (const name of FOREIGN_DATABASES) {
      assert.deepEqual(await readWitness(name), { exists: true, rows: ["donnée étrangère"] }, `${name} intacte après nettoyage`);
    }
  } finally {
    for (const name of FOREIGN_DATABASES) await dropForeignDatabase(name);
  }
});

test("Preuve négative : une base portant le marqueur d'une AUTRE exécution n'est pas supprimée", realCluster, async () => {
  const runner = require("./backend-test-baseline");
  const clusterUrl = guards.parseTestClusterUrl(CLUSTER_URL);
  const name = "somafrik_test_run_other_run_probe";
  await createForeignDatabaseWithWitness(name, guards.ownershipMarker("1_aaaaaaaaaaaa"));
  try {
    await assert.rejects(() => runner.dropOwnedDatabase(clusterUrl, name), refusedWith(/n'a pas été créée par cette exécution/));
    assert.deepEqual(await readWitness(name), { exists: true, rows: ["donnée étrangère"] });
  } finally {
    await dropForeignDatabase(name);
  }
});

test("Exécution courante : seule une base créée ET marquée par elle est supprimable (succès, erreur, marqueur altéré)", realCluster, async () => {
  const runner = require("./backend-test-baseline");
  const clusterUrl = guards.parseTestClusterUrl(CLUSTER_URL);
  const marker = guards.ownershipMarker(runner.RUN_ID);
  const exists = async (name) =>
    (await onCluster((client) => client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]))).rowCount === 1;

  // Chemin nominal : créée avec le marqueur de l'exécution, supprimée à la sortie.
  const nominal = guards.runDatabaseName("proof_ok", runner.RUN_ID);
  await runner.withOwnedDatabase(clusterUrl, nominal, async () => {
    const comment = await onCluster((client) =>
      client.query("SELECT shobj_description(oid, 'pg_database') AS c FROM pg_database WHERE datname = $1", [nominal]),
    );
    assert.equal(comment.rows[0].c, marker);
  });
  assert.equal(await exists(nominal), false, "supprimée après succès");

  // Chemin d'erreur : l'erreur remonte et la base est quand même supprimée.
  const failing = guards.runDatabaseName("proof_err", runner.RUN_ID);
  await assert.rejects(
    () => runner.withOwnedDatabase(clusterUrl, failing, async () => {
      throw new Error("échec simulé pendant les tests");
    }),
    /échec simulé/,
  );
  assert.equal(await exists(failing), false, "supprimée après erreur");

  // Marqueur altéré par un tiers : suppression refusée, base conservée.
  const tampered = guards.runDatabaseName("proof_tamper", runner.RUN_ID);
  await runner.createOwnedDatabase(clusterUrl, tampered);
  try {
    await onCluster((client) => client.query(`COMMENT ON DATABASE ${tampered} IS 'autre propriétaire'`));
    await assert.rejects(() => runner.dropOwnedDatabase(clusterUrl, tampered), refusedWith(/ne porte plus le marqueur/));
    assert.equal(await exists(tampered), true, "base au marqueur altéré conservée");
  } finally {
    await dropForeignDatabase(tampered);
  }
  // Base déjà supprimée par un tiers : nettoyage idempotent, sans erreur.
  assert.deepEqual(await runner.dropAllOwnedDatabases(clusterUrl), []);
});

test("Exécuteur pg : une nfc_encoding_test étrangère pré-existante bloque l'exécution sans être touchée", realCluster, async () => {
  await createForeignDatabaseWithWitness("nfc_encoding_test");
  try {
    const result = runRunner(["pg"], { SOMAFRIK_TEST_PG_URL: CLUSTER_URL });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /« nfc_encoding_test » existe déjà/);
    assert.deepEqual(await readWitness("nfc_encoding_test"), { exists: true, rows: ["donnée étrangère"] });
  } finally {
    await dropForeignDatabase("nfc_encoding_test");
  }
});

test("Exécuteur pg : interruption (SIGTERM du groupe, comme une annulation CI) ⇒ bases de l'exécution supprimées", realCluster, async () => {
  const { spawn } = require("node:child_process");
  const exists = async () =>
    (await onCluster((client) => client.query("SELECT 1 FROM pg_database WHERE datname = 'nfc_encoding_test'"))).rowCount === 1;
  assert.equal(await exists(), false, "précondition : aucune nfc_encoding_test");
  const child = spawn(process.execPath, [RUNNER, "pg"], {
    cwd: ROOT,
    detached: true,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SOMAFRIK_TEST_PG_URL: CLUSTER_URL,
      SOMAFRIK_TEST_BASELINE_OUT: fs.mkdtempSync(path.join(os.tmpdir(), "mono-t0-sig-")),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 60_000;
  while (!(await exists())) {
    assert.ok(Date.now() < deadline, `nfc_encoding_test jamais créée : ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  process.kill(-child.pid, "SIGTERM");
  const { code } = await exited;
  assert.notEqual(code, 0, "une exécution interrompue n'est jamais verte");
  assert.equal(await exists(), false, `nfc_encoding_test supprimée après interruption : ${stderr}`);
  const leftovers = await onCluster((client) =>
    client.query("SELECT datname FROM pg_database WHERE datname LIKE 'somafrik_test_run_%'"),
  );
  assert.deepEqual(leftovers.rows, [], "aucune base de travail restante");
});
