import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeRemoteSnapshot } from "./backofficeStateMerge";
import { canResetTargetUserPassword, canResetUserPassword, type PermissionContext } from "./permissions";
import { formatAccessRolesDisplay } from "./userAccounts";
import type { SessionUser, UserAccount } from "../types";
import { EMPTY_DASHBOARD_CHART_CONFIG } from "./chartTypes";

function ctx(user: Partial<SessionUser>): PermissionContext {
  return {
    user: user as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
  };
}

function baseState() {
  return {
    schools: [],
    users: [],
    countries: [],
    contacts: [],
    relations: [],
    subscriptions: [],
    notifications: [],
    students: [],
    teachers: [],
    classes: [],
    courses: [],
    assignments: [],
    courseSchedules: [],
    payments: [],
    presences: [],
    notes: [],
    evaluations: [],
    exams: [],
    bulletins: [],
    documents: [],
    announcements: [],
    messages: [],
    paymentStatuses: [],
    feeGrids: [],
    schoolFeeItems: [],
    studentFees: [],
    feeTariffHistory: [],
    rolePermissions: {},
    academicConfigs: {},
    dashboardChartConfig: EMPTY_DASHBOARD_CHART_CONFIG,
    auditLog: [],
  };
}

describe("ADMIN-04 Web — reset + displayLabel visuel", () => {
  it("mergeRemoteSnapshot conserve mustChangePassword distant après reset", () => {
    const prev = baseState();
    prev.users = [
      {
        id: "u1",
        identifier: "u1",
        mustChangePassword: false,
        hasTemporaryPassword: false,
      } as UserAccount,
    ];
    const merged = mergeRemoteSnapshot(
      prev,
      {
        users: [
          {
            id: "u1",
            identifier: "u1",
            mustChangePassword: true,
            hasTemporaryPassword: true,
          } as UserAccount,
        ],
      },
      { loadedKeys: ["users"] },
    );
    expect(merged.users[0].mustChangePassword).toBe(true);
    expect(merged.users[0].hasTemporaryPassword).toBe(true);
  });

  it("COUNTRY_PRIVILEGES autorise le reset d’un SCHOOL_ADMIN", () => {
    const country = ctx({
      role: "Admin Pays",
      countryCode: "CD",
      permissions: ["COUNTRY_PRIVILEGES"],
    });
    expect(canResetUserPassword(country)).toBe(true);
    expect(
      canResetTargetUserPassword(country, {
        role: "Admin School",
        roleKeys: ["SCHOOL_ADMIN"],
        countryCode: "CD",
        status: "Actif",
      } as UserAccount),
    ).toBe(true);
  });

  it("U04-18 displayLabel n’entre pas dans le rôle d’accès canonique", () => {
    const user = {
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      effectiveRoleLabel: "Directeur",
    } as UserAccount;
    expect(formatAccessRolesDisplay(user)).toBe("Directeur");
    expect(user.roleKeys).toEqual(["SCHOOL_ADMIN"]);
  });

  it("UsersPage recharge les users après reset", () => {
    const source = readFileSync(join(process.cwd(), "src/pages/UsersPage.tsx"), "utf8");
    const resetFn = source.slice(source.indexOf("async function resetPassword"), source.indexOf("async function handleSubmit"));
    expect(resetFn).toContain('refresh(["users"])');
    expect(resetFn).toContain("min. 8 caractères");
    expect(resetFn).not.toContain("min. 6 caractères");
  });
});
