import { describe, expect, it } from "vitest";
import { PLANNING_WEB_UI_ENABLED } from "./constants";
import { canReadView, type PermissionContext } from "./permissions";

const adminWithPlanning: PermissionContext = {
  user: {
    id: "admin-1",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    permissions: [
      "Planning de cours:READ",
      "Planning de cours:CREATE",
      "Planning de cours:UPDATE",
      "Planning de cours:DELETE",
    ],
  } as never,
  rolePermissions: {},
};

describe("Planning Web UI gelé (P0 API sans réexposition menu)", () => {
  it("PLANNING_WEB_UI_ENABLED reste false tant que l'EDT hebdomadaire V2 n'est pas reconstruit", () => {
    expect(PLANNING_WEB_UI_ENABLED).toBe(false);
  });

  it("canReadView(planning) refuse même avec Planning de cours:READ", () => {
    expect(canReadView(adminWithPlanning, "planning")).toBe(false);
  });
});
