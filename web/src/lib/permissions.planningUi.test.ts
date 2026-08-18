import { describe, expect, it } from "vitest";
import { PLANNING_WEB_UI_ENABLED } from "./constants";
import { canReadView, type PermissionContext } from "./permissions";

function ctx(role: string, permissions: string[]): PermissionContext {
  return {
    user: {
      id: `${role}-1`,
      role,
      schoolCode: "CD-2026-0001",
      permissions,
    } as never,
    rolePermissions: {},
  };
}

const planningRead = ["Planning de cours:READ"];
const planningCrud = [
  "Planning de cours:READ",
  "Planning de cours:CREATE",
  "Planning de cours:UPDATE",
  "Planning de cours:DELETE",
];

describe("Planning V2 — réexposition Web contrôlée", () => {
  it("PLANNING_WEB_UI_ENABLED est true", () => {
    expect(PLANNING_WEB_UI_ENABLED).toBe(true);
  });

  it("Admin School avec Planning de cours:READ voit /planning", () => {
    expect(canReadView(ctx("Admin School", planningCrud), "planning")).toBe(true);
  });

  it("Préfet avec READ voit /planning", () => {
    expect(canReadView(ctx("Préfet des études", planningRead), "planning")).toBe(true);
  });

  it("Enseignant avec READ voit /planning (écritures UI toujours gated par CREATE)", () => {
    expect(canReadView(ctx("Enseignant", planningRead), "planning")).toBe(true);
  });

  it("sans jeton Planning de cours:READ le menu reste masqué", () => {
    expect(canReadView(ctx("Admin School", ["Notes:READ"]), "planning")).toBe(false);
  });

  it("Parent ne voit pas /planning", () => {
    expect(canReadView(ctx("Parent", []), "planning")).toBe(false);
  });

  it("Secrétaire sans grant Planning ne voit pas /planning", () => {
    expect(canReadView(ctx("Secrétaire", ["Élèves:READ"]), "planning")).toBe(false);
  });

  it("Super Admin ne voit pas le planning établissement", () => {
    expect(canReadView(ctx("Super Administrateur Somafrik", planningCrud), "planning")).toBe(false);
  });
});
