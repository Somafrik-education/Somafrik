import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("consolidation Paramètres Finances → Finance", () => {
  it("redirige /parametres/finances vers /finances/frais", () => {
    const app = readFileSync(join(ROOT, "App.tsx"), "utf8");
    expect(app).toMatch(/path="finances"[\s\S]{0,250}?Navigate to="\/finances\/frais"/);
    expect(app).not.toMatch(/SettingsFinancePage/);
  });

  it("retire la carte Finances du hub Paramètres", () => {
    const hub = readFileSync(join(ROOT, "pages/parametres/SettingsHubPage.tsx"), "utf8");
    expect(hub).not.toMatch(/to:\s*"\/parametres\/finances"/);
    expect(hub).not.toMatch(/title:\s*"Finances"/);
  });

  it("supprime le lazy import de l'ancien écran Paramètres Finances", () => {
    const lazyPages = readFileSync(join(ROOT, "lazyPages.ts"), "utf8");
    expect(lazyPages).not.toMatch(/SettingsFinancePage/);
    expect(lazyPages).not.toMatch(/SettingsFinancePage\.tsx/);
  });
});
