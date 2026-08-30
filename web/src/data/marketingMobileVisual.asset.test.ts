import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MOBILE_DIR = path.join(WEB_ROOT, "public/marketing/mobile");
const FILES = [
  "somafrik-mobile-classes.webp",
  "somafrik-mobile-eleves.webp",
  "somafrik-mobile-enseignants.webp",
];
const SOURCES = [
  path.join(WEB_ROOT, "src/components/marketing/WebMobileSection.tsx"),
  path.join(WEB_ROOT, "src/components/marketing/MobileProductVisual.tsx"),
  path.join(WEB_ROOT, "src/data/marketingContent.ts"),
];

describe("marketing mobile visual assets", () => {
  it("versionne trois captures natives, sans docs/ ni base64", () => {
    for (const name of FILES) {
      const bytes = fs.readFileSync(path.join(MOBILE_DIR, name));
      assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
      assert.ok(bytes.length > 20_000, `${name} trop léger: ${bytes.length}`);
      assert.ok(bytes.length < 200_000, `${name} trop lourd: ${bytes.length}`);
    }

    for (const file of SOURCES) {
      const source = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(source, /data:image\//);
      assert.doesNotMatch(source, /["']\/docs\//);
      assert.doesNotMatch(source, /vitrine_02_hero_mobile/);
    }
  });
});
