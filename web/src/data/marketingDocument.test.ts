import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { marketingSeo } from "./marketingContent";

const html = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../index.html"), "utf8");

describe("document marketing index.html", () => {
  it("pose le socle SEO français sans dépendance lourde", () => {
    assert.match(html, /<html lang="fr">/);
    assert.match(html, /name="viewport"/);
    assert.match(html, new RegExp(`<title>${marketingSeo.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</title>`));
    assert.match(html, new RegExp(marketingSeo.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /property="og:title"/);
    assert.match(html, /property="og:description"/);
    assert.match(html, /property="og:type" content="website"/);
    assert.match(html, /property="og:locale" content="fr_FR"/);
    assert.match(html, /marketing\/somafrik-dashboard-etablissement\.webp/);
    assert.match(html, /rel="icon"/);
    assert.match(html, /rel="preload"[\s\S]*hero-somafrik-school-dashboard\.webp/);
    assert.match(html, /property="og:image" content="marketing\/somafrik-dashboard-etablissement\.webp"/);
    assert.doesNotMatch(html, /ISO 27001|SOC 2|Demander une démo|Nous contacter/i);
    assert.doesNotMatch(html, /react-helmet|next-seo/i);
  });
});
