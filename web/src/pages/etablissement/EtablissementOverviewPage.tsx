import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  CalendarRange,
  GraduationCap,
  Link2,
  Network,
  School,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ErrorState, InlineAlert, LoadingState } from "@/design-system";
import { Card, SectionHeader } from "../../components/ui/Card";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { ApiError } from "../../api/client";
import { academicYearsApi, type AcademicYear } from "../../lib/academicYearsApi";
import {
  buildDomainRouteHydrationKey,
  useDomainRouteHydrationStatus,
} from "../../lib/domainRouteHydration";
import { canReadView } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import {
  scopedAssignments,
  scopedRelations,
  scopedStudents,
  scopedTeachers,
  teacherScopedClassNames,
  getEstablishmentMetrics,
} from "../../lib/establishment";
import { projectScopedStudents } from "../../lib/studentsScope";
import { countUniqueParentsInRelations } from "../../lib/relations";
import { scopedUsers } from "../../lib/scope";
import { ACTIVE_USERS_KPI_LABEL, normalize } from "../../lib/format";
import {
  SCOLARITE_COPY,
  countStudentsWithoutClass,
  filterCanonicalClasses,
  selectCurrentAcademicYear,
} from "../../lib/schoolingTruth";

type Row = Record<string, unknown>;

interface OverviewTile {
  key: string;
  label: string;
  to: string;
  view: string;
  icon: LucideIcon;
  count: number;
}

interface ActionTile {
  key: string;
  label: string;
  description: string;
  to: string;
  view: string;
  icon: LucideIcon;
}

