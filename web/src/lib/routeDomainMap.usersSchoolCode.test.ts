import { describe, expect, it } from "vitest";
import { SUPER_ADMIN_ROLE } from "./orgHierarchy";
import type { PermissionContext } from "./permissions";
import { domainsForPath } from "./routeDomainMap";

const superAdminContext: PermissionContext = {
  user: {
    role: SUPER_ADMIN_ROLE,
    schoolCode: "*",
    permissions: ["ALL_PRIVILEGES"],
  },
  rolePermissions: {},
};

describe("domainsForPath — comptes utilisateurs", () => {
  it("charge schools avec users sur la route Superadmin pour résoudre le login_code canonique", () => {
    const domains = domainsForPath("/administration/utilisateurs", superAdminContext);

    expect(domains).toContain("users");
    expect(domains).toContain("schools");
  });
});
