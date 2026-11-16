import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPocBulletinHtml } from "../src/bulletin.js";
import { renderBulletinPdf } from "../src/pdf.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseJsonc(source) {
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
}

test("Browser Run — configuration préparée, PDF non simulé", async () => {
  const prepared = parseJsonc(await readFile(path.join(root, "wrangler.browser-run.jsonc"), "utf8"));
  const local = parseJsonc(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));

  assert.equal(prepared.browser.binding, "BROWSER");
  assert.equal(prepared.workers_dev, false);
  assert.equal(prepared.preview_urls, false);
  assert.equal(prepared.main, "src/index.js");
  assert.ok(prepared.compatibility_flags.includes("nodejs_compat"));
  assert.equal(Object.hasOwn(prepared, "account_id"), false);
  assert.equal(Object.hasOwn(prepared, "routes"), false);
  assert.equal(Object.hasOwn(prepared, "route"), false);
  assert.equal(Object.hasOwn(prepared, "hyperdrive"), false);
  assert.equal(local.browser, undefined);

  const html = buildPocBulletinHtml();
  await assert.rejects(renderBulletinPdf(undefined, html), (error) => error?.code === "BROWSER_BINDING_REQUIRED");
  await assert.rejects(renderBulletinPdf({}, html), (error) => error?.code === "BROWSER_BINDING_REQUIRED");
  await assert.rejects(
    renderBulletinPdf({ fetch: undefined }, html),
    (error) => error?.code === "BROWSER_BINDING_REQUIRED",
  );
});
