"use strict";

/**
 * CI-FAST-01 — plan d'exécution de la baseline backend : sélection et lots.
 *
 * Fonctions pures, sans base ni réseau, utilisées par
 * scripts/backend-test-baseline.js (options --select et --shard) et par
 * scripts/ci-baseline-shards-verify.js (contrôle d'agrégation des lots).
 *
 * Règles :
 * - une sélection ne peut nommer que des fichiers de test découverts du mode ;
 * - le découpage en N lots est déterministe (poids mesurés, plus grand
 *   d'abord, lot le plus léger, égalité → plus petit indice) : chaque fichier
 *   appartient à exactement un lot et l'union des lots est la liste planifiée.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");

const DEFAULT_WEIGHT_SECONDS = 10;
const MAX_SHARDS = 8;

class PlanError extends Error {}

function parseShard(value) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(String(value ?? "").trim());
  if (!match) throw new PlanError(`--shard invalide « ${value} » (attendu K/N, ex. 2/3).`);
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total > MAX_SHARDS) throw new PlanError(`--shard : au plus ${MAX_SHARDS} lots.`);
  if (index > total) throw new PlanError(`--shard : lot ${index} hors de 1..${total}.`);
  return { index, total };
}

function weightOf(weights, file) {
  const value = Number(weights?.[file]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_WEIGHT_SECONDS;
}

/** Découpe déterministe : renvoie `total` listes triées, disjointes, d'union `files`. */
function partition(files, total, weights = {}) {
  if (!Number.isInteger(total) || total < 1) throw new PlanError(`Nombre de lots invalide : ${total}.`);
  const unique = [...new Set(files)];
  if (unique.length !== files.length) throw new PlanError("Liste de fichiers avec doublons.");
  const ordered = unique
    .map((file) => ({ file, weight: weightOf(weights, file) }))
    .sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const shards = Array.from({ length: total }, () => ({ load: 0, files: [] }));
  for (const item of ordered) {
    let target = 0;
    for (let i = 1; i < total; i += 1) if (shards[i].load < shards[target].load) target = i;
    shards[target].load += item.weight;
    shards[target].files.push(item.file);
  }
  return shards.map((shard) => shard.files.sort());
}

/** Lit et valide un fichier de sélection produit par scripts/ci-pg-select.js. */
function loadSelection(selectionPath, modeFiles) {
  let selection;
  try {
    selection = JSON.parse(fs.readFileSync(selectionPath, "utf8"));
  } catch (error) {
    throw new PlanError(`Sélection illisible « ${selectionPath} » : ${error.message}`);
  }
  if (!["full", "targeted"].includes(selection?.mode)) {
    throw new PlanError(`Sélection : mode « ${selection?.mode} » refusé (full | targeted ; « none » ne lance pas l'exécuteur).`);
  }
  if (selection.mode === "full") return { mode: "full", files: [...modeFiles] };
  if (!Array.isArray(selection.files) || !selection.files.length) {
    throw new PlanError("Sélection ciblée vide : refusée (jamais de baseline verte sans test).");
  }
  const known = new Set(modeFiles);
  const unknown = selection.files.filter((file) => !known.has(file));
  if (unknown.length) throw new PlanError(`Sélection : fichier(s) hors baseline : ${unknown.join(", ")}.`);
  return { mode: "targeted", files: [...new Set(selection.files)].sort() };
}

function digest(files) {
  return crypto.createHash("sha256").update([...files].sort().join("\n")).digest("hex");
}

module.exports = { DEFAULT_WEIGHT_SECONDS, MAX_SHARDS, PlanError, digest, loadSelection, parseShard, partition, weightOf };
