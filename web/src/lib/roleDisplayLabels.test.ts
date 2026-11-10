import { describe, expect, it } from "vitest";
import {
  decorateAssignableRoles,
  formatVisibleRoleLabels,
  normalizeDisplayLabel,
  resolveEffectiveRoleLabel,
  uniqueRolesByRoleKey,
  visibleRoleLabel,
  visibleRoleLabels,
} from "./roleDisplayLabels";

describe("roleDisplayLabels — résolution unique", () => {
  it("normalise vide vers NULL", () => {
    expect(normalizeDisplayLabel("")).toBeNull();
    expect(normalizeDisplayLabel("   ")).toBeNull();
    expect(normalizeDisplayLabel("Directeur")).toBe("Directeur");
  });

  it("effectiveLabel = display trim sinon defaultLabel", () => {
    expect(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: "Directeur" })).toBe("Directeur");
    expect(resolveEffectiveRoleLabel({ defaultLabel: "Admin School", displayLabel: null })).toBe("Admin School");
    expect(resolveEffectiveRoleLabel({ roleName: "Admin School", displayLabel: "" })).toBe("Admin School");
  });

  it("visibleRoleLabel lit effectiveRoleLabel sans toucher au rôle canonique", () => {
    expect(visibleRoleLabel({ role: "Admin School", effectiveRoleLabel: "Directeur" })).toBe("Directeur");
    expect(visibleRoleLabel({ role: "Admin School" })).toBe("Admin School");
  });

  it("visibleRoleLabels préserve l'ordre roleKeys et le contrat multi-rôle", () => {
    expect(
      visibleRoleLabels({
        roleKey: "TEACHER",
        roleKeys: ["TEACHER", "SCHOOL_ADMIN"],
        effectiveRoleLabels: [
          { roleKey: "TEACHER", defaultLabel: "Enseignant", displayLabel: "Professeur", effectiveLabel: "Professeur" },
          { roleKey: "SCHOOL_ADMIN", defaultLabel: "Admin School", displayLabel: "Directeur", effectiveLabel: "Directeur" },
        ],
      }),
    ).toEqual(["Professeur", "Directeur"]);
    expect(
      formatVisibleRoleLabels({
        roleKey: "TEACHER",
        roleKeys: ["TEACHER", "SCHOOL_ADMIN"],
        effectiveRoleLabel: "Professeur",
      }),
    ).toBe("Professeur · Admin School");
  });

  it("déduplique et désambiguïse par roleKey, jamais par libellé", () => {
    const roles = uniqueRolesByRoleKey([
      { roleKey: "SCHOOL_ADMIN", roleName: "Admin School" },
      { roleKey: "SCHOOL_ADMIN", roleName: "Directeur" },
      { roleKey: "PRINCIPAL", roleName: "Directeur" },
    ]);
    expect(roles.map((row) => row.roleKey)).toEqual(["SCHOOL_ADMIN", "PRINCIPAL"]);
    const decorated = decorateAssignableRoles(
      [
        { roleKey: "SCHOOL_ADMIN", roleName: "Admin School" },
        { roleKey: "PRINCIPAL", roleName: "Directeur" },
      ],
      new Map([
        ["SCHOOL_ADMIN", { roleKey: "SCHOOL_ADMIN", defaultLabel: "Admin School", displayLabel: "Directeur", effectiveLabel: "Directeur" }],
        ["PRINCIPAL", { roleKey: "PRINCIPAL", defaultLabel: "Directeur", displayLabel: "Directeur", effectiveLabel: "Directeur" }],
      ]),
    );
    expect(decorated).toHaveLength(2);
    expect(decorated[0].optionLabel).toContain("Admin School");
    expect(decorated[1].optionLabel).toContain("Directeur");
  });
});
