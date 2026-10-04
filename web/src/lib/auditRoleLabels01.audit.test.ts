import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveEffectiveRoleLabel, visibleRoleLabel } from "./roleDisplayLabels";
import { formatAccessRolesDisplay } from "./userAccounts";

const root = join(__dirname, "../..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("AUDIT-ROLE-LABELS-01 Web", () => {
  it("RL-17 Topbar : visibleRoleLabel puis remap displayRoleName (PARTIEL)", () => {
    const topbar = read("src/components/layout/Topbar.tsx");
    expect(topbar).toContain("visibleRoleLabel");
    expect(topbar).toContain("displayRoleName(visibleRoleLabel(user)");
    expect(visibleRoleLabel({ role: "Admin School", effectiveRoleLabel: "Directeur" })).toBe("Directeur");
  });

  it("RL-18 Users table : effectiveRoleLabel si présent", () => {
    const page = read("src/pages/UsersPage.tsx");
    expect(page).toContain("formatAccessRolesDisplay");
    expect(formatAccessRolesDisplay({ role: "Admin School", effectiveRoleLabel: "Directeur" })).toBe("Directeur");
    expect(page).toMatch(/user\.role/);
    expect(page).toContain("role.roleName");
  });

  it("RL-19 sélecteurs Users / création / attribution non branchés effectiveLabel", () => {
    const page = read("src/pages/UsersPage.tsx");
    expect(page).toContain("creatableRoles.map((role) => ({ value: role, label: role }))");
    expect(page).toContain("{role.roleName}");
    expect(page).not.toContain("listRoleDisplayLabels");
  });

  it("RL-20 PermissionsPage contrat 4 colonnes + reset", () => {
    const page = read("src/pages/PermissionsPage.tsx");
    expect(page).toContain("Rôle technique");
    expect(page).toContain("Libellé par défaut");
    expect(page).toContain("Libellé affiché");
    expect(page).toContain("Libellé effectif");
    expect(page).toContain("Restaurer le défaut");
    expect(page).toContain("updateRoleDisplayLabel");
    expect(page).toContain("resetRoleDisplayLabel");
  });

  it("SecuritySettings affiche user.role brut (écart P1)", () => {
    const page = read("src/pages/parametres/SecuritySettingsPage.tsx");
    expect(page).toContain('label="Rôle" value={user?.role}');
    expect(page).not.toContain("visibleRoleLabel");
  });

  it("preuve visuelle SCHOOL_ADMIN / STUDENT / TEACHER sans mutation", () => {
    expect(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: "Directeur" })).toBe("Directeur");
    expect(resolveEffectiveRoleLabel({ defaultLabel: "Élève / Étudiant", displayLabel: "Étudiant" })).toBe("Étudiant");
    expect(resolveEffectiveRoleLabel({ defaultLabel: "Enseignant", displayLabel: "Professeur" })).toBe("Professeur");
  });

  it("listRoleDisplayLabels API définie mais non consommée", () => {
    const api = read("src/lib/rbacApi.ts");
    expect(api).toContain("listRoleDisplayLabels");
    const src = read("src/pages/UsersPage.tsx") + read("src/pages/PermissionsPage.tsx") + read("src/components/layout/Topbar.tsx");
    expect(src).not.toContain("listRoleDisplayLabels(");
  });
});
