import { useMemo } from "react";
import { Card, SectionHeader } from "../ui/Card";
import { Table, type Column } from "../ui/Table";
import { buildGradeBook, scopedGrades } from "../../lib/evaluations";
import { scopedStudents } from "../../lib/establishment";
import { formatStudentName } from "../../lib/gradeBook";
import type { BackOfficeState, SessionUser } from "../../types";
import type { ClassRankingRow } from "../../lib/gradeBook";
import { normalize } from "../../lib/format";

interface ClassGradesOverviewProps {
  className: string;
  period: string;
  state: BackOfficeState;
  user: SessionUser | null;
  difficultyThreshold?: number;
}

export function ClassGradesOverview({
  className,
  period,
  state,
  user,
  difficultyThreshold = 10,
}: ClassGradesOverviewProps) {
  const gradeBook = useMemo(() => buildGradeBook(state, user, period), [state, user, period]);
  const ranking = className ? gradeBook.getClassRanking(className, period) : [];
  const stats = className ? gradeBook.getClassStatistics(className, period) : null;
  const atRisk = className ? gradeBook.getStudentsAtRisk(className, difficultyThreshold, period) : [];
  const classStudentCount = useMemo(() => {
    const students = scopedStudents(user, state);
    return students.filter((student) => normalize(String(student.className ?? "")) === normalize(className)).length;
  }, [user, state, className]);
  const gradedCount = useMemo(() => {
    if (!className || !period) return 0;
    const classStudentIds = new Set(
      scopedStudents(user, state)
        .filter((student) => normalize(String(student.className ?? "")) === normalize(className))
        .map((student) => String(student.id ?? ""))
        .filter(Boolean),
    );
    return scopedGrades(user, state).filter(
      (grade) =>
        normalize(grade.period) === normalize(period) && classStudentIds.has(grade.studentId),
    ).length;
  }, [user, state, className, period]);

  const columns: Column<ClassRankingRow>[] = [
    { key: "rank", header: "Rang", render: (row) => row.rank },
    { key: "student", header: "Élève", render: (row) => formatStudentName(row.student) },
    {
      key: "average",
      header: "Moyenne /20",
      render: (row) => (row.average > 0 ? row.average.toFixed(2) : "—"),
    },
  ];

  if (!className) {
    return <p className="text-sm text-muted">Sélectionnez une classe.</p>;
  }

  if (classStudentCount > 0 && gradedCount === 0) {
    return (
      <Card className="border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-ink">Aucune note pour cette période</p>
        <p className="mt-1 text-sm text-muted">
          La période « {period} » ne contient pas encore de notes pour {className}. Choisissez une autre
          période ou saisissez des notes dans l&apos;onglet « Saisie des notes ».
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs text-muted">Moyenne de classe</p>
            <p className="text-2xl font-semibold text-ink">{stats.classAverage.toFixed(2)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">Meilleure moyenne</p>
            <p className="text-2xl font-semibold text-ink">{stats.bestAverage.toFixed(2)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">Plus faible</p>
            <p className="text-2xl font-semibold text-ink">{stats.lowestAverage.toFixed(2)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">Taux de réussite</p>
            <p className="text-2xl font-semibold text-ink">{stats.successRate}%</p>
          </Card>
        </div>
      ) : null}

      {atRisk.length ? (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <SectionHeader
            title="Élèves en difficulté"
            description={`Moyenne inférieure à ${difficultyThreshold}/20`}
          />
          <p className="mt-2 text-sm text-ink">
            {atRisk.map((row) => formatStudentName(row.student)).join(", ")}
          </p>
        </Card>
      ) : null}

      <Card className="p-4">
        <SectionHeader title={`Classement — ${className}`} description={period} />
        <div className="mt-4">
          <Table columns={columns} rows={ranking} rowKey={(row) => String(row.student.id ?? "")} />
        </div>
      </Card>
    </div>
  );
}
