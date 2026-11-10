import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateMergeAuthorization, parseAuthorizationLines } from "./mergeAuthorization.mjs";
import { createGitHubClient, verify } from "./verify-merge-authorization.mjs";

const HEAD = "a".repeat(40);
const OLD_HEAD = "b".repeat(40);
const CTO = "cto-personnel";

const config = () => ({
  version: 1,
  protectedTargets: ["develop", "main"],
  authorizers: [CTO],
  deniedActors: ["Somafrik"],
  requiredChecks: { develop: ["Required"], main: ["Required"] },
});

const pr = (overrides = {}) => ({
  number: 1000,
  state: "open",
  draft: false,
  title: "R15 — Governance: merge authorisation and traceability",
  user: { login: "Somafrik", type: "User" },
  head: { sha: HEAD },
  base: { ref: "develop" },
  ...overrides,
});

let nextId = 1;
const review = ({ login = CTO, type = "User", state = "APPROVED", commit = HEAD, body } = {}) => ({
  id: nextId++,
  user: { login, type },
  state,
  commit_id: commit,
  body: body ?? `Diff vérifié.\nCTO-GO-MERGE PR=#1000 HEAD=${HEAD} TARGET=develop\n`,
});

const greenCi = () => [{ id: 1, name: "Required", status: "completed", conclusion: "success" }];

const run = (input) =>
  evaluateMergeAuthorization({ pr: pr(), reviews: [review()], checkRuns: greenCi(), statuses: [], config: config(), ...input });

const refused = (result, fragment) => {
  assert.equal(result.authorized, false);
  assert.ok(result.reasons.some((r) => r.includes(fragment)), `motif attendu « ${fragment} » dans : ${result.reasons.join(" | ")}`);
};

test("R15-01 PR Draft : refus", () => {
  refused(run({ pr: pr({ draft: true }) }), "Draft");
});

test("R15-02 PR sans autorisation : refus", () => {
  refused(run({ reviews: [] }), "Aucune autorisation CTO");
});

test("R15-03 autorisation d'un bot non habilité : refus", () => {
  refused(run({ reviews: [review({ login: "chatgpt-codex-connector[bot]", type: "Bot" })] }), "bot non habilité");
});

test("R15-03b compte partagé Somafrik recopiant la chaîne exacte : refus", () => {
  const cfg = { ...config(), authorizers: [CTO, "Somafrik"] };
  refused(run({ config: cfg, reviews: [review({ login: "Somafrik" })] }), "compte partagé");
});

test("R15-03c compte humain hors liste recopiant la chaîne exacte : refus", () => {
  refused(run({ reviews: [review({ login: "quelqu-un" })] }), "absent de la liste");
});

test("R15-04 autorisation pour un ancien HEAD : refus", () => {
  const body = `CTO-GO-MERGE PR=#1000 HEAD=${OLD_HEAD} TARGET=develop`;
  refused(run({ reviews: [review({ commit: OLD_HEAD, body })] }), "pas sur le HEAD courant");
});

test("R15-05 autorisation pour main utilisée sur develop : refus", () => {
  const body = `CTO-GO-MERGE PR=#1000 HEAD=${HEAD} TARGET=main`;
  refused(run({ reviews: [review({ body })] }), "TARGET=main");
});

test("R15-05b base changée de develop vers main après autorisation : refus", () => {
  refused(run({ pr: pr({ base: { ref: "main" } }) }), "TARGET=develop");
});

test("R15-06 commentaire « approved » seul : refus", () => {
  refused(run({ reviews: [review({ body: "approved" })] }), "Aucune autorisation CTO");
  refused(run({ reviews: [review({ body: "LGTM, authorised by CTO, ready" })] }), "Aucune autorisation CTO");
});

test("R15-07 nouveau commit après autorisation : refus", () => {
  const newHead = "c".repeat(40);
  const result = run({ pr: pr({ head: { sha: newHead } }) });
  refused(result, "pas sur le HEAD courant");
});

test("R15-08 CI requise rouge : refus", () => {
  refused(run({ checkRuns: [{ id: 1, name: "Required", status: "completed", conclusion: "failure" }] }), "en échec (failure)");
});

