"use strict";

/**
 * MONO-T0 — garde-fous PostgreSQL de la baseline des tests backend.
 *
 * Un hôte local n'est pas une preuve suffisante qu'une base est jetable : un
 * développeur peut avoir sa base de travail sur localhost. La baseline exige
 * donc un CLUSTER explicitement dédié aux tests :
 *
 *   1. une URL dédiée (SOMAFRIK_TEST_PG_URL), jamais DATABASE_URL ;
 *   2. un hôte loopback, sans paramètre de connexion qui pourrait le contourner ;
 *   3. une base sentinelle `somafrik_disposable_test_cluster` portant le
 *      commentaire `somafrik:disposable-test-cluster` (posé volontairement à la
 *      création du cluster de test, jamais par l'exécuteur) ;
 *   4. toutes les bases du cluster portent un nom de base de test reconnu :
 *      un cluster qui contient une base de développement (ex. `somafrik`)
 *      ou toute base inconnue est refusé ;
 *   5. les variables de base héritées (DATABASE_URL, PG*, DB_*, *_IT_DATABASE…)
 *      sont retirées de l'environnement des tests ; l'exécuteur fixe lui-même
 *      DATABASE_URL vers la base de maintenance `postgres` du cluster VÉRIFIÉ
 *      (les tests du dépôt n'acceptent que `postgres` comme base source) ;
 *   6. l'exécuteur ne crée ni ne supprime que ses bases gérées :
 *      `somafrik_test_run_*` et `nfc_encoding_test`.
 *
 * Ce module est pur (aucune connexion) : il est couvert par
 * scripts/backend-test-baseline.test.js.
 */

const TEST_PG_URL_VAR = "SOMAFRIK_TEST_PG_URL";
const SENTINEL_DATABASE = "somafrik_disposable_test_cluster";
const SENTINEL_COMMENT = "somafrik:disposable-test-cluster";
const RUN_DATABASE_PREFIX = "somafrik_test_run_";
// Base exigée par la fixture NFC (studentCardsNfcIntegration.fixture.js) ; créée par l'exécuteur.
const NFC_TEST_DATABASE = "nfc_encoding_test";
// Base source des tests : maintenance du cluster vérifié (acceptée par les gardes des tests).
const MAINTENANCE_DATABASE = "postgres";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"]);

// Noms de bases créés par la baseline et par les tests PostgreSQL du dépôt.
const TEST_DATABASE_PATTERNS = Object.freeze([
  new RegExp(`^${SENTINEL_DATABASE}$`),
  /^somafrik_test_[a-z0-9_]+$/,
  /^[a-z0-9_]+_it$/,
  // Variantes de bases IT suffixées par cas (ex. somafrik_report_card_lot9_it_scope).
  /^somafrik_[a-z0-9_]+_it_[a-z0-9_]+$/,
  /^[a-z0-9_]+_test$/,
  // Bases nommées aléatoirement par des tests précis (préfixe connu + hexadécimal).
  /^somafrik_(tt|tr|rc|pln|pd|pag|nav|late|audit_final|sec_auth_04)_[0-9a-f]{12}$/,
  /^nfc_prog_05_[0-9a-f]{32}$/,
]);

// Variables qui peuvent désigner une base : retirées avant de lancer les tests.
const DATABASE_ENV_PATTERNS = Object.freeze([
  /^DATABASE_URL$/,
  /DATABASE_URL$/,
  /_DB_URL$/,
  /_IT_DATABASE$/,
  /^PG(HOST|HOSTADDR|PORT|DATABASE|USER|PASSWORD|PASSFILE|SERVICE|SERVICEFILE|SSLMODE|OPTIONS|TARGETSESSIONATTRS)$/,
  /^DB_(HOST|PORT|NAME|USER|PASSWORD|SSL|URL)$/,
  /^SUPABASE_DB_URL$/,
]);

class BaselineGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = "BaselineGuardError";
  }
}

function refuse(message) {
  throw new BaselineGuardError(message);
}

