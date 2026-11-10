import type { ChartDatum } from "../components/charts/DashboardCharts";
import type { EstablishmentChart } from "./dashboardCharts";
import { CHART_COLORS } from "./chartTheme";
import { ACTIVE_USERS_KPI_LABEL, getEstablishmentChartProfile } from "./format";
import type { TodayPresenceKpi } from "./presenceMetrics";

export type SchoolKpiLevel = { name: string; value: number };
export type SchoolKpiRevenue = {
  display: string;
  currency: string | null;
  amount: number | null;
};
export type SchoolKpiRate = {
  label: string;
  value: string;
  rate: number | null;
  expectedAmount: number;
  collectedAmount: number;
};
export type SchoolKpiPresenceSeries = {
  present: number;
  absent: number;
  late: number;
  justified: number;
  total: number;
  rate: number;
};

export type SchoolKpiPayload = {
  schoolId: string;
  generatedAt: string;
  period: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  periodLabel: string;
  timeZone: string;
  cards: {
    students: number | null;
    teachers: number | null;
    classes: number | null;
    revenue: SchoolKpiRevenue | null;
    levels: SchoolKpiLevel[] | null;
    attendance: TodayPresenceKpi | null;
    paymentRate: SchoolKpiRate | null;
  };
  series: {
    activeStudents: number | null;
    periodClasses: number | null;
    teachers: number | null;
    notes: number | null;
    exams: number | null;
    bulletins: number | null;
    pendingBulletins: number | null;
    documents: number | null;
    presences: number | null;
    activeUsers: number | null;
    announcements: number | null;
    presence: SchoolKpiPresenceSeries | null;
    paymentStatus: SchoolKpiLevel[] | null;
    paymentAmounts: SchoolKpiLevel[] | null;
    classSizes: SchoolKpiLevel[] | null;
    notesBySubject: SchoolKpiLevel[] | null;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isSchoolKpiPayload(value: unknown): value is SchoolKpiPayload {
  if (!isRecord(value) || !isRecord(value.cards) || !isRecord(value.series)) return false;
  return typeof value.schoolId === "string" && typeof value.period === "string" && typeof value.periodLabel === "string";
}

function bar(name: string, value: number | null, fill: string): ChartDatum | null {
  if (value == null) return null;
  return { name, value, fill };
}

function chart(
  id: string,
  title: string,
  description: string,
  type: EstablishmentChart["type"],
  data: ChartDatum[],
  periodLabel: string,
  gaugeValue?: number,
  gaugeLabel?: string,
): EstablishmentChart {
  return {
    id,
    title,
    description: `${description} · ${periodLabel}`,
    type,
    data,
    gaugeValue,
    gaugeLabel,
  };
}

export function buildEstablishmentChartsFromKpis(
  payload: SchoolKpiPayload,
  role: string | undefined,
  schoolUnreadCount: number,
): EstablishmentChart[] {
  const profile = getEstablishmentChartProfile(role);
  const series = payload.series;
  const periodLabel = payload.periodLabel;
  const scolarite = [
    bar("Élèves", series.activeStudents, CHART_COLORS.brand),
    bar("Enseignants", series.teachers, CHART_COLORS.teal),
    bar("Classes", series.periodClasses, CHART_COLORS.emerald),
  ].filter((item): item is ChartDatum => item !== null);
  const academic = [
    bar("Notes", series.notes, CHART_COLORS.brand),
    bar("Examens", series.exams, CHART_COLORS.teal),
    bar("Bulletins", series.bulletins, CHART_COLORS.violet),
    bar("À valider", series.pendingBulletins, CHART_COLORS.amber),
  ].filter((item): item is ChartDatum => item !== null);
  const operations = [
    bar(ACTIVE_USERS_KPI_LABEL, series.activeUsers, CHART_COLORS.brand),
    bar("Documents", series.documents, CHART_COLORS.teal),
    bar("Présences", series.presences, CHART_COLORS.emerald),
    bar("Annonces", series.announcements, CHART_COLORS.violet),
    { name: "Alertes à traiter", value: Math.max(0, Math.floor(schoolUnreadCount)), fill: CHART_COLORS.rose },
  ].filter((item): item is ChartDatum => item !== null);
  const presence = series.presence;
  const presenceDonut: ChartDatum[] = presence
    ? [
        { name: "Présents", value: presence.present, fill: CHART_COLORS.emerald },
        { name: "Absents", value: presence.absent, fill: CHART_COLORS.rose },
        { name: "Retards", value: presence.late, fill: CHART_COLORS.amber },
        { name: "Justifiés", value: presence.justified, fill: CHART_COLORS.brandLight },
      ]
    : [];
  const charts: EstablishmentChart[] = [];
  const pushScolarite = (id: string, title: string, description: string) => {
    if (scolarite.length) charts.push(chart(id, title, description, "bar", scolarite, periodLabel));
  };

  if (profile === "academic") {
    if (academic.length) charts.push(chart("academic-bar", "Pilotage pédagogique", "Notes, examens et bulletins.", "bar", academic, periodLabel));
    pushScolarite("scolarite", "Effectifs", "Élèves, enseignants et classes.");
    if (series.notesBySubject?.length) {
      charts.push(chart("notes-course", "Notes par cours", "Volume d'évaluations saisies.", "bar-horizontal", series.notesBySubject, periodLabel));
    }
    if (presence && presence.total > 0) {
      charts.push(chart("presence-rate", "Taux de présence", "Synthèse des enregistrements.", "gauge", [], periodLabel, presence.rate, "Présence"));
      charts.push(chart("presence-donut", "Répartition des présences", "Présents, absents, retards et justifiés.", "donut", presenceDonut, periodLabel));
    }
  } else if (profile === "finance") {
    if (series.paymentStatus?.length) {
      charts.push(chart("payments-status", "Paiements par statut", "Suivi des encaissements.", "donut", series.paymentStatus, periodLabel));
    }
    if (series.paymentAmounts?.length) {
      charts.push(chart("payments-amount", "Montants par statut", "Montants cumulés.", "bar", series.paymentAmounts, periodLabel));
    }
    pushScolarite("scolarite-finance", "Effectifs facturables", "Élèves et classes suivis.");
  } else if (profile === "operations") {
    charts.push(chart("operations", "Activité administrative", "Utilisateurs, documents, présences et messages.", "bar", operations, periodLabel));
    pushScolarite("scolarite-ops", "Scolarité", "Effectifs de l'établissement.");
    if (series.classSizes?.length) {
      charts.push(chart("class-sizes", "Élèves par classe", "Répartition des effectifs.", "bar-horizontal", series.classSizes, periodLabel));
    }
  } else {
    pushScolarite("scolarite", "Scolarité", "Élèves, enseignants et classes.");
    if (academic.length) charts.push(chart("academic", "Pédagogie", "Notes, examens et bulletins.", "bar", academic, periodLabel));
    charts.push(chart("operations-default", "Administration", "Utilisateurs, documents et présences.", "bar", operations, periodLabel));
    if (series.paymentStatus?.some((item) => item.value > 0)) {
      charts.push(chart("payments", "Paiements", "Répartition par statut.", "donut", series.paymentStatus, periodLabel));
    }
    if (presence && presence.total > 0) {
      charts.push(chart("presence-donut", "Présences", "Répartition des statuts.", "donut", presenceDonut, periodLabel));
      charts.push(chart("presence-gauge", "Taux de présence", "Présents et retards sur le total.", "gauge", [], periodLabel, presence.rate, "Présence"));
    }
    if (series.classSizes?.length) {
      charts.push(chart("classes", "Effectifs par classe", "Nombre d'élèves par classe.", "bar-horizontal", series.classSizes, periodLabel));
    }
  }
  return charts;
}
