import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));

describe("ADMIN-02B STOP — UI n'expose pas encore d'alias d'affichage", () => {
  it("PermissionsPage renomme roleName métier, pas displayLabel", () => {
    const page = readFileSync(join(ROOT, "../pages/PermissionsPage.tsx"), "utf8");
    expect(page).toContain("{ roleName: nextName }");
    expect(page).toContain("isProtectedRole");
    expect(page).not.toContain("displayLabel");
    expect(page).not.toContain("effectiveLabel");
    expect(page).not.toContain("Restaurer le libellé par défaut");
  });

  it("rbacApi n'a pas d'endpoint display-label", () => {
    const api = readFileSync(join(ROOT, "rbacApi.ts"), "utf8");
    expect(api).toContain("updateRole");
    expect(api).not.toContain("displayLabel");
    expect(api).not.toContain("role-display");
  });
});
