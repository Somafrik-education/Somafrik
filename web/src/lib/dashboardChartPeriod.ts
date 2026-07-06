import type { ChartDatum } from "../components/charts/DashboardCharts";
import type { BackOfficeState, SessionUser } from "../types";
import { CHART_COLORS } from "./chartTheme";
import {
  filterRowsByPeriod,
  formatPeriodRangeDescription,
  isRowWithinPeriod,
  extractRowDate,
  type ChartPeriod,
} from "./chartPeriod";
import type { EstablishmentChart, PlatformChart } from "./dashboardCharts";
import {
  scopedAnnouncements,
  scopedBulletins,
  scopedDocuments,
  scopedExams,
  scopedMessages,
  scopedNotes,
  scopedPayments,
  scopedPresences,
  scopedStudents,
  scopedTeachers,
} from "./establishment";
import { isActiveUserAccount, normalize } from "./format";
import { getPresenceStats } from "./presenceMetrics";
import { COUNTRY_ADMIN_ROLE } from "./orgHierarchy";
import {
  scopedCountries,
  scopedNotifications,
  scopedSchools,
  scopedSubscriptions,
  scopedUsers,
} from "./scope";

type Row = Record<string, unknown>;
type DashboardChart = PlatformChart | EstablishmentChart;

export interface DashboardPeriodContext {
  user: SessionUser | null;
  state: BackOfficeState;
  scope: "platform" | "establishment";
}

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

function withPeriodDescription(chart: DashboardChart, period: ChartPeriod): DashboardChart {
  const periodLabel = formatPeriodRangeDescription(period);
  const baseDescription = chart.description?.split(" · ")[0]?.trim();
  return {
    ...chart,
    description: baseDescription ? `${baseDescription} · ${periodLabel}` : periodLabel,
  };
}

function schoolsVisibleInPeriod(
  schools: Row[],
  subscriptions: Row[],
  period: ChartPeriod,
  now = new Date(),
) {
  const subscriptionSchoolCodes = new Set(
    filterRowsByPeriod(subscriptions, period, now, ["lastPaymentDate", "startDate", "endDate"]).map((row) =>
      normalize(String(row.schoolCode ?? "")),
    ),
  );

  return schools.filter((school) => {
    if (isRowWithinPeriod(school, period, now, ["createdAt", "validationRequestedAt", "validatedAt"])) {
      return true;
    }
    if (!extractRowDate(school, ["createdAt", "validationRequestedAt", "validatedAt"])) {
      return true;
    }
    if (subscriptionSchoolCodes.has(normalize(String(school.code ?? "")))) {
      return true;
    }
    return String(school.status ?? "Actif") !== "Suspendu";
  });
}

function usersActiveInPeriod(users: Row[], period: ChartPeriod, now = new Date()) {
  return users.filter(
    (user) =>
      isRowWithinPeriod(user, period, now, ["lastLoginAt", "createdAt"]) &&
      isActiveUserAccount(user as never),
  );
}

function activeStudentsInPeriod(user: SessionUser | null, state: BackOfficeState, period: ChartPeriod) {
  const students = scopedStudents(user, state);
  const studentIds = new Set<string>();
  for (const row of filterRowsByPeriod(scopedPresences(user, state), period)) {
    studentIds.add(String(row.studentId ?? ""));
  }
  for (const row of filterRowsByPeriod(scopedNotes(user, state), period)) {
    studentIds.add(String(row.studentId ?? ""));
  }
  for (const row of filterRowsByPeriod(scopedPayments(user, state), period)) {
    studentIds.add(String(row.studentId ?? ""));
  }
  return students.filter((student) => studentIds.has(String(student.id ?? "")));
}

