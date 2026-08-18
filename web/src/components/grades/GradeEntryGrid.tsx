import { useEffect, useMemo, useRef, useState } from "react";
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
import { classNamesMatch } from "../../lib/classRules";
import { formatStudentName } from "../../lib/gradeBook";

type StudentRow = Record<string, unknown>;

type GradeDraft = {
  value: string;
  gradeStatus: GradeStatus;
  dirty: boolean;
};

interface GradeEntryGridProps {
  evaluation: Evaluation;
  students: StudentRow[];
  grades: StudentGrade[];
  canEdit: boolean;
  user: SessionUser | null;
  onSave: (grades: StudentGrade[]) => Promise<void>;
  onError: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function GradeEntryGrid({
  evaluation,
  students,
  grades,
  canEdit,
  user,
  onSave,
  onError,
  onDirtyChange,
}: GradeEntryGridProps) {
  const classStudents = useMemo(
    () =>
      students
        .filter((student) => classNamesMatch(student.className, evaluation.className))
        .sort((a, b) => formatStudentName(a).localeCompare(formatStudentName(b), "fr")),
    [students, evaluation.className],
  );

  const evaluationGrades = gradesForEvaluation(grades, evaluation.id);
  const [drafts, setDrafts] = useState<Record<string, GradeDraft>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    setDrafts({});
    savingRef.current = false;
    setSaving(false);
  }, [evaluation.id]);

  function currentGrade(studentId: string): StudentGrade | undefined {
    return evaluationGrades.find((grade) => grade.studentId === studentId);
  }

  function draftFor(studentId: string): GradeDraft {
    const draft = drafts[studentId];
    if (draft) return draft;
    const existing = currentGrade(studentId);
    return {
      value:
        existing?.value != null && !ABSENCE_GRADE_STATUSES.includes(existing.gradeStatus)
          ? String(existing.value)
          : "",
      gradeStatus: existing?.gradeStatus ?? "Saisie",
      dirty: false,
    };
  }

  const hasDirtyRows = Object.values(drafts).some((draft) => draft.dirty);

  useEffect(() => {
    onDirtyChange?.(hasDirtyRows);
  }, [hasDirtyRows, onDirtyChange]);

  function updateDraft(studentId: string, patch: Partial<GradeDraft>) {
    setDrafts((current) => {
      const existingDraft = current[studentId] ?? draftFor(studentId);
      return {
        ...current,
        [studentId]: {
          ...existingDraft,
          ...patch,
          dirty: true,
        },
      };
    });
  }

  async function saveAll() {
    if (savingRef.current) return;
    const dirtyStudentIds = Object.entries(drafts)
      .filter(([, draft]) => draft.dirty)
      .map(([studentId]) => studentId);
    if (!dirtyStudentIds.length) return;

    let working = grades;
    const changed: StudentGrade[] = [];

    for (const studentId of dirtyStudentIds) {
      const student = classStudents.find((row) => String(row.id ?? "") === studentId);
      const draft = drafts[studentId];
      if (!student || !draft) continue;

      const isAbsence = ABSENCE_GRADE_STATUSES.includes(draft.gradeStatus);
      const rawValue = draft.value.trim();
      const numeric = isAbsence || rawValue === "" ? undefined : Number(rawValue.replace(",", "."));

      const result = upsertStudentGrade(working, evaluation, student, {
        value: numeric,
        gradeStatus: draft.gradeStatus,
        author: user,
      });
      if (result.error) {
        onError(`${formatStudentName(student)} : ${result.error}`);
        return;
      }

      working = result.grades;
      const persisted = result.grades.find(
        (grade) => grade.evaluationId === evaluation.id && grade.studentId === studentId,
      );
      if (persisted) changed.push(persisted);
    }

    if (!changed.length) return;

    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(changed);
      setDrafts((current) => {
        const next = { ...current };
        for (const studentId of dirtyStudentIds) delete next[studentId];
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur d'enregistrement des notes.";
      onError(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
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
        const draft = draftFor(studentId);
        const locked =
          existing?.gradeStatus === "Validée" || existing?.gradeStatus === "Corrigée" || !canEdit;

        return (
          <Input
            type="number"
            min={0}
            max={evaluation.scale}
            step={0.25}
            value={draft.value}
            disabled={locked || ABSENCE_GRADE_STATUSES.includes(draft.gradeStatus) || saving}
            aria-label={`Note /${evaluation.scale}`}
            className="max-w-[120px]"
            onChange={(e) => updateDraft(studentId, { value: e.target.value })}
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
        const draft = draftFor(studentId);
        const locked =
          existing?.gradeStatus === "Validée" || existing?.gradeStatus === "Corrigée" || !canEdit;
        return (
          <Select
            value={draft.gradeStatus}
            disabled={locked || saving}
            aria-label="Statut de la note"
            className="max-w-[180px]"
            onChange={(e) => {
              const gradeStatus = e.target.value as GradeStatus;
              updateDraft(studentId, {
                gradeStatus,
                value: ABSENCE_GRADE_STATUSES.includes(gradeStatus) ? "" : draft.value,
              });
            }}
            options={GRADE_STATUSES.map((status) => ({ value: status, label: status }))}
          />
        );
      },
    },
  ];

  if (!classStudents.length) {
    return <p className="text-sm text-muted">Aucun élève dans cette classe.</p>;
  }

  return (
    <div>
      {!canEdit && evaluation.status !== "Validée" ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2" role="status">
          <p className="text-sm font-semibold text-amber-900">En attente de validation</p>
          <p className="text-sm text-amber-800">
            La saisie des notes sera disponible après validation par le Préfet ou l'administration.
          </p>
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {evaluation.title} — {evaluation.subject} — barème /{evaluation.scale} — coef.{" "}
          {evaluation.coefficient}
        </p>
        {canEdit ? (
          <Button
            variant="secondary"
            disabled={!hasDirtyRows || saving}
            onClick={() => void saveAll()}
          >
            {saving ? "Enregistrement…" : "Enregistrer tout"}
          </Button>
        ) : null}
      </div>
      <Table columns={columns} rows={classStudents} rowKey={(row) => String(row.id ?? "")} />
    </div>
  );
}
