import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ChartPeriod } from "./chartPeriod";
import {
  DASHBOARD_KPI_INTERVAL_MS,
  DASHBOARD_KPI_REFRESH_EVENT,
  DASHBOARD_SYNC_EVENT,
  dashboardDataIsStale,
} from "./dashboardSync";
import { isSchoolKpiPayload, type SchoolKpiPayload } from "./schoolDashboardKpi";

type RefreshReason = "mount" | "interval" | "visible" | "mutation" | "manual";

export function useSchoolDashboardKpis(enabled: boolean, period: ChartPeriod) {
  const [payload, setPayload] = useState<SchoolKpiPayload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let inflight = false;
    let queued = false;
    let lastSuccessAt: number | null = null;
    let timer = 0;

    const run = async (reason: RefreshReason) => {
      if (cancelled) return;
      const hidden = typeof document !== "undefined" && document.hidden;
      if (hidden && reason !== "manual") {
        if (reason === "mutation") queued = true;
        return;
      }
      if (reason === "visible" && !dashboardDataIsStale(lastSuccessAt, Date.now(), DASHBOARD_KPI_INTERVAL_MS)) {
        return;
      }
      if (inflight) {
        queued = true;
        return;
      }
      inflight = true;
      const requested = period;
      try {
        const body = await api.get<unknown>(`/dashboard/school-kpis?period=${encodeURIComponent(requested)}`);
        if (cancelled) return;
        if (!isSchoolKpiPayload(body) || body.period !== requested) {
          setError(true);
          return;
        }
        setPayload(body);
        setError(false);
        lastSuccessAt = Date.now();
      } catch {
        if (!cancelled) setError(true);
      } finally {
        inflight = false;
        if (queued && !cancelled) {
          queued = false;
          void run("mutation");
        }
      }
    };

    const arm = () => {
      window.clearInterval(timer);
      if (typeof document !== "undefined" && document.hidden) return;
      timer = window.setInterval(() => void run("interval"), DASHBOARD_KPI_INTERVAL_MS);
    };

    void run("mount");
    arm();

    const onVisible = () => {
      if (typeof document !== "undefined" && document.hidden) {
        window.clearInterval(timer);
        return;
      }
      const reason: RefreshReason = queued ? "mutation" : "visible";
      queued = false;
      void run(reason);
      arm();
    };
    const onMutation = () => void run("mutation");
    const onManual = () => void run("manual");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener(DASHBOARD_SYNC_EVENT, onMutation);
    window.addEventListener(DASHBOARD_KPI_REFRESH_EVENT, onManual);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener(DASHBOARD_SYNC_EVENT, onMutation);
      window.removeEventListener(DASHBOARD_KPI_REFRESH_EVENT, onManual);
    };
  }, [enabled, period]);

  return { payload: enabled ? payload : null, error: enabled ? error : false };
}
