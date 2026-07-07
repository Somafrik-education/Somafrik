import { useMemo, useState } from "react";
import type { Evaluation, GradeStatus, SessionUser, StudentGrade } from "../../types";
import { Button } from "../ui/Button";
import { Input, Select } from "../ui/Field";
import { Table, type Column } from "../ui/Table";
import {
  ABSENCE_GRADE_STATUSES,
  GRADE_STATUSES,
  gradesForEvaluation,
  upsertStudentGrade,
} from "../../lib/evaluations";
import { formatStudentName } from "../../lib/gradeBook";

type StudentRow = Record<string, unknown>;

interface GradeEntryGridProps {
  evaluation: Evaluation;
  students: StudentRow[];
  grades: StudentGrade[];
  canEdit: boolean;
  user: SessionUser | null;
  onChange: (grades: StudentGrade[]) => void;
  onError: (message: string) => void;
}

export function GradeEntryGrid({
  evaluation,
  students,
  grades,
  canEdit,
  user,
  onChange,
  onError,
}: GradeEntryGridProps) {
  const classStudents = useMemo(
    () =>
      students
        .filter((student) => String(student.className ?? "") === evaluation.className)
        .sort((a, b) => formatStudentName(a).localeCompare(formatStudentName(b), "fr")),
    [students, evaluation.className],
  );

  const evaluationGrades = gradesForEvaluation(grades, evaluation.id);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  function currentGrade(studentId: string): StudentGrade | undefined {
    return evaluationGrades.find((grade) => grade.studentId === studentId);
  }

  function saveGrade(student: StudentRow, rawValue: string, gradeStatus: GradeStatus) {
    const numeric = rawValue.trim() === "" ? undefined : Number(rawValue.replace(",", "."));
    const result = upsertStudentGrade(grades, evaluation, student, {
      value: numeric,
      gradeStatus,
      author: user,
    });
    if (result.error) {
      onError(result.error);
      return;
    }
    onChange(result.grades);
    setDraftValues((current) => {
      const next = { ...current };
      delete next[String(student.id ?? "")];
      return next;
    });
  }

  const columns: Column<StudentRow>[] = [
    {
      key: "name",
      header: "Élève",
      render: (row) => formatStudentName(row),
    },
    {
      key: "value",
      header: `Note /${evaluation.scale}`,
      render: (row) => {
        const studentId = String(row.id ?? "");
        const existing = currentGrade(studentId);
        const locked =
          existing?.gradeStatus === "Validée" || existing?.gradeStatus === "Corrigée" || !canEdit;
        const displayValue =
          draftValues[studentId] ??
          (existing?.value != null && !ABSENCE_GRADE_STATUSES.includes(existing.gradeStatus)
            ? String(existing.value)
            : "");

        return (
          <Input
            type="number"
            min={0}
            max={evaluation.scale}
            step={0.25}
            value={displayValue}
            disabled={locked}
            className="max-w-[120px]"
            onChange={(e) => setDraftValues((current) => ({ ...current, [studentId]: e.target.value }))}
            onBlur={(e) => {
              if (!e.target.value.trim()) return;
              saveGrade(row, e.target.value, existing?.gradeStatus ?? "Saisie");
            }}
          />
        );
      },
    },
    {
      key: "status",
      header: "Statut",
      render: (row) => {
        const studentId = String(row.id ?? "");
        const existing = currentGrade(studentId);
        return (
          <Select
            value={existing?.gradeStatus ?? "Saisie"}
            disabled={!canEdit}
            className="max-w-[180px]"
            onChange={(e) => {
              const status = e.target.value as GradeStatus;
              if (ABSENCE_GRADE_STATUSES.includes(status)) {
                saveGrade(row, "", status);
                return;
              }
              const raw = draftValues[studentId] ?? String(existing?.value ?? "");
              saveGrade(row, raw, status);
            }}
            options={GRADE_STATUSES.map((status) => ({ value: status, label: status }))}
          />
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (row) => {
        const studentId = String(row.id ?? "");
        const existing = currentGrade(studentId);
        if (!canEdit || existing?.gradeStatus === "Validée") return null;
        return (
          <Button
            variant="secondary"
            className="text-xs"
            onClick={() => {
              const raw = draftValues[studentId] ?? String(existing?.value ?? "");
              saveGrade(row, raw, existing?.gradeStatus ?? "Saisie");
            }}
          >
            Enregistrer
          </Button>
        );
      },
    },
  ];

  if (!classStudents.length) {
    return <p className="text-sm text-muted">Aucun élève dans cette classe.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {evaluation.title} — {evaluation.subject} — barème /{evaluation.scale} — coef.{" "}
          {evaluation.coefficient}
        </p>
        {canEdit ? (
          <Button
            variant="secondary"
            onClick={() => {
              let next = grades;
              for (const student of classStudents) {
                const studentId = String(student.id ?? "");
                const raw = draftValues[studentId];
                if (!raw?.trim()) continue;
                const result = upsertStudentGrade(next, evaluation, student, {
                  value: Number(raw.replace(",", ".")),
                  gradeStatus: currentGrade(studentId)?.gradeStatus ?? "Saisie",
                  author: user,
                });
                if (result.error) {
                  onError(result.error);
                  return;
                }
                next = result.grades;
              }
              onChange(next);
              setDraftValues({});
            }}
          >
            Enregistrer tout
          </Button>
        ) : null}
      </div>
      <Table columns={columns} rows={classStudents} rowKey={(row) => String(row.id ?? "")} />
    </div>
  );
}
