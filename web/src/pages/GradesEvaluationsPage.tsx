import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { StatusBadge } from "../components/ui/Badge";
import { Table, type Column } from "../components/ui/Table";
import { Modal } from "../components/ui/Modal";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import { classNamesMatch } from "../lib/classRules";
import { scopedClasses, scopedStudents, listTeacherScopedClassLabels } from "../lib/establishment";
import {
  allGrades,
  appendGradeAuditLog,
  canDeleteEvaluation,
  canEditEvaluation,
  correctValidatedGrade,
  deactivateEvaluation,
  buildEvaluationsFromExams,
  ensureEvaluationsSynced,
  gradesToLegacyNotes,
  publishEvaluation,
  resolveGradesPeriod,
  scopedEvaluations,
  scopedGrades,
  syncBulletinsForClass,
  teacherCanAccessEvaluation,
  updateEvaluation,
  validateEvaluationGrades,
} from "../lib/evaluations";
import {
  canCorrectValidatedGrades,
  canPublishGrades,
  canValidateGrades,
} from "../lib/gradePermissions";
import { downloadCsv, rowsToCsv } from "../lib/csv";
import { EvaluationFormModal } from "../components/grades/EvaluationFormModal";
import { GradeEntryGrid } from "../components/grades/GradeEntryGrid";
import { ClassGradesOverview } from "../components/grades/ClassGradesOverview";
import { StudentGradesPanel } from "../components/grades/StudentGradesPanel";
import type { Evaluation, StudentGrade } from "../types";

type TabKey = "evaluations" | "saisie" | "classe" | "eleve" | "stats";

const TABS: { key: TabKey; label: string }[] = [
  { key: "evaluations", label: "Évaluations" },
  { key: "saisie", label: "Saisie des notes" },
  { key: "classe", label: "Par classe" },
  { key: "eleve", label: "Par élève" },
  { key: "stats", label: "Statistiques" },
];

function uniqueClassNames(students: Record<string, unknown>[], classes: Record<string, unknown>[]) {
  const fromStudents = [...new Set(students.map((row) => String(row.className ?? "").trim()).filter(Boolean))];
  if (fromStudents.length) return fromStudents.sort();
  return [...new Set(classes.map((row) => String(row.name ?? "").trim()).filter(Boolean))].sort();
}

