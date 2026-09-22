import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, SectionHeader } from "../components/ui/Card";
import { Field, Select } from "../components/ui/Field";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import { messagesApi } from "../lib/messagesApi";
import { announcementsApi, type AnnouncementRecord } from "../lib/announcementsApi";
import { formatDateTimeForDisplay } from "../lib/dates";
import {
  buildParentDashboardMetrics,
  parentDashboardStudentKeys,
  resolveParentDashboardStudent,
} from "../lib/parentDashboard";
import { formatParentClassLabel, parentLinkedStudents, parentStudentLabel } from "../lib/parentNotes";
import type { DomainKey } from "../lib/domainLoaders";

const DASHBOARD_LINKS = {
  presences: "/presences",
  notes: "/notes",
  payments: "/finances/paiements",
  messages: "/messages",
  announcements: "/annonces",
} as const;

function formatAverage(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1).replace(".", ",")} / 20`;
}

function formatMoney(value: number, currency: string) {
  if (!currency) return value.toLocaleString("fr-FR");
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString("fr-FR")} ${currency}`;
  }
}

function latestAnnouncement(rows: AnnouncementRecord[]) {
  return [...rows].sort((left, right) => {
    const a = Date.parse(String(left.publishedAt || left.createdAt || "")) || 0;
    const b = Date.parse(String(right.publishedAt || right.createdAt || "")) || 0;
    return b - a;
  })[0] ?? null;
}

function dashboardStudentValue(student: Record<string, unknown>) {
  return String(student.id ?? student.matricule ?? student.publicId ?? "").trim();
}

