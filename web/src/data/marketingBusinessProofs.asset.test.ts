import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROOFS_DIR = path.join(WEB_ROOT, "public/marketing/proofs");
const FILES = [
  "somafrik-finance-paiements.webp",
  "somafrik-presences-appel.webp",
  "somafrik-evaluations.webp",
];
const SOURCES = [
  path.join(WEB_ROOT, "src/components/marketing/BusinessProofsSection.tsx"),
  path.join(WEB_ROOT, "src/data/marketingContent.ts"),
];

describe("marketing business proof assets", () => {
  it("versionne trois WebP locaux, sans docs/, base64 ni Notes", () => {
    assert.equal(fs.existsSync(path.join(PROOFS_DIR, "somafrik-notes.webp")), false);
    for (const name of FILES) {
      const bytes = fs.readFileSync(path.join(PROOFS_DIR, name));
      assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
      assert.ok(bytes.length > 15_000, `${name} trop léger: ${bytes.length}`);
      assert.ok(bytes.length < 200_000, `${name} trop lourd: ${bytes.length}`);
    }

    for (const file of SOURCES) {
      const source = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(source, /data:image\//);
      assert.doesNotMatch(source, /["']\/docs\//);
      assert.doesNotMatch(source, /somafrik-notes/);
    }
  });
});
