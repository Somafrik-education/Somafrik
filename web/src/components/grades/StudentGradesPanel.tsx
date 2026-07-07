import { useMemo } from "react";
import type { StudentGrade } from "../../types";
import { Card, SectionHeader } from "../ui/Card";
import { Table, type Column } from "../ui/Table";
import { buildGradeBook, scopedGrades } from "../../lib/evaluations";
import { formatStudentName } from "../../lib/gradeBook";
import type { BackOfficeState, SessionUser } from "../../types";

type StudentRow = Record<string, unknown>;

interface StudentGradesPanelProps {
  student: StudentRow | null;
  state: BackOfficeState;
  user: SessionUser | null;
  period: string;
}

export function StudentGradesPanel({ student, state, user, period }: StudentGradesPanelProps) {
  const studentId = String(student?.id ?? "");
  const grades = scopedGrades(user, state).filter(
    (grade) => grade.studentId === studentId && (!period || grade.period === period),
  );

  const gradeBook = useMemo(() => buildGradeBook(state, user, period), [state, user, period]);
  const averages = studentId ? gradeBook.getStudentAverage(studentId, period) : null;

  const columns: Column<StudentGrade>[] = [
    { key: "subject", header: "Matière", render: (row) => row.subject },
    { key: "period", header: "Période", render: (row) => row.period },
    { key: "value", header: "Note", render: (row) => (row.value != null ? `${row.value}/${row.scale}` : row.gradeStatus) },
    { key: "status", header: "Statut", render: (row) => row.gradeStatus },
    { key: "validatedAt", header: "Validée le", render: (row) => row.validatedAt ?? "—" },
  ];

  if (!student) {
    return <p className="text-sm text-muted">Sélectionnez un élève pour consulter ses notes.</p>;
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <SectionHeader
          title={formatStudentName(student)}
          description={`${String(student.className ?? "")} — ${period}`}
        />
        {averages ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="text-xs text-muted">Moyenne générale</p>
              <p className="text-xl font-semibold text-ink">{averages.average.toFixed(2)}/20</p>
            </div>
            <div className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="text-xs text-muted">Rang</p>
              <p className="text-xl font-semibold text-ink">{averages.rankLabel}</p>
            </div>
            <div className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="text-xs text-muted">Appréciation</p>
              <p className="text-sm font-semibold text-ink">{averages.appreciation}</p>
            </div>
            <div className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="text-xs text-muted">Matières notées</p>
              <p className="text-xl font-semibold text-ink">{averages.subjects.length}</p>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <SectionHeader title="Notes détaillées" />
        <div className="mt-4">
          <Table columns={columns} rows={grades} rowKey={(row) => row.id} />
        </div>
      </Card>

      {averages?.subjects.length ? (
        <Card className="p-4">
          <SectionHeader title="Moyennes par matière" />
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {averages.subjects.map((row) => (
              <div key={row.subject} className="rounded-lg border border-line px-3 py-2">
                <p className="text-sm font-semibold text-ink">{row.subject}</p>
                <p className="text-xs text-muted">
                  {row.average.toFixed(2)}/20 — coef. {row.coefficient} — {row.gradeCount} note(s)
                </p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {grades.some((grade) => (grade.audit ?? []).length) ? (
        <Card className="p-4">
          <SectionHeader title="Historique des corrections" />
          <div className="mt-4 space-y-2 text-sm">
            {grades.flatMap((grade) =>
              (grade.audit ?? [])
                .filter((entry) => entry.action === "grade.correct" || entry.oldValue != null)
                .map((entry, index) => (
                  <div key={`${grade.id}-${index}`} className="rounded-lg border border-line px-3 py-2">
                    <p className="font-medium text-ink">
                      {grade.subject} — {entry.date}
                    </p>
                    <p className="text-muted">
                      {entry.oldValue != null ? `${entry.oldValue} → ${entry.newValue}` : `Nouvelle note : ${entry.newValue}`}
                      {entry.reason ? ` — ${entry.reason}` : ""}
                    </p>
                  </div>
                )),
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
