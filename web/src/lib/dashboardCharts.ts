import type { BackOfficeState, SessionUser } from "../types";
import type { ChartDatum } from "../components/charts/DashboardCharts";
import { CHART_COLORS } from "./chartTheme";
import {
  applyChartTypeOverrides,
  type ChartType,
  type DashboardChartConfig,
} from "./chartTypes";
import {
  getEstablishmentMetrics,
  scopedNotes,
  scopedPayments,
  scopedPresences,
  scopedStudents,
} from "./establishment";
import { formatMetric, isActiveUserAccount, normalize, getEstablishmentChartProfile, type EstablishmentChartProfile } from "./format";
import { COUNTRY_ADMIN_ROLE } from "./orgHierarchy";
import {
  getLiveKpis,
  scopedCountries,
  scopedSchools,
  scopedSubscriptions,
  scopedUsers,
  type Kpi,
} from "./scope";
import type { Country, PlatformNotification, School, Subscription, UserAccount } from "../types";

type ScopeState = {
  schools: School[];
  users: UserAccount[];
  countries: Country[];
  subscriptions: Subscription[];
  notifications: PlatformNotification[];
};
import { getPresenceStats } from "./presenceMetrics";

type Row = Record<string, unknown>;

export type { EstablishmentChartProfile } from "./format";

