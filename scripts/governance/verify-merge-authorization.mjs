#!/usr/bin/env node
// R15 — vérifie l'autorisation de fusion d'une PR et publie le statut
// « governance/merge-authorization » sur son HEAD exact.
//
// Fail-closed : toute erreur (API, permissions, configuration) produit un
// statut « failure ». Si le statut ne peut pas être publié, le processus
// échoue : aucun statut sur le HEAD = contrôle requis manquant = fusion bloquée
// (dès que le Ruleset exige ce contexte).
//
// Usage :
//   GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=… node verify-merge-authorization.mjs --pr 123
//   node verify-merge-authorization.mjs --pr 123 --dry-run   (lecture seule, sans publication)

import { appendFileSync } from "node:fs";
import { evaluateMergeAuthorization, STATUS_CONTEXT } from "./mergeAuthorization.mjs";

const CONFIG_PATH = ".github/governance/merge-authorizers.json";
const API = process.env.GITHUB_API_URL || "https://api.github.com";

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function createGitHubClient({ repo, token, fetchImpl = globalThis.fetch }) {
  async function request(method, path, body) {
    const res = await fetchImpl(`${API}/repos/${repo}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "somafrik-governance-r15",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${method} ${path} → HTTP ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }
  async function paginate(path, pick = (x) => x) {
    const out = [];
    for (let page = 1; page <= 20; page += 1) {
      const sep = path.includes("?") ? "&" : "?";
      const items = pick(await request("GET", `${path}${sep}per_page=100&page=${page}`));
      out.push(...items);
      if (items.length < 100) return out;
    }
    throw new Error(`Pagination interrompue (plus de 2000 éléments) : ${path}`);
  }
  return { request, paginate };
}

/** Collecte les faits GitHub puis applique la décision pure. Ne lève jamais. */
export async function verify({ client, prNumber }) {
  try {
    const pr = await client.request("GET", `/pulls/${prNumber}`);
    const head = pr?.head?.sha;
    const baseRef = pr?.base?.ref;
    // Configuration lue sur la branche cible, jamais sur la branche de la PR.
    const file = await client.request("GET", `/contents/${CONFIG_PATH}?ref=${encodeURIComponent(baseRef)}`);
    const config = JSON.parse(Buffer.from(String(file?.content ?? ""), "base64").toString("utf8"));
    const [reviews, checkRuns, combined] = await Promise.all([
      client.paginate(`/pulls/${prNumber}/reviews`),
      client.paginate(`/commits/${head}/check-runs`, (r) => r?.check_runs ?? []),
      client.request("GET", `/commits/${head}/status`),
    ]);
    const statuses = (combined?.statuses ?? []).filter((s) => s?.context !== STATUS_CONTEXT);
    const checks = checkRuns.filter((c) => c?.name !== STATUS_CONTEXT);
    const decision = evaluateMergeAuthorization({ pr, reviews, checkRuns: checks, statuses, config });
    return { head, ...decision };
  } catch (error) {
    return {
      head: null,
      authorized: false,
      authorization: null,
      reasons: [`Vérification impossible (fail-closed) : ${error?.message ?? error}`],
    };
  }
}

export async function publish({ client, head, result, targetUrl }) {
  const description = result.authorized
    ? `Autorisé par ${result.authorization.login} pour ${head.slice(0, 12)} → ${result.authorization.target}`
    : `Refusé : ${result.reasons[0] ?? "motif inconnu"}`;
  await client.request("POST", `/statuses/${head}`, {
    state: result.authorized ? "success" : "failure",
    context: STATUS_CONTEXT,
    description: description.length > 140 ? `${description.slice(0, 137)}...` : description,
    ...(targetUrl ? { target_url: targetUrl } : {}),
  });
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = Number(argValue("--pr") ?? process.env.PR_NUMBER);
  const dryRun = process.argv.includes("--dry-run");
  if (!repo || !Number.isInteger(prNumber) || prNumber <= 0) {
    console.error("GITHUB_REPOSITORY et --pr <numéro> sont obligatoires.");
    process.exit(1);
  }
  const client = createGitHubClient({ repo, token: process.env.GITHUB_TOKEN });
  let result = await verify({ client, prNumber });

  // Si le HEAD n'a pas pu être lu, on tente au moins de le relire pour poser un refus.
  let head = result.head;
  if (!head && !dryRun) {
    try {
      head = (await client.request("GET", `/pulls/${prNumber}`))?.head?.sha ?? null;
    } catch {
      head = null;
    }
  }

  const lines = [
    `## Autorisation de fusion — PR #${prNumber}`,
    `HEAD : \`${head ?? "illisible"}\``,
    `Décision : **${result.authorized ? "AUTORISÉE" : "REFUSÉE"}**`,
    ...(result.authorized
      ? [`Autorisation : review ${result.authorization.reviewId} de ${result.authorization.login} → ${result.authorization.target}`]
      : result.reasons.map((r) => `- ${r}`)),
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);

  if (dryRun) process.exit(result.authorized ? 0 : 3);
  if (!head) {
    console.error("HEAD illisible : aucun statut publié (le contrôle requis reste absent, donc bloquant).");
    process.exit(1);
  }
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
  try {
    await publish({ client, head, result, targetUrl: runUrl });
  } catch (error) {
    console.error(`Publication du statut impossible : ${error.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