export function GradesEvaluationsPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const { scopedUser, activeSchoolCode } = useActiveSchool();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const scopeUser = scopedUser ?? session?.user ?? null;
  const { canRead, canCreate, canUpdate } = useFeaturePermissions("Notes");

  const students = scopedStudents(scopeUser, state) as Record<string, unknown>[];
  const classes = scopedClasses(scopeUser, state, students) as Record<string, unknown>[];
  const classNames = useMemo(() => {
    const teacherLabels = listTeacherScopedClassLabels(scopeUser, state, students, classes);
    if (teacherLabels?.length) return teacherLabels;
    return uniqueClassNames(students, classes);
  }, [scopeUser, state, students, classes]);
  const code = String(activeSchoolCode ?? scopeUser?.schoolCode ?? "").trim();
  const defaultPeriod = useMemo(
    () => resolveGradesPeriod(state, code, scopeUser),
    [state, code, scopeUser],
  );

  const evaluations = useMemo(() => {
    const synced = ensureEvaluationsSynced(state, code);
    return scopedEvaluations(scopeUser, { ...state, evaluations: synced });
  }, [state, scopeUser, code]);

  const grades = scopedGrades(scopeUser, state);

  const [tab, setTab] = useState<TabKey>("evaluations");
  const [period, setPeriod] = useState("");
  const [selectedClass, setSelectedClass] = useState(classNames[0] ?? "");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedEvaluationId, setSelectedEvaluationId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvaluation, setEditingEvaluation] = useState<Evaluation | null>(null);
  const [correctionGrade, setCorrectionGrade] = useState<StudentGrade | null>(null);
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    const imported = buildEvaluationsFromExams(state, code);
    if (!imported.length) return;
    void update({ evaluations: [...(state.evaluations ?? []), ...imported] });
  }, [code, state.exams?.length]);

  useEffect(() => {
    setPeriod(defaultPeriod);
  }, [defaultPeriod]);

  useEffect(() => {
    if (!classNames.length) return;
    setSelectedClass((current) =>
      current && classNames.includes(current) ? current : classNames[0],
    );
  }, [classNames]);

  const filteredEvaluations = evaluations.filter(
    (evaluation) => !period || evaluation.period === period,
  );

  const selectedEvaluation =
    evaluations.find((evaluation) => evaluation.id === selectedEvaluationId) ?? null;

  async function persistState(patch: {
    evaluations?: Evaluation[];
    notes?: unknown[];
    bulletins?: unknown[];
    auditLog?: unknown[];
  }) {
    setBusy(true);
    try {
      await update(patch);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEvaluation(evaluation: Evaluation) {
    const current = state.evaluations ?? [];
    const exists = current.some((row) => row.id === evaluation.id);
    let nextEvaluations: Evaluation[];

    if (exists && editingEvaluation) {
      const result = updateEvaluation(editingEvaluation, evaluation, scopeUser, state);
      if (result.error) {
        showToast(result.error, "error");
        return;
      }
      nextEvaluations = current.map((row) => (row.id === evaluation.id ? result.evaluation : row));
    } else {
      nextEvaluations = [...current, evaluation];
    }

    await persistState({
      evaluations: nextEvaluations,
      auditLog: appendGradeAuditLog(
        state.auditLog,
        exists ? "evaluation.update" : "evaluation.create",
        scopeUser,
        { evaluationId: evaluation.id, title: evaluation.title },
      ),
    });
    showToast(exists ? "Évaluation mise à jour" : "Évaluation créée");
    setEditingEvaluation(null);
  }

  async function handleDeactivate(evaluation: Evaluation) {
    const relatedGrades = grades.filter((grade) => grade.evaluationId === evaluation.id);
    if (!canDeleteEvaluation(evaluation, relatedGrades)) {
      showToast("Suppression impossible : des notes validées existent.", "error");
      return;
    }
    const proceed = await confirm({
      title: "Désactiver l'évaluation",
      description: "L'évaluation sera annulée et exclue des futurs calculs. Les notes restent consultables.",
      confirmLabel: "Désactiver",
    });
    if (!proceed) return;

    const next = (state.evaluations ?? []).map((row) =>
      row.id === evaluation.id ? deactivateEvaluation(row, scopeUser) : row,
    );
    await persistState({
      evaluations: next,
      auditLog: appendGradeAuditLog(state.auditLog, "evaluation.deactivate", scopeUser, {
        evaluationId: evaluation.id,
      }),
    });
    showToast("Évaluation désactivée");
  }

  async function handleValidateEvaluation(evaluation: Evaluation) {
    if (!canValidateGrades(scopeUser)) {
      showToast("Validation réservée au préfet ou à l'administration.", "error");
      return;
    }
    const { evaluation: validatedEval, grades: nextGrades } = validateEvaluationGrades(
      evaluation,
      allGrades(state),
      scopeUser,
    );
    const nextEvaluations = (state.evaluations ?? []).map((row) =>
      row.id === evaluation.id ? validatedEval : row,
    );
    await persistState({
      evaluations: nextEvaluations,
      notes: gradesToLegacyNotes(nextGrades),
      auditLog: appendGradeAuditLog(state.auditLog, "evaluation.validate", scopeUser, {
        evaluationId: evaluation.id,
      }),
    });
    showToast("Notes validées");
  }

  async function handlePublishEvaluation(evaluation: Evaluation) {
    if (!canPublishGrades(scopeUser)) {
      showToast("Publication non autorisée.", "error");
      return;
    }
    const published = publishEvaluation(evaluation, scopeUser);
    const nextEvaluations = (state.evaluations ?? []).map((row) =>
      row.id === evaluation.id ? published : row,
    );
    const bulletins = syncBulletinsForClass(
      state,
      code,
      evaluation.className,
      evaluation.period,
      students,
      allGrades(state),
    );
    await persistState({
      evaluations: nextEvaluations,
      bulletins,
      auditLog: appendGradeAuditLog(state.auditLog, "evaluation.publish", scopeUser, {
        evaluationId: evaluation.id,
      }),
    });
    showToast("Évaluation publiée — bulletins mis à jour");
  }

  async function handleGradesChange(nextGrades: StudentGrade[]) {
    await persistState({ notes: gradesToLegacyNotes(nextGrades) });
  }

  async function handleCorrection() {
    if (!correctionGrade) return;
    const result = correctValidatedGrade(
      allGrades(state),
      correctionGrade.id,
      Number(correctionValue.replace(",", ".")),
      correctionReason,
      scopeUser,
    );
    if (result.error) {
      showToast(result.error, "error");
      return;
    }
    await persistState({
      notes: gradesToLegacyNotes(result.grades),
      auditLog: appendGradeAuditLog(state.auditLog, "grade.correct", scopeUser, {
        gradeId: correctionGrade.id,
      }),
    });
    setCorrectionGrade(null);
    setCorrectionValue("");
    setCorrectionReason("");
    showToast("Correction enregistrée");
  }

  function exportGrades() {
    const columns = [
      { key: "eleve", header: "Élève" },
      { key: "matiere", header: "Matière" },
      { key: "periode", header: "Période" },
      { key: "note", header: "Note" },
      { key: "bareme", header: "Barème" },
      { key: "statut", header: "Statut" },
      { key: "evaluation", header: "Évaluation" },
    ];
    const rows = grades
      .filter((grade) => !period || grade.period === period)
      .map((grade) => ({
        eleve: grade.studentName,
        matiere: grade.subject,
        periode: grade.period,
        note: grade.value ?? "",
        bareme: grade.scale,
        statut: grade.gradeStatus,
        evaluation: grade.evaluationId,
      }));
    const csv = rowsToCsv(rows, columns);
    downloadCsv(`notes-${code}-${period}`, csv);
    void persistState({
      auditLog: appendGradeAuditLog(state.auditLog, "grades.export", scopeUser, { period }),
    });
    showToast("Export CSV généré");
  }

  const evaluationColumns: Column<Evaluation>[] = [
    { key: "title", header: "Titre", render: (row) => row.title },
    { key: "className", header: "Classe", render: (row) => row.className },
    { key: "subject", header: "Matière", render: (row) => row.subject },
    { key: "type", header: "Type", render: (row) => row.evaluationType },
    { key: "period", header: "Période", render: (row) => row.period },
    { key: "scale", header: "Barème", render: (row) => `/${row.scale}` },
    { key: "coef", header: "Coef.", render: (row) => row.coefficient },
    {
      key: "status",
      header: "Statut",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {canUpdate && canEditEvaluation(row, state) ? (
            <Button
              variant="secondary"
              className="text-xs"
              onClick={() => {
                setEditingEvaluation(row);
                setFormOpen(true);
              }}
            >
              Modifier
            </Button>
          ) : null}
          {canUpdate && row.status !== "Validée" && row.status !== "Publiée" ? (
            <Button variant="secondary" className="text-xs" onClick={() => void handleValidateEvaluation(row)}>
              Valider
            </Button>
          ) : null}
          {canPublishGrades(scopeUser) && row.status === "Validée" ? (
            <Button variant="secondary" className="text-xs" onClick={() => void handlePublishEvaluation(row)}>
              Publier
            </Button>
          ) : null}
          {canUpdate ? (
            <Button variant="secondary" className="text-xs" onClick={() => void handleDeactivate(row)}>
              Désactiver
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  if (!canRead) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted">Accès aux notes non autorisé pour votre rôle.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <SectionHeader
          title="Notes & évaluations"
          description="Création d'évaluations, saisie des notes, moyennes, validation et préparation des bulletins."
          actions={
            <div className="flex flex-wrap gap-2">
              <PrintButton />
              <Button variant="secondary" onClick={exportGrades}>
                Exporter CSV
              </Button>
              {canCreate ? (
                <Button
                  onClick={() => {
                    setEditingEvaluation(null);
                    setFormOpen(true);
                  }}
                >
                  Nouvelle évaluation
                </Button>
              ) : null}
            </div>
          }
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((item) => (
            <Button
              key={item.key}
              variant={tab === item.key ? "primary" : "secondary"}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Période">
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          {tab !== "eleve" ? (
            <Field label="Classe">
              <Select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                options={classNames.map((name) => ({ value: name, label: name }))}
              />
            </Field>
          ) : (
            <Field label="Élève">
              <Select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                options={[
                  { value: "", label: "Choisir…" },
                  ...students.map((student) => ({
                    value: String(student.id ?? ""),
                    label: String(student.name ?? student.id ?? ""),
                  })),
                ]}
              />
            </Field>
          )}
        </div>
      </Card>

      {tab === "evaluations" ? (
        <Card className="p-6">
          <Table
            columns={evaluationColumns}
            rows={filteredEvaluations}
            rowKey={(row) => row.id}
          />
        </Card>
      ) : null}

      {tab === "saisie" ? (
        <Card className="p-6">
          <Field label="Évaluation">
            <Select
              value={selectedEvaluationId}
              onChange={(e) => setSelectedEvaluationId(e.target.value)}
              options={[
                { value: "", label: "Choisir une évaluation…" },
                ...filteredEvaluations
                  .filter((evaluation) => !selectedClass || classNamesMatch(evaluation.className, selectedClass))
                  .map((evaluation) => ({
                    value: evaluation.id,
                    label: `${evaluation.title} — ${evaluation.subject}`,
                  })),
              ]}
            />
          </Field>
          {selectedEvaluation ? (
            <div className="mt-4">
              <GradeEntryGrid
                evaluation={selectedEvaluation}
                students={students}
                grades={allGrades(state)}
                canEdit={
                  canUpdate &&
                  teacherCanAccessEvaluation(scopeUser, selectedEvaluation, state) &&
                  canEditEvaluation(selectedEvaluation, state)
                }
                user={scopeUser}
                onChange={(next) => void handleGradesChange(next)}
                onError={(message) => showToast(message, "error")}
              />
              {canCorrectValidatedGrades(scopeUser) ? (
                <div className="mt-4">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const validated = grades.find(
                        (grade) =>
                          grade.evaluationId === selectedEvaluation.id &&
                          (grade.gradeStatus === "Validée" || grade.gradeStatus === "Corrigée"),
                      );
                      if (!validated) {
                        showToast("Aucune note validée à corriger pour cette évaluation.", "error");
                        return;
                      }
                      setCorrectionGrade(validated);
                      setCorrectionValue(String(validated.value ?? ""));
                    }}
                  >
                    Corriger une note validée
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {tab === "classe" ? (
        <ClassGradesOverview
          className={selectedClass}
          period={period}
          state={state}
          user={scopeUser}
        />
      ) : null}

      {tab === "eleve" ? (
        <StudentGradesPanel
          student={students.find((row) => String(row.id) === selectedStudentId) ?? null}
          state={state}
          user={scopeUser}
          period={period}
        />
      ) : null}

      {tab === "stats" ? (
        <ClassGradesOverview
          className={selectedClass}
          period={period}
          state={state}
          user={scopeUser}
          difficultyThreshold={10}
        />
      ) : null}

      <EvaluationFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingEvaluation(null);
        }}
        onSave={(evaluation) => void handleSaveEvaluation(evaluation)}
        state={state}
        schoolCode={code}
        classNames={classNames}
        user={scopeUser}
        initial={editingEvaluation}
      />

      <Modal
        open={Boolean(correctionGrade)}
        onClose={() => setCorrectionGrade(null)}
        title="Correction d'une note validée"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCorrectionGrade(null)}>
              Annuler
            </Button>
            <Button disabled={busy} onClick={() => void handleCorrection()}>
              Enregistrer la correction
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Nouvelle note">
            <Input
              type="number"
              value={correctionValue}
              onChange={(e) => setCorrectionValue(e.target.value)}
            />
          </Field>
          <Field label="Motif (obligatoire)">
            <Input value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
