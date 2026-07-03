import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { renderConfiguredChart } from "./DashboardCharts";
import { ChartPanel } from "./DashboardCharts";
import type { EstablishmentChart, PlatformChart } from "../../lib/dashboardCharts";
import { formatChartTypeLabel } from "../../lib/chartTypes";
import {
  CHART_PERIOD_OPTIONS,
  normalizeChartPeriod,
  readChartPeriod,
  saveChartPeriod,
  type ChartPeriod,
} from "../../lib/chartPeriod";
import { applyPeriodToDashboardChart, type DashboardPeriodContext } from "../../lib/dashboardChartPeriod";
import {
  applyChartOrder,
  mergeChartOrder,
  saveChartOrder,
  type ChartOrderScope,
} from "../../lib/chartOrder";
import { Select } from "../ui/Field";

type ChartConfig = PlatformChart | EstablishmentChart;

function chartColSpanClass(chart: ChartConfig, period: ChartPeriod, periodContext: DashboardPeriodContext) {
  const applied = applyPeriodToDashboardChart(chart, period, periodContext);
  return (applied.type === "bar-horizontal" || applied.type === "stacked-bar") && applied.data.length > 6
    ? "lg:col-span-2"
    : "";
}

function DragHandle({
  label,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      aria-label={`Déplacer : ${label}`}
      title="Glisser pour réorganiser"
      className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-lg border border-line bg-white text-muted transition hover:border-brand/40 hover:text-brand active:cursor-grabbing"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
        <circle cx="5" cy="4" r="1.2" fill="currentColor" />
        <circle cx="11" cy="4" r="1.2" fill="currentColor" />
        <circle cx="5" cy="8" r="1.2" fill="currentColor" />
        <circle cx="11" cy="8" r="1.2" fill="currentColor" />
        <circle cx="5" cy="12" r="1.2" fill="currentColor" />
        <circle cx="11" cy="12" r="1.2" fill="currentColor" />
      </svg>
    </button>
  );
}

function DashboardChartCard({
  chart,
  period,
  onPeriodChange,
  periodContext,
  showTypeBadge,
  index,
  reorderable,
  onDragStart,
  onDragEnd,
}: {
  chart: ChartConfig;
  period: ChartPeriod;
  onPeriodChange: (period: ChartPeriod) => void;
  periodContext: DashboardPeriodContext;
  showTypeBadge: boolean;
  index: number;
  reorderable: boolean;
  onDragStart: (event: DragEvent<HTMLButtonElement>, index: number) => void;
  onDragEnd: () => void;
}) {
  const appliedChart = useMemo(
    () => applyPeriodToDashboardChart(chart, period, periodContext),
    [chart, period, periodContext],
  );

  const description =
    showTypeBadge && appliedChart.description
      ? `${appliedChart.description} · Type : ${formatChartTypeLabel(appliedChart.type)}`
      : showTypeBadge
        ? `Type : ${formatChartTypeLabel(appliedChart.type)}`
        : appliedChart.description;

  return (
    <ChartPanel
      title={appliedChart.title}
      description={description}
      height={appliedChart.type === "gauge" ? 240 : 300}
      leading={
        reorderable ? (
          <DragHandle
            label={appliedChart.title}
            onDragStart={(event) => onDragStart(event, index)}
            onDragEnd={onDragEnd}
          />
        ) : undefined
      }
      actions={
        <Select
          value={period}
          onChange={(event) => onPeriodChange(normalizeChartPeriod(event.target.value))}
          options={CHART_PERIOD_OPTIONS}
          aria-label={`Période pour ${appliedChart.title}`}
          className="min-w-[9.5rem] text-xs font-semibold"
        />
      }
    >
      {renderConfiguredChart(appliedChart)}
    </ChartPanel>
  );
}

