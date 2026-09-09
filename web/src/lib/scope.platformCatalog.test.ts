import { describe, expect, it } from "vitest";
import type { SessionUser, UserAccount } from "../types";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { projectScopedUsers } from "./scope";
import { isSuperadminManagedUser } from "./userAccounts";

function stateOf(users: UserAccount[]) {
  return { users, schools: [], countries: [], subscriptions: [], notifications: [] };
}

describe("catalogue plateforme — défense Web (pas la protection principale)", () => {
  const unassignedIts: UserAccount = {
    id: "u-its",
    publicId: "CD-ITS-AB-26-00001",
    identityCode: "CD-ITS-AB-26-00001",
    firstName: "Idem",
    lastName: "Vide",
    role: "Sans affectation",
    assignmentStatus: "Sans affectation",
    accountKind: "unassigned",
    roleKeys: [],
    roles: [],
    schoolId: "school-a",
    schoolCode: "CD-ITS-26-001",
    status: "Actif",
  } as UserAccount;

  const adminSchool: UserAccount = {
    id: "u-admin",
    publicId: "CD-LAC-AD-26-00001",
    firstName: "Aline",
    lastName: "Admin",
    role: SCHOOL_ADMIN_ROLE,
    assignmentStatus: SCHOOL_ADMIN_ROLE,
    roleKeys: ["SCHOOL_ADMIN"],
    schoolId: "school-a",
    schoolCode: "CD-LAC-26-001",
    countryScope: "RDC",
    status: "Actif",
  } as UserAccount;

  it("un CD-ITS sans rôle n'est plus un compte géré Superadmin", () => {
    expect(isSuperadminManagedUser(unassignedIts)).toBe(false);
    expect(isSuperadminManagedUser(adminSchool)).toBe(true);
  });

  it("Administration Superadmin masque le CD-ITS sans rôle et garde Admin School", () => {
    const session = { role: SUPER_ADMIN_ROLE, schoolCode: "*" } as SessionUser;
    const projection = projectScopedUsers(session, stateOf([unassignedIts, adminSchool]));
    expect(projection.users.map((row) => row.id)).toEqual(["u-admin"]);
  });

  it("Administration Admin Pays ne garde que les Admin School du pays", () => {
    const session = {
      role: COUNTRY_ADMIN_ROLE,
      countryScope: "RDC",
      countryCode: "CD",
      schoolCode: "*",
    } as SessionUser;
    const projection = projectScopedUsers(
      session,
      {
        ...stateOf([unassignedIts, adminSchool]),
        schools: [{ code: "CD-LAC-26-001", name: "Lac", country: "RDC", countryCode: "CD" }],
      } as never,
    );
    expect(projection.users.map((row) => row.id)).toEqual(["u-admin"]);
  });
});
