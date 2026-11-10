import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveEffectiveRoleLabel, visibleRoleLabel } from "./roleDisplayLabels";

const ROOT = dirname(fileURLToPath(import.meta.url));

describe("ADMIN-02B — UI Superadmin + résolution unique", () => {
  it("PermissionsPage expose displayLabel sans détourner le rename ADMIN-02", () => {
    const page = readFileSync(join(ROOT, "../pages/PermissionsPage.tsx"), "utf8");
    expect(page).toContain("updateRole(role.id, { roleName: nextName })");
    expect(page).toContain("updateRoleDisplayLabel");
    expect(page).toContain("resetRoleDisplayLabel");
    expect(page).toContain("Restaurer le défaut");
    expect(page).toContain("Libellé effectif");
    expect(page).toContain("isProtectedRole");
  });

  it("rbacApi a les endpoints display-label dédiés", () => {
    const api = readFileSync(join(ROOT, "rbacApi.ts"), "utf8");
    expect(api).toContain("updateRoleDisplayLabel");
    expect(api).toContain("resetRoleDisplayLabel");
    expect(api).toContain("/display-label");
  });

  it("Topbar et listes utilisateurs consomment effectiveLabel visuellement", () => {
    const topbar = readFileSync(join(ROOT, "../components/layout/Topbar.tsx"), "utf8");
    const users = readFileSync(join(ROOT, "userAccounts.ts"), "utf8");
    expect(topbar).toContain("visibleRoleLabel");
    expect(users).toContain("effectiveRoleLabel");
  });

  it("résolution unique : display trim sinon role_name", () => {
    expect(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: "Directeur" })).toBe("Directeur");
    expect(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: "   " })).toBe("Admin School");
    expect(visibleRoleLabel({ role: "Admin School", effectiveRoleLabel: "Directeur" })).toBe("Directeur");
  });
});
