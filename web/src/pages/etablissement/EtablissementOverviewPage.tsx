import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Contact,
  GraduationCap,
  Link2,
  School,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Card, SectionHeader } from "../../components/ui/Card";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { canReadView } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import {
  scopedAssignments,
  scopedContacts,
  scopedRelations,
  scopedStudents,
  scopedTeachers,
  scopedClasses,
} from "../../lib/establishment";

type Row = Record<string, unknown>;

interface OverviewTile {
  key: string;
  label: string;
  to: string;
  view: string;
  icon: LucideIcon;
  count: number;
}

/** WEB-ME-001 — Tableau de bord Mon établissement (compteurs + accès rapides + alertes). */
export function EtablissementOverviewPage() {
  const { state } = useData();
  const { scopedUser } = useActiveSchool();
  const ctx = usePermissionContext();

  const { tiles, alerts } = useMemo(() => {
    const students = scopedStudents(scopedUser, state);
    const teachers = scopedTeachers(scopedUser, state, students);
    const classes = scopedClasses(scopedUser, state, students);
    const contacts = scopedContacts(scopedUser, state);
    const assignments = scopedAssignments(scopedUser, state);
    const relations = scopedRelations(scopedUser, state);

    const allTiles: OverviewTile[] = [
      {
        key: "contacts",
        label: "Contacts",
        to: "/etablissement/contacts",
        view: "contacts",
        icon: Contact,
        count: contacts.length,
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
        key: "students",
        label: "Élèves",
        to: "/etablissement/eleves",
        view: "students",
        icon: GraduationCap,
        count: students.length,
      },
      {
        key: "teachers",
        label: "Enseignants",
        to: "/etablissement/enseignants",
        view: "teachers",
        icon: Users,
        count: teachers.length,
      },
      {
        key: "relations",
        label: "Parents & élèves",
        to: "/etablissement/relations-parent-enfant",
        view: "relations",
        icon: Link2,
        count: relations.length,
      },
    ];

    const studentsWithoutClass = students.filter(
      (student) => !String((student as Row).className ?? "").trim(),
    ).length;
    const teachersWithoutAssignment = teachers.filter((teacher) => {
      const id = String((teacher as Row).id ?? "");
      const name = String((teacher as Row).name ?? "");
      return !assignments.some(
        (assignment) =>
          String((assignment as Row).teacherId ?? "") === id ||
          String((assignment as Row).teacherName ?? "") === name,
      );
    }).length;

    const nextAlerts: { key: string; label: string; tone: "warn" | "info" }[] = [];
    if (studentsWithoutClass > 0) {
      nextAlerts.push({
        key: "students-no-class",
        label: `${studentsWithoutClass} élève(s) sans classe affectée`,
        tone: "warn",
      });
    }
    if (teachersWithoutAssignment > 0) {
      nextAlerts.push({
        key: "teachers-no-assignment",
        label: `${teachersWithoutAssignment} enseignant(s) sans affectation`,
        tone: "info",
      });
    }

    return {
      tiles: allTiles.filter((tile) => canReadView(ctx, tile.view)),
      alerts: nextAlerts,
    };
  }, [scopedUser, state, ctx]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.key}
              to={tile.to}
              className="group flex flex-col rounded-2xl border border-line bg-white p-5 transition hover:border-brand/40 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand">
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <span className="text-3xl font-black text-ink">{tile.count}</span>
              </div>
              <h2 className="mt-4 text-base font-black text-ink">{tile.label}</h2>
              <span className="mt-2 text-sm font-semibold text-brand group-hover:underline">
                Ouvrir →
              </span>
            </Link>
          );
        })}
      </div>

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
