"use strict";

/**
 * CI-FAST-01 — décide, à partir des fichiers modifiés d'une PR, ce que le
 * niveau A (PR Gates) exécute de la baseline backend MONO-T0.
 *
 *   git diff --name-only <base> <head> | node scripts/ci-pg-select.js --out=<sélection.json>
 *
 * Sortie (stdout JSON, fichier --out, et $GITHUB_OUTPUT s'il existe) :
 *   backend  : true si la PR touche le backend ou ce qui l'exécute
 *              (tests unitaires complets + inventaire MONO-T1 + PostgreSQL) ;
 *   pg_mode  : none | targeted | full ;
 *   files    : (targeted) fichiers PostgreSQL à exécuter.
 *
 * Principe : en cas de doute, tout. Le mode ciblé n'existe que lorsque TOUS
 * les fichiers backend modifiés sont des fichiers de test ou de la
 * documentation du backend : aucun code exécuté par les autres tests n'a
 * changé. Il exécute alors les tests PostgreSQL modifiés ET tout le socle
 * sécurité / isolation multi-tenant / RBAC (SECURITY_CORE). Toute autre
 * modification du backend, des paquets partagés, des dépendances, de
 * l'exécuteur ou des workflows qui l'appellent ⇒ baseline PostgreSQL complète.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

/** Tout ce qui peut changer le résultat de la baseline backend. */
const BACKEND_TRIGGERS = [
  /^backend\//,
  /^packages\//,
  /^package(-lock)?\.json$/,
  /^scripts\/backend-test-baseline[^/]*$/,
  /^scripts\/fixtures\/backend-test-baseline\//,
  /^scripts\/mono-t1-route-inventory[^/]*$/,
  /^scripts\/ci-pg-select[^/]*$/,
  /^scripts\/ci-baseline-[^/]*$/,
  /^scripts\/ci-fast-01[^/]*$/,
  /^docs\/project\/MONO-T1-ROUTES\./,
  /^docs\/project\/MONO-T1-RBAC-MATRIX\.json$/,
  /^\.github\/workflows\/(pr-gates|backend-test-baseline|release-gate)\.ya?ml$/,
];

/** Seuls changements backend compatibles avec le mode ciblé. */
const TARGETED_ONLY = [/^backend\/(?!node_modules\/).*\.test\.js$/, /^backend\/(?!node_modules\/).*\.md$/];

/**
 * Socle exécuté à chaque PR backend, même ciblée : isolation multi-tenant,
 * sessions, JWT, RBAC (dont la matrice MONO-T1), périmètres. Défini par motif
 * pour inclure d'office tout nouveau test qui suit la convention de nommage.
 */
const SECURITY_CORE = [
  /\/sec[A-Z][^/]*\.pg\.test\.js$/,
  /Tenant[^/]*\.pg\.test\.js$/,
  /Isolation[^/]*\.pg\.test\.js$/,
  /[Rr]bac[^/]*\.pg\.test\.js$/,
  /Scope[^/]*\.pg\.test\.js$/,
  /\/monoT1\.authSessions\.http\.pg\.test\.js$/,
  /\/monoT1\.anomaly\.[^/]*\.pg\.test\.js$/,
  /\/bulletinSec01\.http\.pg\.test\.js$/,
  /\/platformPersonalData[^/]*\.pg\.test\.js$/,
];

function listPgTestFiles(root = ROOT) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".pg.test.js")) found.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(path.join(root, "backend"));
  return found.sort();
}

function normalize(changed) {
  return [...new Set(changed.map((file) => String(file).trim().replace(/\\/g, "/")).filter(Boolean))].sort();
}

function securityCore(pgFiles) {
  return pgFiles.filter((file) => SECURITY_CORE.some((pattern) => pattern.test(file)));
}

/** Décision pure : `changed` = chemins modifiés, `pgFiles` = baseline PostgreSQL découverte. */
function selectPg(changed, pgFiles) {
  const files = normalize(changed);
  const backendFiles = files.filter((file) => BACKEND_TRIGGERS.some((pattern) => pattern.test(file)));
  if (!backendFiles.length) {
    return { backend: false, pg_mode: "none", reasons: ["aucun fichier backend, paquet partagé, dépendance ou exécuteur modifié"], files: [] };
  }
  const outsideTargeted = backendFiles.filter((file) => !TARGETED_ONLY.some((pattern) => pattern.test(file)));
  if (outsideTargeted.length) {
    const shown = outsideTargeted.slice(0, 10);
    return {
      backend: true,
      pg_mode: "full",
      reasons: [`code ou configuration backend modifié : ${shown.join(", ")}${outsideTargeted.length > shown.length ? ` (+${outsideTargeted.length - shown.length})` : ""}`],
      files: [],
    };
  }
  const known = new Set(pgFiles);
  const changedPg = backendFiles.filter((file) => known.has(file));
  const core = securityCore(pgFiles);
  if (!core.length) {
    // Socle introuvable : configuration incohérente, on ne cible pas.
    return { backend: true, pg_mode: "full", reasons: ["socle sécurité introuvable : baseline complète"], files: [] };
  }
  const selected = [...new Set([...changedPg, ...core])].sort();
  return {
    backend: true,
    pg_mode: "targeted",
    reasons: [
      `seuls des tests / docs backend modifiés (${backendFiles.length} fichier(s))`,
      `${changedPg.length} test(s) PostgreSQL modifié(s) + socle sécurité (${core.length})`,
    ],
    files: selected,
  };
}

if (require.main === module) {
  const outFlag = process.argv.slice(2).find((arg) => arg.startsWith("--out="));
  const changed = fs.readFileSync(0, "utf8").split("\n");
  const decision = selectPg(changed, listPgTestFiles());
  const serialized = `${JSON.stringify({ mode: decision.pg_mode, ...decision }, null, 2)}\n`;
  if (outFlag) fs.writeFileSync(outFlag.slice("--out=".length), serialized);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `backend=${decision.backend}\npg_mode=${decision.pg_mode}\n`);
  }
  process.stdout.write(serialized);
}

module.exports = { BACKEND_TRIGGERS, SECURITY_CORE, TARGETED_ONLY, listPgTestFiles, securityCore, selectPg };
