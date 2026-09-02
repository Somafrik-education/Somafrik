import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LANDING_PAGE = path.join(WEB_ROOT, "src/pages/LandingPage.tsx");

describe("LandingPage section order", () => {
  it("places Web et mobile before Produit", () => {
    const source = fs.readFileSync(LANDING_PAGE, "utf8");
    const webMobileIndex = source.indexOf("<WebMobileSection />");
    const productIndex = source.indexOf("<ProductSection />");

    expect(webMobileIndex).toBeGreaterThan(-1);
    expect(productIndex).toBeGreaterThan(-1);
    expect(webMobileIndex).toBeLessThan(productIndex);
  });
});