export function ParentDashboardPage() {
  const { session } = useAuth();
  const { state, ensureDomains, loading, error } = useData();
  const { activeSchoolCode } = useActiveSchool();
  const notesPermission = useFeaturePermissions("Notes");
  const presencesPermission = useFeaturePermissions("Présences");
  const paymentsPermission = useFeaturePermissions("Paiements");
  const messagesPermission = useFeaturePermissions("Messages");
  const announcementsPermission = useFeaturePermissions("Announcements");
  const user = session?.user ?? null;

  const children = useMemo(
    () => parentLinkedStudents(user, state),
    [user, state],
  );
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const selectedStudent = useMemo(
    () => resolveParentDashboardStudent(user, state, selectedStudentId),
    [user, state, selectedStudentId],
  );

  useEffect(() => {
    if (!selectedStudent) {
      if (selectedStudentId) setSelectedStudentId("");
      return;
    }
    const selectedValue = dashboardStudentValue(selectedStudent);
    const currentAllowed = parentDashboardStudentKeys(selectedStudent).includes(
      String(selectedStudentId).trim().toUpperCase(),
    );
    if (!currentAllowed && selectedValue) {
      setSelectedStudentId(selectedValue);
    }
  }, [selectedStudent, selectedStudentId]);

  const dashboardDomains = useMemo(() => {
    const domains: DomainKey[] = ["students"];
    if (notesPermission.canRead) domains.push("notes");
    if (presencesPermission.canRead) domains.push("presences");
    if (paymentsPermission.canRead) domains.push("payments", "studentFees");
    return domains;
  }, [
    notesPermission.canRead,
    presencesPermission.canRead,
    paymentsPermission.canRead,
  ]);

  useEffect(() => {
    void ensureDomains(dashboardDomains).catch(() => undefined);
  }, [dashboardDomains, ensureDomains]);

  const metrics = useMemo(
    () =>
      buildParentDashboardMetrics({
        student: selectedStudent,
        notes: (state.notes ?? []) as Record<string, unknown>[],
        presences: (state.presences ?? []) as Record<string, unknown>[],
        studentFees: (state.studentFees ?? []) as unknown as Record<string, unknown>[],
        payments: (state.payments ?? []) as Record<string, unknown>[],
      }),
    [selectedStudent, state.notes, state.presences, state.studentFees, state.payments],
  );

  const [messagesUnread, setMessagesUnread] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementRecord | null>(null);
  const [communicationsError, setCommunicationsError] = useState("");

  const schoolScope = String(
    activeSchoolCode && activeSchoolCode !== "*"
      ? activeSchoolCode
      : user?.schoolCode ?? "",
  ).trim();

  useEffect(() => {
    let cancelled = false;
    setCommunicationsError("");

    const tasks: Promise<void>[] = [];

    if (messagesPermission.canRead && schoolScope) {
      tasks.push(
        messagesApi
          .unreadCount(schoolScope)
          .then((payload) => {
            if (!cancelled) setMessagesUnread(Number(payload?.count ?? 0));
          })
          .catch(() => {
            if (!cancelled) setMessagesUnread(null);
          }),
      );
    } else {
      setMessagesUnread(null);
    }

    if (announcementsPermission.canRead && schoolScope) {
      tasks.push(
        announcementsApi
          .list(schoolScope)
          .then((payload) => {
            if (!cancelled) setAnnouncement(latestAnnouncement(payload.items ?? []));
          })
          .catch(() => {
            if (!cancelled) setAnnouncement(null);
          }),
      );
    } else {
      setAnnouncement(null);
    }

    void Promise.all(tasks).catch(() => {
      if (!cancelled) {
        setCommunicationsError("Certaines informations de communication sont indisponibles.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    announcementsPermission.canRead,
    messagesPermission.canRead,
    schoolScope,
  ]);

  if (!children.length) {
    return (
      <div className="space-y-6">
        <SectionHeader
          title="Mon tableau de bord"
          description="Suivi scolaire de vos enfants."
        />
        <Card className="p-6">
          <p className="font-bold text-ink">Aucun enfant lié à votre compte.</p>
          <p className="mt-2 text-sm text-muted">
            Contactez l'établissement si un enfant devrait apparaître ici.
          </p>
        </Card>
      </div>
    );
  }

  const childName = parentStudentLabel(selectedStudent);
  const childClass = formatParentClassLabel(selectedStudent, user?.schoolPublicCode ?? "");
  const announcementText = String(announcement?.content ?? announcement?.message ?? "").trim();

  return (
    <div className="space-y-6" data-testid="parent-dashboard">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeader
          title="Mon tableau de bord"
          description="Présence, notes, frais et communications de votre enfant."
        />
        <Link
          to="/mon-profil"
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-bold text-ink hover:border-brand/40"
        >
          Mon profil
        </Link>
      </div>

      {children.length > 1 ? (
        <Card className="p-4">
          <Field label="Enfant suivi" htmlFor="parent-dashboard-child">
            <Select
              id="parent-dashboard-child"
              value={dashboardStudentValue(selectedStudent ?? {})}
              onChange={(event) => setSelectedStudentId(event.target.value)}
              options={children.map((child) => ({
                value: dashboardStudentValue(child),
                label: parentStudentLabel(child),
              }))}
            />
          </Field>
        </Card>
      ) : null}

      <Card className="p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Enfant sélectionné</p>
        <p className="mt-1 text-xl font-black text-ink">{childName || "Élève"}</p>
        <p className="mt-1 text-sm font-semibold text-muted">{childClass}</p>
      </Card>

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-800">
            Certaines données scolaires n'ont pas pu être chargées.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DashboardMetricCard
          label="Présence"
          value={
            presencesPermission.canRead
              ? metrics.presenceRate == null
                ? "—"
                : `${metrics.presenceRate}%`
              : "Non autorisé"
          }
          detail={
            presencesPermission.canRead
              ? `${metrics.presenceRecorded} présence(s) enregistrée(s)`
              : "Accès non disponible"
          }
          to={DASHBOARD_LINKS.presences}
        />
        <DashboardMetricCard
          label="Moyenne"
          value={notesPermission.canRead ? formatAverage(metrics.average) : "Non autorisé"}
          detail={
            notesPermission.canRead
              ? `${metrics.evaluationCount} évaluation(s)`
              : "Accès non disponible"
          }
          to={DASHBOARD_LINKS.notes}
        />
        <DashboardMetricCard
          label="Reste à payer"
          value={
            paymentsPermission.canRead
              ? formatMoney(metrics.remainingAmount, metrics.currency)
              : "Non autorisé"
          }
          detail={
            paymentsPermission.canRead
              ? `Attendu ${formatMoney(metrics.expectedAmount, metrics.currency)} · payé ${formatMoney(metrics.paidAmount, metrics.currency)}`
              : "Accès non disponible"
          }
          to={DASHBOARD_LINKS.payments}
        />
        <DashboardMetricCard
          label="Paiements"
          value={
            paymentsPermission.canRead
              ? formatMoney(metrics.paymentAmount, metrics.currency)
              : "Non autorisé"
          }
          detail={
            paymentsPermission.canRead
              ? `${metrics.paymentCount} paiement(s) dans l'historique`
              : "Accès non disponible"
          }
          to={DASHBOARD_LINKS.payments}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Messages</p>
              <p className="mt-2 text-2xl font-black text-ink">
                {messagesPermission.canRead
                  ? messagesUnread == null
                    ? "—"
                    : messagesUnread
                  : "Non autorisé"}
              </p>
              <p className="mt-1 text-sm text-muted">
                {messagesPermission.canRead ? "message(s) non lu(s)" : "Accès non disponible"}
              </p>
            </div>
            {messagesPermission.canRead ? (
              <Link className="text-sm font-bold text-brand hover:underline" to={DASHBOARD_LINKS.messages}>
                Ouvrir
              </Link>
            ) : null}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Dernière annonce</p>
              {announcementsPermission.canRead && announcement ? (
                <>
                  <p className="mt-2 font-black text-ink">{announcement.title || "Annonce"}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">
                    {announcementText || "Aucun contenu."}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-muted">
                    {formatDateTimeForDisplay(
                      String(announcement.publishedAt || announcement.createdAt || ""),
                    )}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  {announcementsPermission.canRead ? "Aucune annonce disponible." : "Accès non disponible"}
                </p>
              )}
            </div>
            {announcementsPermission.canRead ? (
              <Link
                className="shrink-0 text-sm font-bold text-brand hover:underline"
                to={DASHBOARD_LINKS.announcements}
              >
                Voir
              </Link>
            ) : null}
          </div>
        </Card>
      </div>

      {communicationsError ? (
        <p className="text-sm font-semibold text-amber-700">{communicationsError}</p>
      ) : null}
      {loading ? <p className="text-sm font-semibold text-muted">Actualisation des données…</p> : null}
    </div>
  );
}

function DashboardMetricCard({
  label,
  value,
  detail,
  to,
}: {
  label: string;
  value: string;
  detail: string;
  to: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-black text-ink">{value}</p>
      <p className="mt-1 min-h-10 text-sm text-muted">{detail}</p>
      <Link className="mt-3 inline-block text-sm font-bold text-brand hover:underline" to={to}>
        Consulter
      </Link>
    </Card>
  );
}
