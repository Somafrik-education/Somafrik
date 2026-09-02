#!/usr/bin/env node
"use strict";

/**
 * Garde CI forward-looking : nouveaux commits de PR (base...head).
 * Ignore les merges (commit GitHub synthétique / merge à plusieurs parents).
 * Ne scanne PAS tout l'historique.
 */

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const ROOT = require("node:path").resolve(__dirname, "..");
const HOST = ["outlook", "fr"].join(".");
const FORBIDDEN = new RegExp(`@${HOST.replace(/\./g, "\\.")}$`, "i");

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function resolveRange() {
  const base = process.env.PR_BASE_SHA || process.env.GITHUB_BASE_SHA || "";
  const baseRef = process.env.PR_BASE_REF || process.env.GITHUB_BASE_REF || "";
  const head = process.env.PR_HEAD_SHA || process.env.GITHUB_HEAD_SHA || "HEAD";
  if (base) return { base, baseRef, head, source: "pr-env" };

  const originDevelop = spawnSync("git", ["rev-parse", "--verify", "origin/develop"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (originDevelop.status === 0) {
    return { base: originDevelop.stdout.trim(), baseRef: "develop", head: "HEAD", source: "origin/develop...HEAD" };
  }
  throw new Error("PR_BASE_SHA manquant et origin/develop introuvable.");
}

function main() {
  const { base, baseRef, head, source } = resolveRange();
  let range = `${base}...${head}`;
  let effectiveSource = source;
  const logArgs = ["log"];

  if (baseRef === "main") {
    git(["merge-base", "--is-ancestor", "origin/develop", head]);
    git(["diff", "--quiet", "origin/develop", head, "--"]);
    range = `origin/develop..${head}`;
    logArgs.push("--first-parent");
    effectiveSource = `${source} release-main (arbre identique à origin/develop)`;
  }

  const log = git([...logArgs, "--format=%H%x09%P%x09%ae%x09%ce%x09%s", range]);
  const lines = log.split("\n").filter(Boolean);
  const offenders = [];

  for (const line of lines) {
    const [hash, parents, author, committer, subject] = line.split("\t");
    const parentCount = String(parents || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    if (parentCount > 1) continue;
    if (/^Merge /i.test(subject || "") && /noreply@github\.com/i.test(committer || "")) continue;

    if (FORBIDDEN.test(author || "") || FORBIDDEN.test(committer || "")) {
      offenders.push({ hash, author, committer, subject });
    }
  }

  assert.equal(
    offenders.length,
    0,
    `T-GIT-01 domaine Outlook dans ${effectiveSource} (hors merges) : ${JSON.stringify(offenders, null, 2)}`,
  );
  console.log(`verify:pr-git-identity OK (${lines.length} commit(s) dans ${effectiveSource}, merges ignorés)`);
}

main();
