import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");

function parseJsonc(source) {
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
}

test("configuration cloud préparée, sans déploiement ni preuve simulée", async () => {
  const source = await readFile(path.join(root, "wrangler.prepared.jsonc"), "utf8");
  const prepared = parseJsonc(source);
  assert.equal(prepared.workers_dev, false);
  assert.equal(prepared.preview_urls, false);
  assert.equal(prepared.browser.binding, "BROWSER");
  assert.equal(prepared.hyperdrive[0].binding, "HYPERDRIVE");
  assert.equal(prepared.hyperdrive[0].id, "PENDING_CTO_AUTHORIZATION");
  assert.equal(prepared.hyperdrive[0].localConnectionString, undefined);
  assert.equal(prepared.queues.producers[0].queue, "somafrik-cloud-01-notifications");
  assert.equal(Object.hasOwn(prepared, "account_id"), false);
  assert.equal(Object.hasOwn(prepared, "routes"), false);
  assert.equal(Object.hasOwn(prepared, "route"), false);
  assert.equal(source.includes('"localConnectionString"'), false);
  assert.equal(source.includes("somafrik.app"), false);
  assert.equal(source.includes("supabase"), false);
  assert.equal(source.includes("onrender.com"), false);

  const report = await readFile(path.join(repo, "docs/audits/MIG-WORKERS-CLOUD-01.md"), "utf8");
  assert.match(report, /\| Express \/ JWT \/ RBAC \| BLOCKED \|/);
  assert.match(report, /\| Hyperdrive \/ PostgreSQL \| BLOCKED \|/);
  assert.match(report, /\| Browser Run \/ PDF \| BLOCKED \|/);
  assert.match(report, /\| Queue \| BLOCKED \|/);
  assert.match(
    report,
    /MIG-WORKERS-CLOUD-01 — EXPÉRIMENTATION CLOUD PRÉPARÉE \/ DRAFT \/ HOLD — EN ATTENTE DES AUTORISATIONS CTO\./,
  );
});