/** Hub Scolarité — indicateurs canoniques GET /classes + GET /students + année active. */
export function EtablissementOverviewPage() {
  const location = useLocation();
  const { state, error, scopeError } = useData();
  const { scopedUser, activeSchoolCode, activeSchool } = useActiveSchool();
  const ctx = usePermissionContext();
  const hydrationKey = buildDomainRouteHydrationKey(
    location.key,
    location.pathname,
    activeSchoolCode,
  );
  const hydrationStatus = useDomainRouteHydrationStatus(hydrationKey);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [yearsError, setYearsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void academicYearsApi
      .list()
      .then((rows) => {
        if (cancelled) return;
        setYears(Array.isArray(rows) ? rows : []);
        setYearsError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setYears([]);
        setYearsError(err instanceof ApiError ? err.message : "Impossible de charger l'année scolaire.");
      });
    return () => {
      cancelled = true;
    };
  }, [activeSchoolCode]);

  if (hydrationStatus === "idle" || hydrationStatus === "loading") {
    return <LoadingState message={SCOLARITE_COPY.loading} />;
  }

  if (hydrationStatus === "error") {
    return (
      <ErrorState
        title="Impossible de charger la scolarité."
        message={error || "Une ou plusieurs données de l’établissement n’ont pas pu être chargées."}
      />
    );
  }

  const studentsProjection = projectScopedStudents(scopedUser, state);
  const visibleScopeError = scopeError || studentsProjection.error?.message || null;
  const students = scopedStudents(scopedUser, state);
  const teachers = scopedTeachers(scopedUser, state, students);
  const canonicalClasses = filterCanonicalClasses((state.classes ?? []) as Row[]);
  const teacherClassNames = teacherScopedClassNames(scopedUser, state);
  const classes = teacherClassNames
    ? canonicalClasses.filter((row) =>
        teacherClassNames.has(normalize(String(row.name ?? row.className ?? ""))),
      )
    : canonicalClasses;
  const assignments = scopedAssignments(scopedUser, state);
  const relations = scopedRelations(scopedUser, state);
  const users = scopedUsers(scopedUser, state);
  const metrics = getEstablishmentMetrics(scopedUser, state, users);
  const currentYear = selectCurrentAcademicYear(years);
  const schoolLabel = String(activeSchool?.name ?? "").trim();
  const yearLabel = yearsError
    ? yearsError
    : currentYear?.name || "Aucune année scolaire active";

  const schoolingTiles: OverviewTile[] = [
    {
      key: "students",
      label: "Élèves",
      to: "/etablissement/eleves",
      view: "students",
      icon: GraduationCap,
      count: students.length,
    },
    {
      key: "classes",
      label: "Classes",
      to: "/etablissement/classes",
      view: "classes",
      icon: School,
      count: classes.length,
    },
    {
      key: "teachers",
      label: "Enseignants",
      to: "/etablissement/enseignants",
      view: "teachers",
      icon: Users,
      count: teachers.length,
    },
  ];

  const adminTiles: OverviewTile[] = [
    {
      key: "users",
      label: ACTIVE_USERS_KPI_LABEL,
      to: "/etablissement/comptes-utilisateurs",
      view: "users",
      icon: UserRound,
      count: metrics.activeUsers,
    },
    {
      key: "relations",
      label: "Parents & élèves",
      to: "/etablissement/relations-parent-enfant",
      view: "relations",
      icon: Link2,
      count: countUniqueParentsInRelations(relations),
    },
  ];

  const actions: ActionTile[] = [
    {
      key: "classes",
      label: "Classes",
      description: "Liste et organisation des classes.",
      to: "/etablissement/classes",
      view: "classes",
      icon: School,
    },
    {
      key: "students",
      label: "Élèves",
      description: "Annuaire des élèves de l'établissement.",
      to: "/etablissement/eleves",
      view: "students",
      icon: GraduationCap,
    },
    {
      key: "enrollments",
      label: "Inscriptions",
      description: SCOLARITE_COPY.enrollmentsHint,
      to: "/etablissement/classes",
      view: "classes",
      icon: GraduationCap,
    },
    {
      key: "structure",
      label: "Structure pédagogique",
      description: "Niveaux, filières et groupes activés.",
      to: "/parametres/structure",
      view: "configuration",
      icon: Network,
    },
    {
      key: "year",
      label: "Année scolaire",
      description: "Année active, périodes et barème.",
      to: "/parametres/annee-scolaire",
      view: "configuration",
      icon: CalendarRange,
    },
  ];

  const studentsWithoutClass = countStudentsWithoutClass(students);
  const teachersWithoutAssignment = teachers.filter((teacher) => {
    const id = String((teacher as Row).id ?? "");
    const name = String((teacher as Row).name ?? "");
    return !assignments.some(
      (assignment) =>
        String((assignment as Row).teacherId ?? "") === id ||
        String((assignment as Row).teacherName ?? "") === name,
    );
  }).length;

  const alerts: { key: string; label: string; tone: "warn" | "info" }[] = [];
  if (!yearsError && !currentYear) {
    alerts.push({
      key: "missing-year",
      label: "Aucune année scolaire active",
      tone: "warn",
    });
  }
  if (studentsWithoutClass > 0) {
    alerts.push({
      key: "students-no-class",
      label: `${studentsWithoutClass} élève(s) sans classe affectée`,
      tone: "warn",
    });
  }
  if (teachersWithoutAssignment > 0) {
    alerts.push({
      key: "teachers-no-assignment",
      label: `${teachersWithoutAssignment} enseignant(s) sans affectation`,
      tone: "info",
    });
  }

  const visibleSchooling = schoolingTiles.filter((tile) => canReadView(ctx, tile.view));
  const visibleAdmin = adminTiles.filter((tile) => canReadView(ctx, tile.view));
  const visibleActions = actions.filter((action) => canReadView(ctx, action.view));

  return (
    <div className="space-y-6" data-testid="schooling-hub">
      <header>
        <h1 className="text-2xl font-black text-ink">Scolarité</h1>
        <p className="mt-1 text-sm text-muted" data-testid="schooling-year">
          {[schoolLabel, yearLabel].filter(Boolean).join(" · ")}
        </p>
      </header>

      {visibleScopeError ? (
        <InlineAlert tone="danger" title="Périmètre">
          {visibleScopeError}
        </InlineAlert>
      ) : null}

      {visibleSchooling.length ? (
        <section>
          <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-brand">
            {SCOLARITE_COPY.indicators}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleSchooling.map((tile) => (
              <KpiTile key={tile.key} tile={tile} />
            ))}
          </div>
        </section>
      ) : null}

      {visibleActions.length ? (
        <section>
          <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-brand">
            {SCOLARITE_COPY.actions}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.key}
                  to={action.to}
                  className="flex min-h-11 items-start gap-3 rounded-2xl border border-line bg-white p-4 transition hover:border-brand/40 hover:shadow-md"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand">
                    <Icon className="h-5 w-5" strokeWidth={1.8} />
                  </span>
                  <span>
                    <span className="block text-sm font-black text-ink">{action.label}</span>
                    <span className="mt-1 block text-sm text-muted">{action.description}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {visibleAdmin.length ? (
        <section>
          <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-brand">
            {SCOLARITE_COPY.administration}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleAdmin.map((tile) => (
              <KpiTile key={tile.key} tile={tile} />
            ))}
          </div>
        </section>
      ) : null}

      <Card className="p-5">
        <SectionHeader
          title="Alertes"
          description="Points d'attention détectés sur les données de l'établissement."
        />
        <div className="mt-4 space-y-2">
          {alerts.length === 0 ? (
            <p className="text-sm text-muted">Aucune alerte. Les données sont cohérentes.</p>
          ) : (
            alerts.map((alert) => (
              <div
                key={alert.key}
                className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                  alert.tone === "warn"
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-sky-200 bg-sky-50 text-sky-800"
                }`}
              >
                {alert.label}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function KpiTile({ tile }: { tile: OverviewTile }) {
  const Icon = tile.icon;
  return (
    <Link
      to={tile.to}
      data-testid={`schooling-kpi-${tile.key}`}
      className="group flex min-h-11 flex-col rounded-2xl border border-line bg-white p-5 transition hover:border-brand/40 hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand">
          <Icon className="h-5 w-5" strokeWidth={1.8} />
        </span>
        <span className="text-3xl font-black text-ink">{tile.count}</span>
      </div>
      <h2 className="mt-4 text-base font-black text-ink">{tile.label}</h2>
      <span className="mt-2 text-sm font-semibold text-brand group-hover:underline">Ouvrir →</span>
    </Link>
  );
}
