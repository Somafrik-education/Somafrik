import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ASSET = path.join(WEB_ROOT, "public/marketing/somafrik-dashboard-etablissement.webp");
const HERO = path.join(WEB_ROOT, "src/components/marketing/HeroSection.tsx");
const PRODUCT = path.join(WEB_ROOT, "src/components/marketing/ProductSection.tsx");
const VISUAL = path.join(WEB_ROOT, "src/components/marketing/ProductVisual.tsx");

describe("marketing product visual asset", () => {
  it("versionne un WebP local, sans base64 ni placeholder", () => {
    const bytes = fs.readFileSync(ASSET);
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
    assert.ok(bytes.length > 40_000, `asset trop léger: ${bytes.length}`);
    assert.ok(bytes.length < 180_000, `asset trop lourd: ${bytes.length}`);

    for (const file of [HERO, PRODUCT, VISUAL]) {
      const source = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(source, /data:image\//);
      assert.doesNotMatch(source, /Emplacement réservé à une capture réelle/);
    }
  });
});
