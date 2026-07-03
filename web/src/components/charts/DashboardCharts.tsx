import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../ui/Card";
import { CHART_AXIS, CHART_PALETTE, CHART_TOOLTIP_STYLE } from "../../lib/chartTheme";
import type { ChartType } from "../../lib/chartTypes";

export interface ChartDatum {
  name: string;
  value: number;
  fill?: string;
}

export function ChartPanel({
  title,
  description,
  children,
  className = "",
  height = 280,
  leading,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  height?: number;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card className={`p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-ink">{title}</p>
            {description ? <p className="mt-1 text-xs font-semibold text-muted">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-4" style={{ width: "100%", height }}>
        {children}
      </div>
    </Card>
  );
}

export function VerticalBarChart({
  data,
  valueFormatter,
  layout = "vertical",
}: {
  data: ChartDatum[];
  valueFormatter?: (value: number) => string;
  layout?: "vertical" | "horizontal";
}) {
  if (!data.length) {
    return <EmptyChart message="Aucune donnée à afficher." />;
  }

  const horizontal = layout === "horizontal";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 12, left: horizontal ? 8 : 0, bottom: 0 }}
      >
        <CartesianGrid stroke={CHART_AXIS.grid} strokeDasharray="4 4" vertical={!horizontal} horizontal={horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={CHART_AXIS.tick} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={CHART_AXIS.tick} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" tick={CHART_AXIS.tick} />
            <YAxis tick={CHART_AXIS.tick} allowDecimals={false} />
          </>
        )}
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(value) => {
            const numeric = typeof value === "number" ? value : Number(value ?? 0);
            return [valueFormatter ? valueFormatter(numeric) : numeric, "Valeur"];
          }}
        />
        <Bar dataKey="value" radius={horizontal ? [0, 8, 8, 0] : [8, 8, 0, 0]} maxBarSize={48}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={entry.fill ?? CHART_PALETTE[index % CHART_PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({
  data,
  innerRadius = 58,
  outerRadius = 88,
}: {
  data: ChartDatum[];
  innerRadius?: number;
  outerRadius?: number;
}) {
  if (!data.length || data.every((item) => item.value === 0)) {
    return <EmptyChart message="Aucune donnée à afficher." />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={2}
        >
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={entry.fill ?? CHART_PALETTE[index % CHART_PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 600 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function GaugeChart({ value, label, max = 100 }: { value: number; label: string; max?: number }) {
  const clamped = Math.max(0, Math.min(max, value));
  const data = [{ name: label, value: clamped, fill: CHART_PALETTE[0] }];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadialBarChart
        cx="50%"
        cy="55%"
        innerRadius="68%"
        outerRadius="100%"
        barSize={14}
        data={data}
        startAngle={180}
        endAngle={0}
      >
        <RadialBar background={{ fill: "#f1f5f9" }} dataKey="value" cornerRadius={10} />
        <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className="fill-ink text-2xl font-black">
          {Math.round(clamped)}%
        </text>
        <text x="50%" y="68%" textAnchor="middle" dominantBaseline="middle" className="fill-muted text-xs font-bold">
          {label}
        </text>
      </RadialBarChart>
    </ResponsiveContainer>
  );
}

export function PieChartFull({ data }: { data: ChartDatum[] }) {
  return <DonutChart data={data} innerRadius={0} outerRadius={92} />;
}

export function LineTrendChart({ data }: { data: ChartDatum[] }) {
  if (!data.length) {
    return <EmptyChart message="Aucune donnée à afficher." />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART_AXIS.grid} strokeDasharray="4 4" />
        <XAxis dataKey="name" tick={CHART_AXIS.tick} />
        <YAxis tick={CHART_AXIS.tick} allowDecimals={false} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
        <Line
          type="monotone"
          dataKey="value"
          stroke={CHART_PALETTE[0]}
          strokeWidth={3}
          dot={{ r: 4, fill: CHART_PALETTE[0] }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function AreaTrendChart({ data }: { data: ChartDatum[] }) {
  if (!data.length) {
    return <EmptyChart message="Aucune donnée à afficher." />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART_AXIS.grid} strokeDasharray="4 4" />
        <XAxis dataKey="name" tick={CHART_AXIS.tick} />
        <YAxis tick={CHART_AXIS.tick} allowDecimals={false} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={CHART_PALETTE[0]}
          fill={CHART_PALETTE[0]}
          fillOpacity={0.2}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function toStackedRows(data: ChartDatum[]) {
  const row: Record<string, string | number> = { name: "Total" };
  for (const item of data) {
    row[item.name] = item.value;
  }
  return [row];
}

export function StackedBarChartView({ data, horizontal = false }: { data: ChartDatum[]; horizontal?: boolean }) {
  if (!data.length) {
    return <EmptyChart message="Aucune donnée à afficher." />;
  }

  const rows = toStackedRows(data);
  const keys = data.map((item) => item.name);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 12, left: horizontal ? 8 : 0, bottom: 0 }}
      >
        <CartesianGrid stroke={CHART_AXIS.grid} strokeDasharray="4 4" />
        {horizontal ? (
          <>
            <XAxis type="number" tick={CHART_AXIS.tick} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={CHART_AXIS.tick} width={72} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" tick={CHART_AXIS.tick} />
            <YAxis tick={CHART_AXIS.tick} allowDecimals={false} />
          </>
        )}
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
        <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 12, fontWeight: 600 }} />
        {keys.map((key, index) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="stack"
            fill={data[index]?.fill ?? CHART_PALETTE[index % CHART_PALETTE.length]}
            radius={index === keys.length - 1 ? [8, 8, 0, 0] : [0, 0, 0, 0]}
            maxBarSize={48}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function gaugeChartAsData(gaugeValue?: number, gaugeLabel?: string): ChartDatum[] {
  if (gaugeValue == null) return [];
  return [{ name: gaugeLabel ?? "Indicateur", value: gaugeValue, fill: CHART_PALETTE[0] }];
}

export interface RenderableChart {
  type: ChartType;
  data: ChartDatum[];
  gaugeValue?: number;
  gaugeLabel?: string;
}

export function renderConfiguredChart(chart: RenderableChart) {
  const data =
    chart.data.length > 0
      ? chart.data
      : chart.type !== "gauge"
        ? gaugeChartAsData(chart.gaugeValue, chart.gaugeLabel)
        : chart.data;

  switch (chart.type) {
    case "line":
      return <LineTrendChart data={data} />;
    case "bar":
      return <VerticalBarChart data={data} />;
    case "bar-horizontal":
      return <VerticalBarChart data={data} layout="horizontal" />;
    case "donut":
      return <DonutChart data={data} />;
    case "pie":
      return <PieChartFull data={data} />;
    case "area":
      return <AreaTrendChart data={data} />;
    case "stacked-bar":
      return <StackedBarChartView data={data} />;
    case "gauge":
      return <GaugeChart value={chart.gaugeValue ?? 0} label={chart.gaugeLabel ?? "Indicateur"} />;
    default:
      return null;
  }
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-line bg-slate-50/80 px-4 text-center text-sm font-semibold text-muted">
      {message}
    </div>
  );
}

export function KpiSparkGrid({
  items,
}: {
  items: Array<{ label: string; value: string | number; hint?: string }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-line bg-slate-50/70 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{item.label}</p>
          <p className="mt-1 text-xl font-black text-ink">{item.value}</p>
          {item.hint ? <p className="mt-0.5 text-[11px] font-semibold text-muted">{item.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
