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
  it("RL-17 Topbar : visibleRoleLabel sans remap displayRoleName", () => {
    const topbar = read("src/components/layout/Topbar.tsx");
    expect(topbar).toContain("visibleRoleLabel");
    expect(topbar).not.toContain("displayRoleName(visibleRoleLabel");
    expect(visibleRoleLabel({ role: "Admin School", effectiveRoleLabel: "Directeur" })).toBe("Directeur");
  });

  it("RL-18 Users table : effectiveRoleLabel si présent", () => {
    const page = read("src/pages/UsersPage.tsx");
    expect(page).toContain("formatAccessRolesDisplay");
    expect(formatAccessRolesDisplay({ role: "Admin School", effectiveRoleLabel: "Directeur" })).toBe("Directeur");
    expect(page).toMatch(/user\.role/);
    expect(page).toContain("role.roleName");
  });

  it("RL-19 sélecteurs Users / création / attribution branchés roleKey + effectiveLabel", () => {
    const page = read("src/pages/UsersPage.tsx");
    expect(page).toContain("listRoleDisplayLabels");
    expect(page).toContain("value: r.roleKey");
    expect(page).toContain("role.optionLabel");
    expect(page).not.toContain("creatableRoles.map((role) => ({ value: role, label: role }))");
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

  it("SecuritySettings affiche visibleRoleLabel / formatVisibleRoleLabels", () => {
    const page = read("src/pages/parametres/SecuritySettingsPage.tsx");
    expect(page).toContain("visibleRoleLabel");
    expect(page).toContain("formatVisibleRoleLabels");
    expect(page).not.toContain('label="Rôle" value={user?.role}');
  });

  it("preuve visuelle SCHOOL_ADMIN / STUDENT / TEACHER sans mutation", () => {
    expect(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: "Directeur" })).toBe("Directeur");
    expect(resolveEffectiveRoleLabel({ defaultLabel: "Élève / Étudiant", displayLabel: "Étudiant" })).toBe("Étudiant");
    expect(resolveEffectiveRoleLabel({ defaultLabel: "Enseignant", displayLabel: "Professeur" })).toBe("Professeur");
  });

  it("listRoleDisplayLabels consommée par les sélecteurs Utilisateurs", () => {
    const api = read("src/lib/rbacApi.ts");
    expect(api).toContain("listRoleDisplayLabels");
    expect(read("src/pages/UsersPage.tsx")).toContain("listRoleDisplayLabels(");
  });
});