test("R15-08b CI requise en cours ou absente : refus", () => {
  refused(run({ checkRuns: [{ id: 1, name: "Required", status: "in_progress", conclusion: null }] }), "non terminée");
  refused(run({ checkRuns: [] }), "absente");
});

test("R15-08c dernier passage de la CI requise rouge après un vert : refus", () => {
  const checkRuns = [
    { id: 1, name: "Required", status: "completed", conclusion: "success" },
    { id: 2, name: "Required", status: "completed", conclusion: "failure" },
  ];
  refused(run({ checkRuns }), "en échec");
});

test("R15-09 PR valide et autorisation vérifiable : autorisation conditionnelle", () => {
  const result = run({});
  assert.equal(result.authorized, true, result.reasons.join(" | "));
  assert.equal(result.authorization.login, CTO);
  assert.equal(result.authorization.head, HEAD);
  assert.equal(result.authorization.target, "develop");
});

test("R15-10 permissions GitHub insuffisantes : fail-closed", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const client = createGitHubClient({ repo: "o/r", token: "x", fetchImpl });
  const result = await verify({ client, prNumber: 1000 });
  assert.equal(result.authorized, false);
  assert.match(result.reasons[0], /fail-closed.*HTTP 403/);
});

test("R15-10b configuration absente de la branche cible : fail-closed", async () => {
  const fetchImpl = async (url) =>
    url.endsWith("/pulls/1000")
      ? { ok: true, status: 200, json: async () => pr() }
      : { ok: false, status: 404, json: async () => ({}) };
  const client = createGitHubClient({ repo: "o/r", token: "x", fetchImpl });
  const result = await verify({ client, prNumber: 1000 });
  assert.equal(result.authorized, false);
  assert.match(result.reasons[0], /HTTP 404/);
});

test("R15-11 liste d'autorisateurs vide (état livré) : refus", () => {
  refused(run({ config: { ...config(), authorizers: [] } }), "Aucun autorisateur CTO habilité");
});

test("R15-12 titre encore marqué DRAFT / HOLD : refus", () => {
  refused(run({ pr: pr({ title: "[DRAFT / HOLD] R15 — Governance" }) }), "Titre encore marqué");
});

test("R15-13 approbation remplacée par une demande de changements : refus", () => {
  const approval = review();
  const later = review({ state: "CHANGES_REQUESTED", body: "Non." });
  assert.ok(later.id > approval.id);
  refused(run({ reviews: [approval, later] }), "remplacée par une review plus récente");
});

test("R15-14 review COMMENTED avec la chaîne exacte (pas d'approbation) : refus", () => {
  refused(run({ reviews: [review({ state: "COMMENTED" })] }), "pas APPROVED");
});

test("R15-15 l'auteur de la PR ne peut pas s'autoriser lui-même", () => {
  refused(run({ pr: pr({ user: { login: CTO, type: "User" } }) }), "ne peut pas s'autoriser");
});

test("R15-16 PR fermée ou fusionnée : refus", () => {
  refused(run({ pr: pr({ state: "closed" }) }), "non ouverte");
});

test("R15-17 cible non protégée : refus", () => {
  refused(run({ pr: pr({ base: { ref: "feature/x" } }) }), "hors du périmètre protégé");
});

test("parseAuthorizationLines : format strict, ligne entière, SHA complet", () => {
  assert.deepEqual(parseAuthorizationLines(`x\nCTO-GO-MERGE PR=#12 HEAD=${HEAD} TARGET=develop\ny`), [
    { pr: 12, head: HEAD, target: "develop" },
  ]);
  assert.deepEqual(parseAuthorizationLines(`CTO-GO-MERGE PR=#12 HEAD=${HEAD.slice(0, 12)} TARGET=develop`), []);
  assert.deepEqual(parseAuthorizationLines(`> CTO-GO-MERGE PR=#12 HEAD=${HEAD} TARGET=develop`), []);
  assert.deepEqual(parseAuthorizationLines(`\`CTO-GO-MERGE PR=#12 HEAD=${HEAD} TARGET=develop\``), []);
});
