import { useMemo } from "react";
import type { Evaluation, StudentGrade } from "../../types";
import { Card, SectionHeader } from "../ui/Card";
import { Table, type Column } from "../ui/Table";
import { formatStudentName } from "../../lib/gradeBook";
import { buildGradeBook } from "../../lib/evaluations";
import type { BackOfficeState, SessionUser } from "../../types";

type StudentRow = Record<string, unknown>;

interface ParentChildGradesPanelProps {
  student: StudentRow | null;
  grades: StudentGrade[];
  evaluations: Evaluation[];
  state: BackOfficeState;
  user: SessionUser | null;
  period: string;
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

export function ParentChildGradesPanel({
  student,
  grades,
  evaluations,
  state,
  user,
  period,
  highlightGradeId = "",
}: ParentChildGradesPanelProps) {
  const studentId = String(student?.id ?? "");
  const gradeBook = useMemo(() => buildGradeBook(state, user, period), [state, user, period]);
  const averages = studentId ? gradeBook.getStudentAverage(studentId, period) : null;
  const subjects = averages?.subjects ?? [];

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
            <p className="text-xs text-muted">Moyenne générale</p>
            <p className="text-xl font-semibold text-ink">
              {averages ? `${averages.average.toFixed(1).replace(".", ",")} / 20` : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-surface px-3 py-2">
            <p className="text-xs text-muted">Évaluations</p>
            <p className="text-xl font-semibold text-ink">{grades.length}</p>
          </div>
          <div className="rounded-lg border border-line bg-surface px-3 py-2">
            <p className="text-xs text-muted">Cours évalués</p>
            <p className="text-xl font-semibold text-ink">{subjects.length}</p>
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
