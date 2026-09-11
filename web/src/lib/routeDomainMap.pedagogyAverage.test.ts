import { describe, expect, it } from "vitest";
import { domainsForPath } from "./routeDomainMap";
import type { PermissionContext } from "./permissions";

function contextWithPermissions(permissions: string[]): PermissionContext {
  return {
    user: {
      id: "parent-1",
      role: "Parent",
      schoolCode: "SCH-001",
      permissions,
    } as PermissionContext["user"],
    rolePermissions: {},
    permissionsReady: true,
    permissionsBootstrap: "ready",
  };
}

describe("route /notes — dépendance coefficient des cours", () => {
  it("un lecteur Notes hydrate courses sans nécessiter Matières:READ", () => {
    const domains = domainsForPath("/notes", contextWithPermissions(["Notes:READ"]));
    expect(domains).toContain("notes");
    expect(domains).toContain("evaluations");
    expect(domains).toContain("courses");
  });

  it("un compte sans droit Notes ni Cours ne charge pas courses", () => {
    const domains = domainsForPath("/notes", contextWithPermissions([]));
    expect(domains).not.toContain("courses");
  });
});
