import { describe, expect, it } from "vitest";
import { visibleNavItemsForRole } from "./useVisibleNavItems";
import { canReadView, type PermissionContext } from "../../lib/permissions";

const ctx = (permissions: string[]): PermissionContext => ({
  user: { id: "school-user", role: "school_admin", schoolCode: "TEST-SCHOOL", permissions },
  rolePermissions: {},
  permissionsReady: true,
});

describe("PLANNING-EXAMS #1101 — navigation isolée par droits", () => {
  it("ne présente plus Examens comme module autonome", () => {
    const links = visibleNavItemsForRole(ctx(["Planning de cours:READ", "Examens:READ"]), "school_admin");
    expect(links.some((link) => link.path === "/examens")).toBe(false);
    expect(links.filter((link) => link.path === "/planning")).toHaveLength(1);
  });
  it("conserve le point d'accès Planning pour Examens-only sans accorder Planning.READ", () => {
    const user = ctx(["Examens:READ"]);
    expect(canReadView(user, "exams")).toBe(true);
    expect(canReadView(user, "planning")).toBe(false);
    const links = visibleNavItemsForRole(user, "school_admin");
    expect(links.some((link) => link.path === "/planning")).toBe(true);
    expect(links.some((link) => link.path === "/examens")).toBe(false);
  });
  it("ne donne pas Exams.READ aux utilisateurs Planning-only", () => {
    const user = ctx(["Planning de cours:READ"]);
    expect(canReadView(user, "planning")).toBe(true);
    expect(canReadView(user, "exams")).toBe(false);
  });
  it("reste fermé sans aucun droit", () => {
    const links = visibleNavItemsForRole(ctx([]), "school_admin");
    expect(links.some((link) => link.path === "/planning")).toBe(false);
  });
});