function countByField(rows: Row[], field: string, labels?: Record<string, string>): ChartDatum[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = String(row[field] ?? "Non renseigné").trim() || "Non renseigné";
    const key = normalize(raw);
    const label = labels?.[key] ?? raw;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function kpisToBarData(kpis: Kpi[]): ChartDatum[] {
  return kpis.map((kpi) => ({ name: kpi.label, value: kpi.value }));
}

export interface PlatformChart {
  id: string;
  title: string;
  description?: string;
  type: ChartType;
  data: ChartDatum[];
  gaugeValue?: number;
  gaugeLabel?: string;
}

export function buildPlatformDashboardCharts(
  user: SessionUser | null,
  state: ScopeState,
  chartConfig?: DashboardChartConfig,
) {
  if (!user) return { kpis: [] as Kpi[], charts: [] as PlatformChart[] };

  const schools = scopedSchools(user, state);
  const subscriptions = scopedSubscriptions(user, state);
  const kpis = getLiveKpis(user, state);

  const schoolsByCountry = countByField(schools as unknown as Row[], "country").slice(0, 8);

  const schoolStatus: ChartDatum[] = [
    {
      name: "Actifs",
      value: schools.filter((s) => s.status !== "Suspendu").length,
      fill: CHART_COLORS.emerald,
    },
    {
      name: "Suspendus",
      value: schools.filter((s) => s.status === "Suspendu").length,
      fill: CHART_COLORS.rose,
    },
  ];

  const subscriptionPayment = countByField(subscriptions as unknown as Row[], "paymentStatus", {
    "a jour": "À jour",
    "en retard": "En retard",
    impaye: "Impayé",
  });

  const subscriptionPlans = countByField(subscriptions as unknown as Row[], "plan").slice(0, 6);

  const structureBar: ChartDatum[] = [
    { name: "Pays", value: scopedCountries(user, state).length, fill: CHART_COLORS.brand },
    { name: "Établissements", value: schools.length, fill: CHART_COLORS.teal },
    {
      name: "Utilisateurs",
      value: scopedUsers(user, state).filter(isActiveUserAccount).length,
      fill: CHART_COLORS.violet,
    },
  ];

  const charts: PlatformChart[] = [
    {
      id: "structure",
      title: "Structure du périmètre",
      description: "Vue agrégée pays, établissements et utilisateurs actifs.",
      type: "bar",
      data: structureBar,
    },
    {
      id: "kpis",
      title: "Indicateurs clés",
      description: "Synthèse des KPIs de votre tableau de bord.",
      type: "bar-horizontal",
      data: kpisToBarData(kpis),
    },
    {
      id: "school-status",
      title: "Statut des établissements",
      description: "Répartition actifs / suspendus dans votre périmètre.",
      type: "donut",
      data: schoolStatus,
    },
  ];

  if (schoolsByCountry.length) {
    charts.push({
      id: "schools-country",
      title: user.role === COUNTRY_ADMIN_ROLE ? "Établissements par ville" : "Établissements par pays",
      description:
        user.role === COUNTRY_ADMIN_ROLE
          ? "Répartition géographique dans votre pays."
          : "Répartition des établissements par territoire.",
      type: "bar-horizontal",
      data:
        user.role === COUNTRY_ADMIN_ROLE
          ? countByField(schools as unknown as Row[], "city").slice(0, 8)
          : schoolsByCountry,
    });
  }

  if (subscriptionPayment.some((item) => item.value > 0)) {
    charts.push({
      id: "subscription-payment",
      title: "Abonnements — statut de paiement",
      description: "Suivi des paiements SaaS par établissement.",
      type: "donut",
      data: subscriptionPayment,
    });
  }

  if (subscriptionPlans.length) {
    charts.push({
      id: "subscription-plans",
      title: "Plans d'abonnement",
      description: "Répartition des offres souscrites.",
      type: "bar",
      data: subscriptionPlans,
    });
  }

  const onTime = subscriptions.filter((s) => s.paymentStatus === "À jour").length;
  const total = subscriptions.length;
  if (total > 0) {
    charts.push({
      id: "subscription-gauge",
      title: "Abonnements à jour",
      description: `${onTime} sur ${total} abonnements sont à jour.`,
      type: "gauge",
      data: [],
      gaugeValue: Math.round((onTime / total) * 100),
      gaugeLabel: "Paiements à jour",
    });
  }

  return { kpis, charts: applyChartTypeOverrides(charts, chartConfig, "platform") };
}

export interface EstablishmentChart {
  id: string;
  title: string;
  description?: string;
  type: ChartType;
  data: ChartDatum[];
  gaugeValue?: number;
  gaugeLabel?: string;
}

function chart(
  id: string,
  title: string,
  description: string,
  type: EstablishmentChart["type"],
  data: ChartDatum[],
  gaugeValue?: number,
  gaugeLabel?: string,
): EstablishmentChart {
  return { id, title, description, type, data, gaugeValue, gaugeLabel };
}

export function buildEstablishmentDashboardCharts(
  user: SessionUser | null,
  state: BackOfficeState,
  users: ReturnType<typeof scopedUsers>,
) {
  const metrics = getEstablishmentMetrics(user, state, users);
  const profile = getEstablishmentChartProfile(user?.role);
  const students = scopedStudents(user, state);
  const payments = scopedPayments(user, state);
  const presences = scopedPresences(user, state);
  const notes = scopedNotes(user, state);

  const scolariteBar: ChartDatum[] = [
    { name: "Élèves", value: metrics.students, fill: CHART_COLORS.brand },
    { name: "Enseignants", value: metrics.teachers, fill: CHART_COLORS.teal },
    { name: "Classes", value: metrics.classes, fill: CHART_COLORS.emerald },
  ];

  const academicBar: ChartDatum[] = [
    { name: "Notes", value: metrics.notes, fill: CHART_COLORS.brand },
    { name: "Examens", value: metrics.exams, fill: CHART_COLORS.teal },
    { name: "Bulletins", value: metrics.bulletins, fill: CHART_COLORS.violet },
    { name: "À valider", value: metrics.pendingBulletins, fill: CHART_COLORS.amber },
  ];

  const operationsBar: ChartDatum[] = [
    { name: "Utilisateurs", value: metrics.activeUsers, fill: CHART_COLORS.brand },
    { name: "Documents", value: metrics.documents, fill: CHART_COLORS.teal },
    { name: "Présences", value: metrics.presences, fill: CHART_COLORS.emerald },
    { name: "Messages", value: metrics.unreadMessages, fill: CHART_COLORS.amber },
  ];

  const paymentStatus = countByField(payments as Row[], "status", {
    paye: "Payé",
    paid: "Payé",
    en_attente: "En attente",
    pending: "En attente",
    impaye: "Impayé",
    overdue: "Impayé",
  });

  const amountMap = new Map<string, number>();
  for (const payment of payments as Row[]) {
    const statusKey = normalize(String(payment.status ?? "autre"));
    const label =
      statusKey.includes("paye") || statusKey === "paid"
        ? "Payé"
        : statusKey.includes("attente") || statusKey === "pending"
          ? "En attente"
          : "Autre";
    amountMap.set(label, (amountMap.get(label) ?? 0) + Number(payment.amount ?? 0));
  }
  const paymentAmounts: ChartDatum[] = [...amountMap.entries()].map(([name, value]) => ({ name, value }));

  const presenceBreakdown = getPresenceStats(
    (presences as Row[]).map((row) => ({
      studentId: String(row.studentId ?? ""),
      status: String(row.status ?? ""),
      present: Boolean(row.present),
    })),
  );

  const presenceDonut: ChartDatum[] = [
    { name: "Présents", value: presenceBreakdown.present, fill: CHART_COLORS.emerald },
    { name: "Absents", value: presenceBreakdown.absent, fill: CHART_COLORS.rose },
    { name: "Retards", value: presenceBreakdown.late, fill: CHART_COLORS.amber },
    { name: "Justifiés", value: presenceBreakdown.justified, fill: CHART_COLORS.brandLight },
  ];

  const notesByCourse = countByField(notes as Row[], "course").slice(0, 6);
  const classSizes = countByField(students as Row[], "className").slice(0, 8);

  const charts: EstablishmentChart[] = [];

  if (profile === "academic") {
    charts.push(
      chart("academic-bar", "Pilotage pédagogique", "Notes, examens et bulletins.", "bar", academicBar),
      chart("scolarite", "Effectifs", "Élèves, enseignants et classes.", "bar", scolariteBar),
    );
    if (notesByCourse.length) {
      charts.push(chart("notes-course", "Notes par matière", "Volume d'évaluations saisies.", "bar-horizontal", notesByCourse));
    }
    if (presenceBreakdown.total > 0) {
      charts.push(
        chart("presence-rate", "Taux de présence", "Synthèse des enregistrements.", "gauge", [], presenceBreakdown.rate, "Présence"),
        chart("presence-donut", "Répartition des présences", "Présents, absents, retards et justifiés.", "donut", presenceDonut),
      );
    }
  } else if (profile === "finance") {
    charts.push(chart("payments-status", "Paiements par statut", "Suivi des encaissements.", "donut", paymentStatus));
    if (paymentAmounts.length) {
      charts.push(chart("payments-amount", "Montants par statut", "Montants cumulés.", "bar", paymentAmounts));
    }
    charts.push(chart("scolarite-finance", "Effectifs facturables", "Élèves et classes suivis.", "bar", scolariteBar));
  } else if (profile === "operations") {
    charts.push(
      chart("operations", "Activité administrative", "Utilisateurs, documents, présences et messages.", "bar", operationsBar),
      chart("scolarite-ops", "Scolarité", "Effectifs de l'établissement.", "bar", scolariteBar),
    );
    if (classSizes.length) {
      charts.push(chart("class-sizes", "Élèves par classe", "Répartition des effectifs.", "bar-horizontal", classSizes));
    }
  } else {
    charts.push(
      chart("scolarite", "Scolarité", "Élèves, enseignants et classes.", "bar", scolariteBar),
      chart("academic", "Pédagogie", "Notes, examens et bulletins.", "bar", academicBar),
      chart("operations-default", "Administration", "Utilisateurs, documents et présences.", "bar", operationsBar),
    );
    if (paymentStatus.some((item) => item.value > 0)) {
      charts.push(chart("payments", "Paiements", "Répartition par statut.", "donut", paymentStatus));
    }
    if (presenceBreakdown.total > 0) {
      charts.push(
        chart("presence-donut", "Présences", "Répartition des statuts.", "donut", presenceDonut),
        chart("presence-gauge", "Taux de présence", "Présents et retards sur le total.", "gauge", [], presenceBreakdown.rate, "Présence"),
      );
    }
    if (classSizes.length) {
      charts.push(chart("classes", "Effectifs par classe", "Nombre d'élèves par classe.", "bar-horizontal", classSizes));
    }
  }

  const kpiItems = buildEstablishmentKpiItems(metrics, profile);
  return {
    metrics,
    profile,
    charts: applyChartTypeOverrides(charts, state.dashboardChartConfig, "establishment"),
    kpiItems,
  };
}

function buildEstablishmentKpiItems(
  metrics: ReturnType<typeof getEstablishmentMetrics>,
  profile: EstablishmentChartProfile,
) {
  if (profile === "academic") {
    return [
      { label: "Notes", value: formatMetric(metrics.notes) },
      { label: "Examens", value: formatMetric(metrics.exams) },
      { label: "Bulletins", value: formatMetric(metrics.bulletins) },
      { label: "À valider", value: formatMetric(metrics.pendingBulletins) },
      { label: "Élèves", value: formatMetric(metrics.students) },
    ];
  }
  if (profile === "finance") {
    return [
      { label: "Paiements", value: formatMetric(metrics.payments) },
      { label: "Élèves", value: formatMetric(metrics.students) },
      { label: "Classes", value: formatMetric(metrics.classes) },
    ];
  }
  if (profile === "operations") {
    return [
      { label: "Utilisateurs", value: formatMetric(metrics.activeUsers) },
      { label: "Documents", value: formatMetric(metrics.documents) },
      { label: "Présences", value: formatMetric(metrics.presences) },
      { label: "Messages", value: formatMetric(metrics.unreadMessages) },
    ];
  }
  return [
    { label: "Utilisateurs", value: formatMetric(metrics.activeUsers) },
    { label: "Élèves", value: formatMetric(metrics.students) },
    { label: "Enseignants", value: formatMetric(metrics.teachers) },
    { label: "Paiements", value: formatMetric(metrics.payments) },
    { label: "Présences", value: formatMetric(metrics.presences) },
  ];
}

export function buildPresenceDashboardCharts(stats: ReturnType<typeof getPresenceStats>) {
  const donut: ChartDatum[] = [
    { name: "Présents", value: stats.present, fill: CHART_COLORS.emerald },
    { name: "Absents", value: stats.absent, fill: CHART_COLORS.rose },
    { name: "Retards", value: stats.late, fill: CHART_COLORS.amber },
    { name: "Justifiés", value: stats.justified, fill: CHART_COLORS.brandLight },
  ];
  return { donut, bar: donut.filter((item) => item.value > 0), rate: stats.rate };
}

export function buildPresenceHistoryByClass(students: Row[], presences: Row[]) {
  const classNames = [...new Set(students.map((s) => String(s.className ?? "").trim()).filter(Boolean))].sort();
  return classNames.map((className) => {
    const ids = new Set(
      students.filter((s) => String(s.className ?? "") === className).map((s) => String(s.id ?? "")),
    );
    const rows = presences.filter((p) => ids.has(String(p.studentId ?? "")));
    const stats = getPresenceStats(
      rows.map((row) => ({
        status: String(row.status ?? ""),
        present: Boolean(row.present),
      })),
    );
    return { name: className, value: stats.rate };
  });
}

export function buildReportsDashboardCharts(
  rows: Array<{ module: string; scope: string; status: string; priority: string }>,
) {
  const covered = rows.filter((r) => r.status === "Couvert").length;
  const rate = rows.length ? Math.round((covered / rows.length) * 100) : 0;

  const byPriority = ["P0", "P1", "P2"]
    .map((priority) => ({
      name: priority,
      value: rows.filter((r) => r.priority === priority).length,
      fill: priority === "P0" ? CHART_COLORS.rose : priority === "P1" ? CHART_COLORS.amber : CHART_COLORS.slate,
    }))
    .filter((item) => item.value > 0);

  const byScope = countByField(rows as Row[], "scope");

  const moduleCoverage: ChartDatum[] = rows.map((row) => ({
    name: row.module.length > 28 ? `${row.module.slice(0, 26)}…` : row.module,
    value: row.status === "Couvert" ? 100 : 0,
    fill: row.status === "Couvert" ? CHART_COLORS.emerald : CHART_COLORS.slate,
  }));

  return { covered, rate, total: rows.length, byPriority, byScope, moduleCoverage };
}
