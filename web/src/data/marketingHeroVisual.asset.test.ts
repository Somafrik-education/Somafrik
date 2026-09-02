import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ASSET = path.join(WEB_ROOT, "public/marketing/hero-somafrik-school-dashboard.webp");
const LEGACY = path.join(WEB_ROOT, "public/marketing/somafrik-dashboard-hero.webp");
const PRODUCT = path.join(WEB_ROOT, "public/marketing/somafrik-dashboard-etablissement.webp");
const README = path.join(WEB_ROOT, "public/marketing/README.md");
const HERO = path.join(WEB_ROOT, "src/components/marketing/HeroSection.tsx");
const VISUAL = path.join(WEB_ROOT, "src/components/marketing/ProductVisual.tsx");
const CONTENT = path.join(WEB_ROOT, "src/data/marketingContent.ts");

describe("marketing hero visual asset", () => {
  it("versionne un WebP Hero distinct du Produit, sans le présenter comme preuve runtime", () => {
    const bytes = fs.readFileSync(ASSET);
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
    assert.ok(bytes.length > 80_000, `asset trop léger: ${bytes.length}`);
    assert.ok(bytes.length < 360_000, `asset trop lourd: ${bytes.length}`);
    assert.equal(fs.existsSync(LEGACY), false, "l’ancien asset Hero ne doit plus être versionné");
    assert.notEqual(fs.readFileSync(PRODUCT).equals(bytes), true);

    const content = fs.readFileSync(CONTENT, "utf8");
    const heroStart = content.indexOf("export const marketingHeroVisual");
    const heroEnd = content.indexOf("} as const;", heroStart);
    const heroBlock = content.slice(heroStart, heroEnd);
    assert.match(content, /Visuel Hero officiel[\s\S]*export const marketingHeroVisual/);
    assert.doesNotMatch(heroBlock, /capture runtime|preuve runtime|capture preprod/i);

    const readme = fs.readFileSync(README, "utf8");
    const readmeHero = readme.slice(0, readme.indexOf("## Produit"));
    assert.match(readmeHero, /hero-somafrik-school-dashboard\.webp/);
    assert.match(readmeHero, /Visuel Hero officiel/);
    assert.doesNotMatch(readmeHero, /capture runtime|preuve runtime|capture preprod/i);

    for (const file of [HERO, VISUAL, CONTENT]) {
      const source = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(source, /data:image\//);
      assert.doesNotMatch(source, /["']\/docs\//);
    }

    const visual = fs.readFileSync(VISUAL, "utf8");
    assert.match(visual, /marketingHeroVisual/);
    assert.match(visual, /marketingProductVisual/);
    assert.match(visual, /fetchPriority=\{isHero \? "high" : "auto"\}/);
    assert.match(visual, /loading=\{isHero \? "eager" : "lazy"\}/);
  });
});
