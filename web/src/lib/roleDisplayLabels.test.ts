import { describe, expect, it } from "vitest";
import { normalizeDisplayLabel, resolveEffectiveRoleLabel, visibleRoleLabel } from "./roleDisplayLabels";

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
});
