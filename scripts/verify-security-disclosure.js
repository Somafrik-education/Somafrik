#!/usr/bin/env node
"use strict";

/**
 * PR F — T-F-01…T-F-05 : tree HEAD sans boîte Outlook interne, politiques security@, identité Git noreply.
 * Les motifs sont assemblés au runtime pour que `git grep` de la boîte n’ait aucun hit dans ce fichier.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const HOST = ["outlook", "fr"].join(".");
const MAILBOX = `somafrik@${HOST}`;
const MAILBOX_RE = new RegExp(MAILBOX.replace(/\./g, "\\."), "i");
const HOST_EMAIL_RE = new RegExp(`@${HOST.replace(/\./g, "\\.")}`, "i");

function gitLsFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer" });
  assert.equal(result.status, 0, "git ls-files");
  return String(result.stdout).split("\0").filter(Boolean);
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function main() {
  const files = gitLsFiles();
  const outlookHits = [];

  for (const relative of files) {
    const full = path.join(ROOT, relative);
    let body;
    try {
      body = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (HOST_EMAIL_RE.test(body) || MAILBOX_RE.test(body)) {
      outlookHits.push(relative);
    }
  }

  assert.deepEqual(outlookHits, [], `T-F-01 boîte interne Outlook dans le tree HEAD : ${outlookHits.join(", ")}`);

  const rootPolicy = read("SECURITY.md");
  const projectPolicy = read("docs/project/SECURITY.md");
  const contributing = read("docs/project/CONTRIBUTING.md");

  assert.match(rootPolicy, /security@somafrik\.app/, "T-F-02 SECURITY.md racine");
  assert.match(projectPolicy, /security@somafrik\.app/, "T-F-03 docs/project/SECURITY.md");
  assert.match(
    projectPolicy,
    /configuré et test de réception validé le \*\*2026-09-01\*\*/,
    "T-F-03 routage Cloudflare configuré et testé",
  );
  assert.doesNotMatch(projectPolicy, /À VÉRIFIER/, "T-F-03 plus de CONFIGURATION EXTERNE en attente");
  assert.doesNotMatch(rootPolicy, MAILBOX_RE, "T-F-04 racine sans boîte interne");
  assert.doesNotMatch(projectPolicy, MAILBOX_RE, "T-F-04 politique projet sans boîte interne");
  assert.match(rootPolicy, /Ne pas.*issue/i, "T-F-02 divulgation publique interdite");
  assert.match(rootPolicy, /docs\/project\/SECURITY\.md/, "T-F-02 lien politique détaillée");

  assert.match(contributing, /GitHub noreply/i, "T-F-05 noreply documenté");
  assert.match(contributing, /Co-authored-by/, "T-F-05 trailers humains noreply");
  assert.match(contributing, /Settings → Emails/, "T-F-05 Settings Emails");
  assert.match(contributing, /contact@somafrik\.app/, "T-F-05 contact@ interdit comme user.email");
  assert.match(contributing, /security@somafrik\.app/, "T-F-05 security@ interdit comme user.email");
  assert.match(contributing, /support@somafrik\.app/, "T-F-05 support@ interdit comme user.email");
  assert.match(contributing, /notifications@somafrik\.app/, "T-F-05 notifications@");
  assert.match(contributing, /noreply@somafrik\.app/, "T-F-05 noreply@ fonctionnel");
  assert.match(contributing, /Ne pas réécrire/i, "T-F-05 pas de rewrite");
  assert.match(contributing, /ne sont pas des secrets/i, "T-F-05 historique ≠ secret");
  assert.doesNotMatch(contributing, MAILBOX_RE, "T-F-05 CONTRIBUTING sans boîte interne");

  console.log("verify:security-disclosure OK (T-F-01…T-F-05)");
}

main();