function applyPlatformChartPeriod(
  chart: PlatformChart,
  period: ChartPeriod,
  context: DashboardPeriodContext,
): PlatformChart {
  const { user, state } = context;
  if (!user) return chart;

  const allSchools = scopedSchools(user, state) as unknown as Row[];
  const allUsers = scopedUsers(user, state) as unknown as Row[];
  const allCountries = scopedCountries(user, state) as unknown as Row[];
  const allSubscriptions = scopedSubscriptions(user, state) as unknown as Row[];

  const schools = schoolsVisibleInPeriod(allSchools, allSubscriptions, period);
  const users = usersActiveInPeriod(allUsers, period);
  const subscriptions = filterRowsByPeriod(allSubscriptions, period, undefined, [
    "lastPaymentDate",
    "startDate",
    "endDate",
  ]);
  const notifications = filterRowsByPeriod(scopedNotifications(user, state) as unknown as Row[], period);

  switch (chart.id) {
    case "structure":
      return withPeriodDescription(
        {
          ...chart,
          data: [
            { name: "Pays", value: allCountries.length, fill: CHART_COLORS.brand },
            { name: "Établissements", value: schools.length, fill: CHART_COLORS.teal },
            {
              name: "Utilisateurs",
              value: users.length,
              fill: CHART_COLORS.violet,
            },
          ],
        },
        period,
      );

    case "kpis": {
      const activeUsers = users.length;
      const monthlyRevenue = subscriptions
        .filter((row) => normalize(String(row.status ?? "")) === "actif" && String(row.paymentStatus ?? "") === "À jour")
        .reduce((total, row) => total + Number(row.monthlyPrice ?? 0), 0);
      const suspendedSchools = schools.filter((row) => String(row.status ?? "") === "Suspendu").length;
      const expiredSubscriptions = subscriptions.filter(
        (row) => String(row.paymentStatus ?? "") === "En retard",
      ).length;

      const data =
        user.role === COUNTRY_ADMIN_ROLE
          ? [
              { name: "Établissements", value: schools.length },
              { name: "Utilisateurs actifs", value: activeUsers },
              { name: "Abonnements", value: subscriptions.length },
              { name: "Notifications", value: notifications.length },
            ]
          : [
              { name: "Pays", value: allCountries.length },
              { name: "Établissements", value: schools.length },
              { name: "Utilisateurs actifs", value: activeUsers },
              { name: "Revenus mensuels", value: monthlyRevenue },
              { name: "Alertes plateforme", value: suspendedSchools + expiredSubscriptions },
            ];

      return withPeriodDescription({ ...chart, data }, period);
    }

    case "school-status":
      return withPeriodDescription(
        {
          ...chart,
          data: [
            {
              name: "Actifs",
              value: schools.filter((row) => String(row.status ?? "") !== "Suspendu").length,
              fill: CHART_COLORS.emerald,
            },
            {
              name: "Suspendus",
              value: schools.filter((row) => String(row.status ?? "") === "Suspendu").length,
              fill: CHART_COLORS.rose,
            },
          ],
        },
        period,
      );

    case "schools-country": {
      const filtered = schoolsVisibleInPeriod(allSchools, allSubscriptions, period);
      const data =
        user.role === COUNTRY_ADMIN_ROLE
          ? countByField(filtered, "city").slice(0, 8)
          : countByField(filtered, "country").slice(0, 8);
      return withPeriodDescription({ ...chart, data }, period);
    }

    case "subscription-payment":
      return withPeriodDescription(
        {
          ...chart,
          data: countByField(subscriptions, "paymentStatus", {
            "a jour": "À jour",
            "en retard": "En retard",
            impaye: "Impayé",
          }),
        },
        period,
      );

    case "subscription-plans":
      return withPeriodDescription(
        { ...chart, data: countByField(subscriptions, "plan").slice(0, 6) },
        period,
      );

    case "subscription-gauge": {
      const onTime = subscriptions.filter((row) => String(row.paymentStatus ?? "") === "À jour").length;
      const total = subscriptions.length;
      return withPeriodDescription(
        {
          ...chart,
          gaugeValue: total > 0 ? Math.round((onTime / total) * 100) : 0,
          description: `${onTime} sur ${total} abonnements sont à jour.`,
        },
        period,
      );
    }

    default:
      return withPeriodDescription(chart, period);
  }
}

function paymentStatusData(payments: Row[]) {
  return countByField(payments, "status", {
    paye: "Payé",
    paid: "Payé",
    en_attente: "En attente",
    pending: "En attente",
    impaye: "Impayé",
    overdue: "Impayé",
  });
}

function paymentAmountData(payments: Row[]) {
  const amountMap = new Map<string, number>();
  for (const payment of payments) {
    const statusKey = normalize(String(payment.status ?? "autre"));
    const label =
      statusKey.includes("paye") || statusKey === "paid"
        ? "Payé"
        : statusKey.includes("attente") || statusKey === "pending"
          ? "En attente"
          : "Autre";
    amountMap.set(label, (amountMap.get(label) ?? 0) + Number(payment.amount ?? 0));
  }
  return [...amountMap.entries()].map(([name, value]) => ({ name, value }));
}

function presenceData(presences: Row[]) {
  const stats = getPresenceStats(
    presences.map((row) => ({
      studentId: String(row.studentId ?? ""),
      status: String(row.status ?? ""),
      present: Boolean(row.present),
    })),
  );
  const donut: ChartDatum[] = [
    { name: "Présents", value: stats.present, fill: CHART_COLORS.emerald },
    { name: "Absents", value: stats.absent, fill: CHART_COLORS.rose },
    { name: "Retards", value: stats.late, fill: CHART_COLORS.amber },
    { name: "Justifiés", value: stats.justified, fill: CHART_COLORS.brandLight },
  ];
  return { stats, donut };
}

