import { describe, expect, it } from "vitest";
import { DASHBOARD_METRIC_DOMAINS, mutationRefreshesDashboard } from "./dashboardSync";

describe("synchronisation tableau de bord", () => {
  it("rafraîchit les cinq écritures métier et ignore la lecture", () => {
    expect(mutationRefreshesDashboard("POST", "/classes")).toBe(true);
    expect(mutationRefreshesDashboard("POST", "/classes/CLS-1/students")).toBe(true);
    expect(mutationRefreshesDashboard("POST", "/presences")).toBe(true);
    expect(mutationRefreshesDashboard("PATCH", "/course-schedules/slot-1")).toBe(true);
    expect(mutationRefreshesDashboard("POST", "/payments")).toBe(true);
    expect(mutationRefreshesDashboard("GET", "/payments")).toBe(false);
    expect(mutationRefreshesDashboard("POST", "/finance/payment-methods")).toBe(false);
  });

  it("les indicateurs relus couvrent élèves, classes, présences et recettes", () => {
    expect(DASHBOARD_METRIC_DOMAINS).toEqual([
      "students",
      "teachers",
      "classes",
      "presences",
      "payments",
      "studentFees",
    ]);
  });
});
