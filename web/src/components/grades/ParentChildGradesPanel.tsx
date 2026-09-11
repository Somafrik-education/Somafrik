import type { Evaluation, StudentGrade } from "../../types";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { Card, SectionHeader } from "../ui/Card";
import { Table, type Column } from "../ui/Table";
import { GradeBookService, formatStudentName } from "../../lib/gradeBook";
import { scopedCourses } from "../../lib/establishment";
import { parentGradesKpis } from "../../lib/parentNotes";

type StudentRow = Record<string, unknown>;

interface ParentChildGradesPanelProps {
  student: StudentRow | null;
  grades: StudentGrade[];
  evaluations: Evaluation[];
  period: string;
  courseFilter?: string;
  highlightGradeId?: string;
}

function evaluationTitle(evaluations: Evaluation[], evaluationId: string) {
  return evaluations.find((row) => row.id === evaluationId)?.title ?? "—";
}

function evaluationDate(evaluations: Evaluation[], grade: StudentGrade) {
  const fromEval = evaluations.find((row) => row.id === grade.evaluationId)?.date;
  return String(grade.date || grade.validatedAt || fromEval || "—");
}

function formatScore(value: number | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return String(value).replace(".", ",");
}

function formatAverage(value: number | null) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1).replace(".", ",")} / 20`;
}

export function ParentChildGradesPanel({
  student,
  grades,
  evaluations,
  period,
  courseFilter = "",
  highlightGradeId = "",
}: ParentChildGradesPanelProps) {
  const { session } = useAuth();
  const { state } = useData();
  const { scopedUser } = useActiveSchool();
  const kpis = parentGradesKpis(grades, courseFilter);

  const canonicalCourses = scopedCourses(scopedUser ?? session?.user ?? null, state).map((row) => ({
    name: String(row.name ?? row.subject ?? row.course ?? ""),
    coefficient: Number(row.coefficient ?? 1),
    className: String(row.className ?? ""),
  }));
  const gradeBookStudent = student
    ? {
        id: String(student.id ?? ""),
        className: String(student.className ?? ""),
        name: String(student.name ?? ""),
        firstName: String(student.firstName ?? ""),
        lastName: String(student.lastName ?? ""),
      }
    : null;
  const canonicalGeneralAverage =
    gradeBookStudent && grades.length
      ? new GradeBookService([gradeBookStudent], grades, canonicalCourses).getStudentAverageValue(
          gradeBookStudent.id,
          period,
        )
      : null;
  const displayedAverage = courseFilter ? kpis.average : canonicalGeneralAverage;

  const columns: Column<StudentGrade>[] = [
    { key: "subject", header: "Cours", render: (row) => row.subject },
    {
      key: "evaluation",
      header: "Évaluation",
      render: (row) => evaluationTitle(evaluations, row.evaluationId),
    },
    {
      key: "value",
      header: "Note",
      render: (row) => formatScore(row.value),
    },
    {
      key: "scale",
      header: "/20",
      render: (row) => `/${row.scale ?? 20}`,
    },
    {
      key: "date",
      header: "Date",
      render: (row) => evaluationDate(evaluations, row),
    },
  ];

  if (!student) {
    return <p className="text-sm text-muted">Sélectionnez un enfant pour consulter ses notes.</p>;
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <SectionHeader
          title={formatStudentName(student)}
          description={period || "Toutes les périodes"}
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-surface px-3 py-2">
            <p className="text-xs text-muted">{kpis.averageLabel}</p>
            <p className="text-xl font-semibold text-ink">{formatAverage(displayedAverage)}</p>
          </div>
          <div className="rounded-lg border border-line bg-surface px-3 py-2">
            <p className="text-xs text-muted">Évaluations</p>
            <p className="text-xl font-semibold text-ink">{kpis.evaluationCount}</p>
          </div>
          <div className="rounded-lg border border-line bg-surface px-3 py-2">
            <p className="text-xs text-muted">Cours évalués</p>
            <p className="text-xl font-semibold text-ink">{kpis.courseCount}</p>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <SectionHeader title="Notes de l'enfant" />
        <div className="mt-4">
          <Table
            columns={columns}
            rows={grades}
            rowKey={(row) => row.id}
            isRowSelected={(row) => Boolean(highlightGradeId) && String(row.id) === highlightGradeId}
          />
        </div>
      </Card>
    </div>
  );
}
