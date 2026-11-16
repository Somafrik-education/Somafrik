"use strict";

/**
 * CI-FAST-01 — contrôle d'agrégation des lots PostgreSQL.
 *
 *   node scripts/ci-baseline-shards-verify.js --selection=<sélection.json> --plans=<dossier> --shards=N
 *
 * <dossier> contient un plan.json par lot (artefacts backend-test-baseline-pg-shard-K).
 * Échoue si un lot manque ou est en double, si les lots n'ont pas tous vu la
 * même sélection, si un fichier attendu n'a été attribué à aucun lot, à deux
 * lots, ou si un lot a exécuté un fichier hors sélection. Un vert du niveau A
 * ne peut donc pas reposer sur des tests non déclenchés.
 */

const fs = require("node:fs");
const path = require("node:path");
const { digest } = require("./backend-test-baseline-plan");
const { listPgTestFiles } = require("./ci-pg-select");

function findPlans(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "plan.json") found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

/** Contrôle pur : renvoie la liste des problèmes (vide = conforme). */
function verifyShards({ expectedFiles, plans, shards }) {
  const problems = [];
  const expected = [...new Set(expectedFiles)].sort();
  const expectedDigest = digest(expected);
  const seenIndex = new Map();
  const owner = new Map();
  for (const planDoc of plans) {
    const shard = planDoc.shard;
    if (!shard || shard.total !== shards) {
      problems.push(`plan sans lot ou découpage différent (${JSON.stringify(shard)} ; attendu N=${shards})`);
      continue;
    }
    if (seenIndex.has(shard.index)) problems.push(`lot ${shard.index} présent deux fois`);
    seenIndex.set(shard.index, true);
    if (planDoc.selectedDigest !== expectedDigest) problems.push(`lot ${shard.index} : sélection différente de la sélection attendue`);
    for (const file of planDoc.files ?? []) {
      if (owner.has(file)) problems.push(`${file} attribué aux lots ${owner.get(file)} et ${shard.index}`);
      else owner.set(file, shard.index);
    }
  }
  for (let index = 1; index <= shards; index += 1) if (!seenIndex.has(index)) problems.push(`lot ${index}/${shards} absent`);
  const expectedSet = new Set(expected);
  for (const file of expected) if (!owner.has(file)) problems.push(`${file} n'a été exécuté par aucun lot`);
  for (const file of owner.keys()) if (!expectedSet.has(file)) problems.push(`${file} exécuté hors sélection`);
  return problems;
}

if (require.main === module) {
  const arg = (name) => process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const selectionPath = arg("selection");
  const plansDir = arg("plans");
  const shards = Number(arg("shards"));
  if (!selectionPath || !plansDir || !Number.isInteger(shards) || shards < 1) {
    console.error("Usage : node scripts/ci-baseline-shards-verify.js --selection=<fichier> --plans=<dossier> --shards=N");
    process.exit(1);
  }
  const selection = JSON.parse(fs.readFileSync(selectionPath, "utf8"));
  let expectedFiles;
  if (selection.mode === "full") expectedFiles = listPgTestFiles();
  else if (selection.mode === "targeted") expectedFiles = selection.files ?? [];
  else {
    console.error(`✖ Sélection « ${selection.mode} » : aucun lot ne devait s'exécuter.`);
    process.exit(1);
  }
  const plans = findPlans(plansDir).map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
  const problems = verifyShards({ expectedFiles, plans, shards });
  const lines = [
    "## Agrégation des lots PostgreSQL (CI-FAST-01)",
    "",
    `Sélection : ${selection.mode} — ${expectedFiles.length} fichier(s) ; lots attendus : ${shards} ; plans reçus : ${plans.length}.`,
    "",
    ...plans
      .slice()
      .sort((a, b) => (a.shard?.index ?? 0) - (b.shard?.index ?? 0))
      .map((planDoc) => `- lot ${planDoc.shard?.index}/${planDoc.shard?.total} : ${(planDoc.files ?? []).length} fichier(s)`),
    "",
    problems.length ? `**ÉCHEC** :\n${problems.map((problem) => `- ${problem}`).join("\n")}` : "✔ Chaque fichier sélectionné a été attribué à exactement un lot.",
  ];
  const markdown = `${lines.join("\n")}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(markdown);
  process.exit(problems.length ? 1 : 0);
}

module.exports = { findPlans, verifyShards };
