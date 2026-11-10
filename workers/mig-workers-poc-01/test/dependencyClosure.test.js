import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const removedFromTree = ["extract-zip", "basic-ftp", "proxy-agent", "get-uri", "pac-proxy-agent"];

test("closure de production — chaîne extract-zip / basic-ftp absente", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));

  assert.equal(pkg.dependencies["@cloudflare/puppeteer"], "^1.1.0");
  assert.equal(pkg.overrides["@cloudflare/puppeteer"]["@puppeteer/browsers"], "3.2.6");
  assert.equal(lock.packages["node_modules/@cloudflare/puppeteer"].version, "1.4.0");
  assert.equal(
    lock.packages["node_modules/@cloudflare/puppeteer/node_modules/@puppeteer/browsers"].version,
    "3.2.6",
  );

  const installed = new Set(Object.keys(lock.packages).map((key) => key.split("node_modules/").pop()));
  for (const name of removedFromTree) {
    assert.equal(installed.has(name), false, name);
  }

  const puppeteer = await import("@cloudflare/puppeteer");
  assert.equal(typeof puppeteer.default.launch, "function");
});
