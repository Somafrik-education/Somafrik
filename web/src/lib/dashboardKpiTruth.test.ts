import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTIVE_USERS_KPI_LABEL } from "./format";
import { getLiveKpis } from "./scope";
import type { SessionUser, UserAccount } from "../types";

const here = dirname(fileURLToPath(import.meta.url));

const KPI_SCHOOL_ID = "school-kpi-1";

function schoolAdmin(): SessionUser {
  return {
    id: "admin-1",
    firstName: "Admin",
    lastName: "École",
    role: "Admin School",
    schoolCode: "CD-IN-26-001",
    schoolPublicCode: "CD-IN-26-001",
    schoolId: KPI_SCHOOL_ID,
    identifier: "admin",
  } as SessionUser;
}

function user(partial: Partial<UserAccount> & { status?: string }): UserAccount {
  return {
    id: partial.id ?? "u",
    firstName: "A",
    lastName: "B",
    role: "Enseignant",
    schoolCode: "CD-IN-26-001",
    schoolPublicCode: "CD-IN-26-001",
    schoolId: KPI_SCHOOL_ID,
    identifier: partial.identifier ?? "id",
    status: partial.status ?? "Actif",
    ...partial,
  } as UserAccount;
}

describe("KPI Web Utilisateurs actifs", () => {
  it("libellé getLiveKpis = Utilisateurs actifs et exclut archivé/suspendu/désactivé", () => {
    const seventeen = Array.from({ length: 17 }, (_, index) =>
      user({ id: `u-${index}`, identifier: `id-${index}`, status: "Actif" }),
    );
    const emptyState = {
      schools: [],
      users: seventeen,
      countries: [],
      subscriptions: [],
      notifications: [],
    };
    const kpis = getLiveKpis(schoolAdmin(), emptyState);
    const active = kpis.find((item) => item.label === ACTIVE_USERS_KPI_LABEL);
    expect(active).toBeDefined();
    expect(active?.label).toBe("Utilisateurs actifs");
    expect(active?.value).toBe(17);

    const withArchived = seventeen.map((row, index) =>
      index === 0 ? { ...row, status: "Archivé" } : row,
    );
    expect(
      getLiveKpis(schoolAdmin(), { ...emptyState, users: withArchived }).find(
        (item) => item.label === ACTIVE_USERS_KPI_LABEL,
      )?.value,
    ).toBe(16);

    const withSuspended = seventeen.map((row, index) =>
      index === 0 ? { ...row, status: "Suspendu" } : row,
    );
    expect(
      getLiveKpis(schoolAdmin(), { ...emptyState, users: withSuspended }).find(
        (item) => item.label === ACTIVE_USERS_KPI_LABEL,
      )?.value,
    ).toBe(16);

    const withDisabled = seventeen.map((row, index) =>
      index === 0 ? { ...row, status: "Désactivé" } : row,
    );
    expect(
      getLiveKpis(schoolAdmin(), { ...emptyState, users: withDisabled }).find(
        (item) => item.label === ACTIVE_USERS_KPI_LABEL,
      )?.value,
    ).toBe(16);
  });

  it("garde-fou source : KPIs actifs nommés Utilisateurs actifs, jamais Utilisateurs", () => {
    const dashboardCharts = readFileSync(join(here, "dashboardCharts.ts"), "utf8");
    expect(dashboardCharts).toContain("label: ACTIVE_USERS_KPI_LABEL, value: formatMetric(metrics.activeUsers)");
    expect(dashboardCharts).not.toMatch(/label: "Utilisateurs", value: formatMetric\(metrics\.activeUsers\)/);
    expect(dashboardCharts).toContain("label: TODAY_PRESENCE_KPI_LABEL, value: extras.todayPresenceValue");
    expect(dashboardCharts).toContain("label: PAYMENT_RATE_KPI_LABEL, value: extras.paymentRateValue");
    expect(dashboardCharts).toContain("formatPaymentRateKpi(scopedStudentFees(user, state))");
    expect(dashboardCharts).not.toMatch(/paid \/ payments\.length/);
    expect(dashboardCharts).not.toMatch(/function formatPaymentRate\(payments/);
    expect(dashboardCharts).not.toMatch(/label: "Présences", value: formatMetric\(metrics\.presences\)/);

    const overview = readFileSync(
      join(here, "../pages/etablissement/EtablissementOverviewPage.tsx"),
      "utf8",
    );
    expect(overview).toContain("label: ACTIVE_USERS_KPI_LABEL");
    expect(overview).toContain("count: metrics.activeUsers");
    expect(overview).not.toMatch(/label: "Comptes utilisateurs"[\s\S]{0,80}count: metrics\.activeUsers/);
  });
});