function applyEstablishmentChartPeriod(
  chart: EstablishmentChart,
  period: ChartPeriod,
  context: DashboardPeriodContext,
): EstablishmentChart {
  const { user, state } = context;
  if (!user) return chart;

  const users = scopedUsers(user, state);
  const activeStudents = activeStudentsInPeriod(user, state, period);
  const teachers = scopedTeachers(user, state, activeStudents);
  const classNames = new Set(activeStudents.map((row) => String(row.className ?? "")).filter(Boolean));
  const notes = filterRowsByPeriod(scopedNotes(user, state), period);
  const presences = filterRowsByPeriod(scopedPresences(user, state), period);
  const payments = filterRowsByPeriod(scopedPayments(user, state), period);
  const exams = filterRowsByPeriod(scopedExams(user, state), period);
  const bulletins = filterRowsByPeriod(scopedBulletins(user, state), period, undefined, ["publishedAt"]);
  const documents = filterRowsByPeriod(scopedDocuments(user, state), period, undefined, ["generatedAt"]);
  const messages = filterRowsByPeriod(scopedMessages(user, state), period);
  const announcements = filterRowsByPeriod(scopedAnnouncements(user, state), period);
  const activeUsers = filterRowsByPeriod(users as unknown as Row[], period, undefined, ["createdAt", "lastLoginAt"]).filter(
    (row) => isActiveUserAccount(row as never),
  );
  const pendingBulletins = bulletins.filter((row) => {
    const status = normalize(String(row.status ?? ""));
    return status === "en validation" || status === "brouillon";
  }).length;
  const unreadMessages = messages.filter((row) => normalize(String(row.status ?? "")) === "non lu").length;
  const presence = presenceData(presences);

  const scolariteBar: ChartDatum[] = [
    { name: "Élèves", value: activeStudents.length, fill: CHART_COLORS.brand },
    { name: "Enseignants", value: teachers.length, fill: CHART_COLORS.teal },
    { name: "Classes", value: classNames.size, fill: CHART_COLORS.emerald },
  ];

  const academicBar: ChartDatum[] = [
    { name: "Notes", value: notes.length, fill: CHART_COLORS.brand },
    { name: "Examens", value: exams.length, fill: CHART_COLORS.teal },
    { name: "Bulletins", value: bulletins.length, fill: CHART_COLORS.violet },
    { name: "À valider", value: pendingBulletins, fill: CHART_COLORS.amber },
  ];

  const operationsBar: ChartDatum[] = [
    { name: "Utilisateurs", value: activeUsers.length, fill: CHART_COLORS.brand },
    { name: "Documents", value: documents.length, fill: CHART_COLORS.teal },
    { name: "Présences", value: presences.length, fill: CHART_COLORS.emerald },
    { name: "Messages", value: unreadMessages, fill: CHART_COLORS.amber },
    { name: "Annonces", value: announcements.length, fill: CHART_COLORS.violet },
  ];

  switch (chart.id) {
    case "academic-bar":
    case "academic":
      return withPeriodDescription({ ...chart, data: academicBar }, period);
    case "scolarite":
    case "scolarite-finance":
    case "scolarite-ops":
      return withPeriodDescription({ ...chart, data: scolariteBar }, period);
    case "notes-course":
      return withPeriodDescription(
        { ...chart, data: countByField(notes, "subject").slice(0, 6) },
        period,
      );
    case "presence-rate":
    case "presence-gauge":
      return withPeriodDescription(
        {
          ...chart,
          gaugeValue: presence.stats.rate,
          gaugeLabel: "Présence",
        },
        period,
      );
    case "presence-donut":
      return withPeriodDescription({ ...chart, data: presence.donut }, period);
    case "payments-status":
    case "payments":
      return withPeriodDescription({ ...chart, data: paymentStatusData(payments) }, period);
    case "payments-amount":
      return withPeriodDescription({ ...chart, data: paymentAmountData(payments) }, period);
    case "operations":
    case "operations-default":
      return withPeriodDescription({ ...chart, data: operationsBar }, period);
    case "class-sizes":
    case "classes":
      return withPeriodDescription(
        {
          ...chart,
          data: countByField(activeStudents as Row[], "className").slice(0, 8),
        },
        period,
      );
    default:
      return withPeriodDescription(chart, period);
  }
}

export function applyPeriodToDashboardChart(
  chart: DashboardChart,
  period: ChartPeriod,
  context: DashboardPeriodContext,
): DashboardChart {
  if (context.scope === "platform") {
    return applyPlatformChartPeriod(chart as PlatformChart, period, context);
  }
  return applyEstablishmentChartPeriod(chart as EstablishmentChart, period, context);
}
