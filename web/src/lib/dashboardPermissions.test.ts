import { describe, expect, it } from "vitest";
import type { BackOfficeState, SessionUser } from "../types";
import {
  filterEstablishmentDashboardCharts,
  filterOperationsChartData,
} from "./dashboardPermissions";
import type { EstablishmentChart } from "./dashboardCharts";
import type { PermissionContext } from "./permissions";
import { applyPeriodToDashboardChart } from "./dashboardChartPeriod";

function ctx(permissions: string[]): PermissionContext {
  return {
    user: {
      id: "u-rbac",
      role: "Enseignant",
      schoolCode: "CD-IN-26-001",
      permissions,
    } as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
  };
}

function operationsChart(id: "operations" | "operations-default" = "operations"): EstablishmentChart {
  return {
    id,
    title: "Activité administrative",
    description: "Utilisateurs, documents, présences et messages.",
    type: "bar",
    data: [
      { name: "Utilisateurs actifs", value: 10 },
      { name: "Documents", value: 3 },
      { name: "Présences", value: 8 },
      { name: "Messages", value: 2 },
      { name: "Alertes à traiter", value: 4 },
    ],
  };
}

describe("Lot J P1 — RBAC graphiques operations mixtes", () => {
  it("Notifications:READ seul n'ouvre pas operations / operations-default", () => {
    const notificationsOnly = ctx(["Notifications:READ"]);
    expect(filterEstablishmentDashboardCharts([operationsChart("operations")], notificationsOnly)).toEqual([]);
    expect(
      filterEstablishmentDashboardCharts([operationsChart("operations-default")], notificationsOnly),
    ).toEqual([]);
  });

  it("Alertes à traiter n'est exposé qu'avec Notifications:READ", () => {
    const usersOnly = ctx(["Utilisateurs:READ"]);
    const names = filterEstablishmentDashboardCharts([operationsChart()], usersOnly)[0]?.data.map((item) => item.name);
    expect(names).toEqual(["Utilisateurs actifs"]);
    expect(names).not.toContain("Alertes à traiter");
    expect(names).not.toContain("Documents");
    expect(names).not.toContain("Présences");
    expect(names).not.toContain("Messages");
  });

  it("Notifications:READ n'élargit pas les autres agrégats quand le graphique est déjà ouvert", () => {
    const mixed = ctx(["Utilisateurs:READ", "Notifications:READ"]);
    const names = filterEstablishmentDashboardCharts([operationsChart()], mixed)[0]?.data.map((item) => item.name);
    expect(names).toEqual(["Utilisateurs actifs", "Alertes à traiter"]);
  });

  it("sans contexte, Alertes à traiter est retiré (fail-closed)", () => {
    const names = filterOperationsChartData(operationsChart().data, null).map((item) => item.name);
    expect(names).not.toContain("Alertes à traiter");
    expect(names).toContain("Utilisateurs actifs");
  });

  it("le filtre période ne réintroduit pas Alertes à traiter sans Notifications:READ", () => {
    const permissionCtx = ctx(["Utilisateurs:READ"]);
    const filtered = filterEstablishmentDashboardCharts([operationsChart()], permissionCtx)[0];
    expect(filtered).toBeDefined();
    const applied = applyPeriodToDashboardChart(filtered!, "monthly", {
      user: permissionCtx.user,
      state: {
        schools: [],
        users: [],
        students: [],
        teachers: [],
        notes: [],
        presences: [],
        payments: [],
        exams: [],
        bulletins: [],
        documents: [],
        messages: [],
        announcements: [],
      } as unknown as BackOfficeState,
      scope: "establishment",
      schoolUnreadCount: 9,
      permissionCtx,
    });
    const names = applied.data.map((item) => item.name);
    expect(names).not.toContain("Alertes à traiter");
    expect(names).toContain("Utilisateurs actifs");
  });
});