function DashboardChartGridItem({
  chart,
  periodContext,
  showTypeBadge,
  index,
  reorderable,
  draggingIndex,
  overIndex,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDragLeave,
}: {
  chart: ChartConfig;
  periodContext: DashboardPeriodContext;
  showTypeBadge: boolean;
  index: number;
  reorderable: boolean;
  draggingIndex: number | null;
  overIndex: number | null;
  onDragStart: (event: DragEvent<HTMLButtonElement>, index: number) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDragLeave: (index: number) => void;
}) {
  const [period, setPeriod] = useState<ChartPeriod>(() => readChartPeriod(chart.id));

  useEffect(() => {
    setPeriod(readChartPeriod(chart.id));
  }, [chart.id]);

  const colSpanClass = useMemo(
    () => chartColSpanClass(chart, period, periodContext),
    [chart, period, periodContext],
  );

  function handlePeriodChange(next: ChartPeriod) {
    saveChartPeriod(chart.id, next);
    setPeriod(next);
  }

  return (
    <div
      className={`transition ${colSpanClass} ${
        draggingIndex === index ? "opacity-50" : ""
      } ${overIndex === index && draggingIndex !== index ? "ring-2 ring-brand/40 ring-offset-2 rounded-xl" : ""}`}
      onDragOver={(event) => onDragOver(event, index)}
      onDrop={(event) => onDrop(event, index)}
      onDragLeave={() => onDragLeave(index)}
    >
      <DashboardChartCard
        chart={chart}
        period={period}
        onPeriodChange={handlePeriodChange}
        periodContext={periodContext}
        showTypeBadge={showTypeBadge}
        index={index}
        reorderable={reorderable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    </div>
  );
}

export function DashboardChartGrid({
  charts,
  periodContext,
  orderScope,
  orderUserKey,
  showTypeBadge = false,
  emptyMessage = "Aucun graphique disponible pour votre rôle dans ce périmètre.",
}: {
  charts: ChartConfig[];
  periodContext: DashboardPeriodContext;
  orderScope: ChartOrderScope;
  orderUserKey?: string;
  showTypeBadge?: boolean;
  emptyMessage?: string;
}) {
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    applyChartOrder(charts, orderScope, orderUserKey).map((chart) => chart.id),
  );
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    setOrderedIds(applyChartOrder(charts, orderScope, orderUserKey).map((chart) => chart.id));
  }, [orderScope, orderUserKey]);

  useEffect(() => {
    setOrderedIds((previous) => mergeChartOrder(previous, charts.map((chart) => chart.id)));
  }, [charts]);

  const chartById = useMemo(() => new Map(charts.map((chart) => [chart.id, chart])), [charts]);

  const orderedCharts = useMemo(
    () =>
      orderedIds
        .map((id) => chartById.get(id))
        .filter((chart): chart is ChartConfig => Boolean(chart)),
    [orderedIds, chartById],
  );

  const reorderCharts = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
      setOrderedIds((previous) => {
        const next = [...previous];
        const [moved] = next.splice(fromIndex, 1);
        if (!moved) return previous;
        next.splice(toIndex, 0, moved);
        saveChartOrder(orderScope, orderUserKey, next);
        return next;
      });
    },
    [orderScope, orderUserKey],
  );

  const handleDragStart = useCallback((event: DragEvent<HTMLButtonElement>, index: number) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDraggingIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingIndex(null);
    setOverIndex(null);
  }, []);

  function handleDragOver(event: DragEvent<HTMLDivElement>, index: number) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (overIndex !== index) setOverIndex(index);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, toIndex: number) {
    event.preventDefault();
    const fromIndex = Number(event.dataTransfer.getData("text/plain"));
    if (!Number.isNaN(fromIndex)) reorderCharts(fromIndex, toIndex);
    setDraggingIndex(null);
    setOverIndex(null);
  }

  function resetOrder() {
    saveChartOrder(orderScope, orderUserKey, []);
    setOrderedIds(charts.map((chart) => chart.id));
  }

  const reorderable = orderedCharts.length > 1;

  if (!charts.length) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-slate-50/80 px-4 py-8 text-center text-sm font-semibold text-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reorderable ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-slate-50/80 px-4 py-2.5">
          <p className="text-xs font-semibold text-muted">
            Glissez les poignées pour réorganiser les graphiques selon votre préférence.
          </p>
          <button
            type="button"
            onClick={resetOrder}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink transition hover:border-brand/40 hover:text-brand"
          >
            Réinitialiser l&apos;ordre
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {orderedCharts.map((chart, index) => (
          <DashboardChartGridItem
            key={chart.id}
            chart={chart}
            periodContext={periodContext}
            showTypeBadge={showTypeBadge}
            index={index}
            reorderable={reorderable}
            draggingIndex={draggingIndex}
            overIndex={overIndex}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragLeave={(itemIndex) => {
              if (overIndex === itemIndex) setOverIndex(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}