/** Valide l'URL du cluster de test et renvoie l'objet URL normalisé. */
function parseTestClusterUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) refuse(`${TEST_PG_URL_VAR} est obligatoire pour le mode pg (DATABASE_URL n'est jamais utilisée).`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    refuse(`${TEST_PG_URL_VAR} n'est pas une URL valide.`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    refuse(`${TEST_PG_URL_VAR} doit utiliser le protocole postgres:// ou postgresql://.`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    refuse(`${TEST_PG_URL_VAR} doit viser un hôte loopback (reçu : « ${url.hostname} »).`);
  }
  if ([...url.searchParams.keys()].length > 0) {
    refuse(`${TEST_PG_URL_VAR} ne doit porter aucun paramètre (host, hostaddr, options… pourraient rediriger la connexion).`);
  }
  if (url.pathname !== `/${SENTINEL_DATABASE}`) {
    refuse(`${TEST_PG_URL_VAR} doit viser la base sentinelle « ${SENTINEL_DATABASE} » (reçu : « ${url.pathname.slice(1) || "(vide)"} »).`);
  }
  return url;
}

function isTestDatabaseName(name) {
  return TEST_DATABASE_PATTERNS.some((pattern) => pattern.test(String(name)));
}

/**
 * Vérifie, à partir de lectures faites sur le cluster, qu'il est dédié aux tests.
 * @param {{ currentDatabase: string, sentinelComment: string|null, databases: string[] }} facts
 */
function assertDedicatedTestCluster(facts) {
  if (facts.currentDatabase !== SENTINEL_DATABASE) {
    refuse(`Connexion inattendue à « ${facts.currentDatabase} » au lieu de « ${SENTINEL_DATABASE} ».`);
  }
  if (facts.sentinelComment !== SENTINEL_COMMENT) {
    refuse(
      `La base « ${SENTINEL_DATABASE} » ne porte pas le commentaire « ${SENTINEL_COMMENT} » : ` +
        "le cluster n'est pas déclaré jetable.",
    );
  }
  const foreign = (facts.databases ?? [])
    .filter((name) => !SYSTEM_DATABASES.has(name))
    .filter((name) => !isTestDatabaseName(name))
    .sort();
  if (foreign.length) {
    refuse(
      `Le cluster contient des bases qui ne sont pas des bases de test (${foreign.join(", ")}) : ` +
        "il n'est pas dédié aux tests, exécution refusée.",
    );
  }
}

/** Seules les bases gérées par l'exécuteur peuvent être créées ou supprimées par lui. */
function assertRunDatabaseName(name) {
  const value = String(name);
  const isRunDatabase = new RegExp(`^${RUN_DATABASE_PREFIX}[a-z0-9_]{1,40}$`).test(value);
  if (!isRunDatabase && value !== NFC_TEST_DATABASE) {
    refuse(`Nom de base de travail refusé : « ${name} ».`);
  }
  return name;
}

function runDatabaseName(label, unique) {
  return assertRunDatabaseName(`${RUN_DATABASE_PREFIX}${label}_${unique}`.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
}

function databaseUrl(clusterUrl, databaseName) {
  const url = new URL(clusterUrl.toString());
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/** Retire toute variable susceptible de désigner une base ; renvoie les noms retirés. */
function sanitizeDatabaseEnv(env) {
  const clean = {};
  const removed = [];
  for (const [key, value] of Object.entries(env)) {
    if (key === TEST_PG_URL_VAR || DATABASE_ENV_PATTERNS.some((pattern) => pattern.test(key))) {
      removed.push(key);
      continue;
    }
    clean[key] = value;
  }
  return { env: clean, removed: removed.sort() };
}

module.exports = {
  BaselineGuardError,
  MAINTENANCE_DATABASE,
  NFC_TEST_DATABASE,
  RUN_DATABASE_PREFIX,
  SENTINEL_COMMENT,
  SENTINEL_DATABASE,
  TEST_PG_URL_VAR,
  assertDedicatedTestCluster,
  assertRunDatabaseName,
  databaseUrl,
  isTestDatabaseName,
  parseTestClusterUrl,
  runDatabaseName,
  sanitizeDatabaseEnv,
};
