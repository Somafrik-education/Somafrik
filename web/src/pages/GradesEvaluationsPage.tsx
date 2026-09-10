import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useDeepLinkId } from "../lib/notificationDeepLink";
import { ApiError } from "../api/client";
import {
  EmptyState,
  ForbiddenState,
  InlineAlert,
  LoadingState,
  ToolLayout,
} from "../design-system";
import { pedagogyApi } from "../lib/pedagogyApi";
import { reportCardsApi } from "../lib/reportCardsApi";
import { classNamesMatch } from "../lib/classRules";
import { scopedClasses, scopedStudents, listTeacherScopedClassLabels } from "../lib/establishment";
import {
  allGrades,
  canDeleteEvaluation,
  canEditEvaluation,
  canEnterGradesForEvaluation,
  correctValidatedGrade,
  deactivateEvaluation,
  buildEvaluationsFromExams,
  ensureEvaluationsSynced,
  evaluationEntryProgressLabel,
  evaluationStatusAllowsGradeWrite,
  evaluationsEligibleForGradeEntry,
  gradesForEvaluation,
  gradesToLegacyNotes,
  gradeSaveActorScope,
  isTeacherSessionRole,
  pedagogyNoteWritePayload,
  publishEvaluation,
  resolveGradesPeriod,
  scopedEvaluations,
  scopedGrades,
  studentMatchesEvaluationClass,
  syncBulletinsForClass,
  updateEvaluation,
  validateEvaluationGrades,
} from "../lib/evaluations";
import {
  canCorrectValidatedGrades,
  canPublishGrades,
  canValidateGrades,
} from "../lib/gradePermissions";
import {
  EVALUATION_STATUS_FILTER_OPTIONS,
  evaluationsEmptyDescription,
  filterEvaluationsForQueue,
  periodFilterOptions,
  resolveEvaluationsQueueDefaults,
} from "../lib/evaluationQueue";
import { downloadCsv, rowsToCsv } from "../lib/csv";
import { EvaluationFormModal } from "../components/grades/EvaluationFormModal";
import { GradeEntryGrid } from "../components/grades/GradeEntryGrid";
import { ClassGradesOverview } from "../components/grades/ClassGradesOverview";
import { StudentGradesPanel } from "../components/grades/StudentGradesPanel";
import { ParentChildGradesPanel } from "../components/grades/ParentChildGradesPanel";
import {
  ALL_COURSES_FILTER,
  PARENT_NOTES_TABS,
  filterParentGrades,
  formatParentClassLabel,
  isParentLinkedStudentId,
  isParentNotesRole,
  parentCourseOptions,
  parentLinkedStudents,
  parentStudentLabel,
  type ParentNotesTabKey,
} from "../lib/parentNotes";
import type { Evaluation, StudentGrade } from "../types";
import { PEDAGOGY_COPY } from "../lib/pedagogyParityContract";

type StaffTabKey = "evaluations" | "saisie" | "classe" | "eleve" | "stats";
type TabKey = StaffTabKey | ParentNotesTabKey;

const STAFF_TABS: { key: StaffTabKey; label: string }[] = [
  { key: "evaluations", label: PEDAGOGY_COPY.evaluationsTitle },
  { key: "saisie", label: PEDAGOGY_COPY.gradeEntryTab },
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
  const { state, refresh, loading, error: syncError, retryFailedSync } = useData();
  const { scopedUser, activeSchoolCode } = useActiveSchool();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const scopeUser = scopedUser ?? session?.user ?? null;
  const { canRead, canCreate, canUpdate } = useFeaturePermissions("Notes");
  const parentMode = isParentNotesRole(scopeUser);
  const canEnterGrades = !parentMode && (canCreate || canUpdate);
  const canMutateEvaluations = !parentMode && canUpdate;
  const canCreateEvaluations = !parentMode && canCreate;

  const parentChildren = useMemo(
    () => (parentMode ? parentLinkedStudents(scopeUser, state) : []),
    [parentMode, scopeUser, state],
  );
  const students = (
    parentMode ? parentChildren : scopedStudents(scopeUser, state)
  ) as Record<string, unknown>[];
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
  const queueDefaults = useMemo(() => resolveEvaluationsQueueDefaults(scopeUser), [scopeUser]);

  const evaluations = useMemo(() => {
    const synced = ensureEvaluationsSynced(state, code);
    return scopedEvaluations(scopeUser, { ...state, evaluations: synced });
  }, [state, scopeUser, code]);

  const grades = parentMode
    ? scopedGrades(scopeUser, state).filter((grade) =>
        isParentLinkedStudentId(scopeUser, String(grade.studentId ?? ""), state),
      )
    : scopedGrades(scopeUser, state);

  const deepLinkGradeId = useDeepLinkId("gradeId");
  const deepLinkStudentId = useDeepLinkId("studentId");
  const appliedGradeRef = useRef("");

  const visibleTabs = parentMode ? PARENT_NOTES_TABS : STAFF_TABS;
  const [tab, setTab] = useState<TabKey>(parentMode ? "notes" : "evaluations");
  const [period, setPeriod] = useState(queueDefaults.periodFilter ?? "");
  const [statusFilter, setStatusFilter] = useState(queueDefaults.statusFilter);
  const [queueDefaultsKey, setQueueDefaultsKey] = useState("");
  const [selectedClass, setSelectedClass] = useState(classNames[0] ?? "");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedCourse, setSelectedCourse] = useState(ALL_COURSES_FILTER);
  const [selectedEvaluationId, setSelectedEvaluationId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvaluation, setEditingEvaluation] = useState<Evaluation | null>(null);
  const [correctionGrade, setCorrectionGrade] = useState<StudentGrade | null>(null);
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [gradeEntryDirty, setGradeEntryDirty] = useState(false);
  const handleGradeEntryDirtyChange = useCallback((dirty: boolean) => {
    setGradeEntryDirty(dirty);
  }, []);

  useEffect(() => {
    if (parentMode || !code) return;
    const imported = buildEvaluationsFromExams(state, code);
    if (!imported.length) return;
    void (async () => {
      for (const evaluation of imported) {
        const exists = (state.evaluations ?? []).some((row) => row.id === evaluation.id);
        if (exists) continue;
        await pedagogyApi.createEvaluation(evaluation as unknown as Record<string, unknown>);
      }
      await refresh();
    })();
  }, [code, parentMode, state.exams?.length]);

  useEffect(() => {
    const key = `${scopeUser?.id ?? ""}:${scopeUser?.role ?? ""}:${code}`;
    if (queueDefaultsKey === key) return;
    setPeriod(queueDefaults.periodFilter ?? defaultPeriod);
    setStatusFilter(queueDefaults.statusFilter);
    setQueueDefaultsKey(key);
  }, [code, defaultPeriod, queueDefaults, queueDefaultsKey, scopeUser?.id, scopeUser?.role]);

  useEffect(() => {
    if (!classNames.length) return;
    setSelectedClass((current) =>
      current && classNames.includes(current) ? current : classNames[0],
    );
  }, [classNames]);

  useEffect(() => {
    if (!parentMode) return;
    setTab((current) => {
      if (PARENT_NOTES_TABS.some((item) => item.key === current)) return current;
      return "notes";
    });
  }, [parentMode]);

  useEffect(() => {
    if (!parentMode) return;
    const linkedIds = new Set(parentChildren.map((row) => String(row.id ?? "")));
    setSelectedStudentId((current) => {
      if (deepLinkStudentId && isParentLinkedStudentId(scopeUser, deepLinkStudentId, state)) {
        return deepLinkStudentId;
      }
      if (current && linkedIds.has(current)) return current;
      if (parentChildren.length === 1) return String(parentChildren[0].id ?? "");
      return "";
    });
  }, [parentMode, parentChildren, deepLinkStudentId, scopeUser, state]);

  const selectedChild =
    students.find((row) => String(row.id) === selectedStudentId) ?? null;
  const parentGrades = filterParentGrades(grades, selectedStudentId, period, selectedCourse);
  const parentEvaluations = useMemo(() => {
    if (!parentMode || !selectedChild) return [];
    const className = String(selectedChild.className ?? "");
    return evaluations.filter((evaluation) => {
      if (evaluation.active === false) return false;
      if (String(evaluation.status) !== "Publiée") return false;
      if (className && !classNamesMatch(evaluation.className, className)) return false;
      if (selectedCourse && String(evaluation.subject ?? "") !== selectedCourse) return false;
      if (period && String(evaluation.period ?? "") !== period) return false;
      return true;
    });
  }, [parentMode, selectedChild, evaluations, selectedCourse, period]);
  const courseOptions = parentCourseOptions(grades.filter((grade) => String(grade.studentId) === selectedStudentId), parentEvaluations);

  const filteredEvaluations = parentMode
    ? parentEvaluations
    : filterEvaluationsForQueue(evaluations, period, statusFilter);
  const gradeEntryEvaluations = useMemo(
    () =>
      evaluationsEligibleForGradeEntry(scopeUser, evaluations, state).filter(
        (evaluation) => !selectedClass || classNamesMatch(evaluation.className, selectedClass),
      ),
    [evaluations, scopeUser, selectedClass, state],
  );
  const periodOptions = periodFilterOptions(state, code, evaluations);

  const selectedEvaluation =
    evaluations.find((evaluation) => evaluation.id === selectedEvaluationId) ?? null;

  // Deep-link notification : positionner la page sur l'élève, la période et
  // l'évaluation de la note visée, puis mettre cette note en évidence.
  useEffect(() => {
    if (!deepLinkGradeId || !canRead) return;
    if (appliedGradeRef.current === deepLinkGradeId) return;
    const grade = grades.find((row) => String(row.id) === deepLinkGradeId);
    if (!grade) return;
    if (parentMode && !isParentLinkedStudentId(scopeUser, String(grade.studentId ?? ""), state)) {
      return;
    }
    appliedGradeRef.current = deepLinkGradeId;
    const evaluation = evaluations.find((row) => row.id === grade.evaluationId) ?? null;
    const className = String(evaluation?.className ?? "");
    if (className && classNames.includes(className)) setSelectedClass(className);
    if (grade.period) setPeriod(grade.period);
    if (grade.evaluationId) setSelectedEvaluationId(String(grade.evaluationId));
    setSelectedStudentId(String(grade.studentId ?? ""));
    setTab(parentMode ? "notes" : "eleve");
  }, [deepLinkGradeId, canRead, grades, evaluations, classNames, parentMode, scopeUser, state]);

  async function confirmDiscardUnsavedGrades() {
    if (!gradeEntryDirty) return true;
    return confirm({
      title: "Notes non enregistrées",
      description: "Des notes non enregistrées seront perdues. Continuer ?",
      confirmLabel: "Continuer",
    });
  }

  function requestContextChange(apply: () => void) {
    if (!gradeEntryDirty) {
      apply();
      return;
    }
    void (async () => {
      if (!(await confirmDiscardUnsavedGrades())) return;
      apply();
    })();
  }

  async function persistState(patch: {
    evaluations?: Evaluation[];
    notes?: unknown[];
    bulletins?: unknown[];
    evaluation?: Evaluation;
  }) {
    setBusy(true);
    try {
      if (patch.evaluation) {
        const exists = (state.evaluations ?? []).some((row) => row.id === patch.evaluation?.id);
        if (exists) {
          await pedagogyApi.updateEvaluation(patch.evaluation.id, patch.evaluation as unknown as Record<string, unknown>);
        } else {
          await pedagogyApi.createEvaluation(patch.evaluation as unknown as Record<string, unknown>);
        }
      }
      if (patch.notes?.length) {
        const evaluations = state.evaluations ?? [];
        for (const note of patch.notes) {
          await pedagogyApi.upsertNote(
            pedagogyNoteWritePayload(note, evaluations, {
              teacherSession: isTeacherSessionRole(scopeUser?.role),
            }),
          );
        }
      }
      if (patch.bulletins) {
        for (const bulletin of patch.bulletins) {
          const row = bulletin as Record<string, unknown>;
          if (!row.studentId) continue;
          await reportCardsApi.generate({
            studentId: row.studentId,
            period: row.period,
            className: row.className,
          });
        }
      }
      await refresh();
      return { ok: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur de synchronisation";
      const code = err instanceof ApiError ? err.code : undefined;
      showToast(code ? `${message} (${code})` : message, "error");
      return { ok: false as const, message };
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

    // HOTFIX-SYNC-03 : ne pas envoyer auditLog (non writable client → 403 RBAC).
    const persisted = await persistState({
      evaluation: nextEvaluations.find((row) => row.id === evaluation.id) ?? evaluation,
    });
    if (!persisted.ok) {
      // Conservée localement (outbox failed) — ne pas afficher un succès trompeur.
      return;
    }
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
      evaluation: next.find((row) => row.id === evaluation.id) ?? deactivateEvaluation(evaluation, scopeUser),
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
      evaluation: nextEvaluations.find((row) => row.id === evaluation.id) ?? validatedEval,
      notes: gradesToLegacyNotes(nextGrades),
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
      evaluation: nextEvaluations.find((row) => row.id === evaluation.id) ?? published,
      bulletins,
    });
    showToast("Évaluation publiée — bulletins mis à jour");
  }

  async function handleSaveGrades(changedGrades: StudentGrade[]) {
    const teacherSession = isTeacherSessionRole(scopeUser?.role);
    const actorScope = gradeSaveActorScope(teacherSession, selectedEvaluation);
    for (const grade of changedGrades) {
      const [note] = gradesToLegacyNotes(
        actorScope.teacherId ? [{ ...grade, teacherId: actorScope.teacherId }] : [grade],
      );
      const payload = pedagogyNoteWritePayload(
        note,
        selectedEvaluation ? [selectedEvaluation] : [],
        { teacherSession },
      );
      if (actorScope.teacherId) payload.teacherId = actorScope.teacherId;
      try {
        await pedagogyApi.upsertNote(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur de synchronisation";
        const code = err instanceof ApiError ? err.code : undefined;
        const studentLabel = String(grade.studentName ?? grade.studentId ?? "Élève").trim() || "Élève";
        throw new Error(code ? `${studentLabel} : ${message} (${code})` : `${studentLabel} : ${message}`);
      }
    }
    await refresh(["notes"]);
    showToast("Notes enregistrées");
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
    });
    setCorrectionGrade(null);
    setCorrectionValue("");
    setCorrectionReason("");
    showToast("Correction enregistrée");
  }

  function exportGrades() {
    const columns = [
      { key: "eleve", header: "Élève" },
      { key: "cours", header: "Cours" },
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
        cours: grade.subject,
        periode: grade.period,
        note: grade.value ?? "",
        bareme: grade.scale,
        statut: grade.gradeStatus,
        evaluation: grade.evaluationId,
      }));
    const csv = rowsToCsv(rows, columns);
    downloadCsv(`notes-${code}-${period}`, csv);
    showToast("Export CSV généré");
  }

  const evaluationColumns: Column<Evaluation>[] = [
    { key: "title", header: "Titre", render: (row) => row.title },
    { key: "className", header: "Classe", render: (row) => row.className },
    { key: "subject", header: "Cours", render: (row) => row.subject },
    { key: "type", header: "Type", render: (row) => row.evaluationType },
    { key: "period", header: "Période", render: (row) => row.period },
    {
      key: "date",
      header: "Date",
      render: (row) => row.date || "—",
    },
    {
      key: "teacher",
      header: "Enseignant",
      render: (row) => row.teacherName || "—",
    },
    { key: "scale", header: "Barème", render: (row) => `/${row.scale}` },
    { key: "coef", header: "Coef.", render: (row) => row.coefficient },
    {
      key: "progress",
      header: PEDAGOGY_COPY.progress,
      render: (row) => {
        const roster = students.filter((student) => studentMatchesEvaluationClass(student, row));
        const entered = gradesForEvaluation(grades, row.id).length;
        const progression = evaluationEntryProgressLabel(entered, roster.length);
        return progression;
      },
    },
    {
      key: "status",
      header: "Statut",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "sync",
      header: "Sync",
      render: (row) => {
        const syncRow = row as Evaluation & { syncStatus?: string; syncError?: string };
        if (syncRow.syncStatus === "failed") {
          return (
            <span className="text-xs text-danger" title={syncRow.syncError ?? "Échec de synchronisation"}>
              Échec{syncRow.syncError ? ` — ${syncRow.syncError}` : ""}
            </span>
          );
        }
        if (syncRow.syncStatus === "pending" || syncRow.syncStatus === "syncing") {
          return <span className="text-xs text-amber-700">En attente</span>;
        }
        return <span className="text-xs text-muted">OK</span>;
      },
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {canMutateEvaluations && canEditEvaluation(row, state) ? (
            <Button
              variant="secondary"
              className="text-xs"
              onClick={() => {
                setEditingEvaluation(row);
                setFormOpen(true);
              }}
            >
              {PEDAGOGY_COPY.editEvaluation}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            className="text-xs"
            onClick={() => {
              requestContextChange(() => {
                setSelectedEvaluationId(row.id);
                if (row.className) setSelectedClass(row.className);
                if (row.period) setPeriod(row.period);
                setTab("saisie");
              });
            }}
          >
            {evaluationStatusAllowsGradeWrite(row.status, row.active !== false)
              ? PEDAGOGY_COPY.enterGrades // Saisir les notes
              : PEDAGOGY_COPY.consult}
          </Button>
          {canMutateEvaluations &&
          canValidateGrades(scopeUser) &&
          row.status !== "Validée" &&
          row.status !== "Publiée" ? (
            <Button variant="secondary" className="text-xs" onClick={() => void handleValidateEvaluation(row)}>
              Valider
            </Button>
          ) : null}
          {canPublishGrades(scopeUser) && !parentMode && row.status === "Validée" ? (
            <Button variant="secondary" className="text-xs" onClick={() => void handlePublishEvaluation(row)}>
              Publier
            </Button>
          ) : null}
          {canMutateEvaluations ? (
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
      <ForbiddenState
        title="Accès aux notes non autorisé"
        message="Votre rôle ne permet pas d'ouvrir l'outil Notes & évaluations."
      />
    );
  }

  if (loading) {
    return <LoadingState message="Chargement des notes et évaluations…" />;
  }

  return (
    <>
      <ToolLayout>
        <ToolLayout.Header>
          <SectionHeader
            title={PEDAGOGY_COPY.moduleTitle}
            description={
              parentMode
                ? "Notes, évaluations et moyennes de vos enfants."
                : "Création d'évaluations, saisie des notes, moyennes et validation (contrat D3.6b)."
            }
            actions={
              parentMode ? undefined : (
              <div className="flex flex-wrap gap-2">
                <PrintButton />
                <Button variant="secondary" onClick={exportGrades}>
                  Exporter CSV
                </Button>
                {canCreateEvaluations ? (
                  <Button
                    onClick={() => {
                      setEditingEvaluation(null);
                      setFormOpen(true);
                    }}
                  >
                    {PEDAGOGY_COPY.newEvaluation /* Nouvelle évaluation */}
                  </Button>
                ) : null}
              </div>
              )
            }
          />
        </ToolLayout.Header>

        <ToolLayout.Context>
          {syncError ? (
            <InlineAlert
              tone="danger"
              title="Synchronisation Notes en échec"
              className="mb-3"
              action={
                <Button variant="secondary" className="text-xs" onClick={() => void retryFailedSync()}>
                  Réessayer
                </Button>
              }
            >
              {syncError}
            </InlineAlert>
          ) : null}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Vues Notes">
            {visibleTabs.map((item) => (
              <Button
                key={item.key}
                variant={tab === item.key ? "primary" : "secondary"}
                onClick={() => {
                  if (item.key === tab) return;
                  requestContextChange(() => setTab(item.key));
                }}
                aria-selected={tab === item.key}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className={`mt-3 grid gap-3 ${parentMode ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>
            {parentMode ? (
              <>
                <Field label="Enfant">
                  <Select
                    aria-label="Enfant"
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    options={[
                      ...(parentChildren.length > 1 ? [{ value: "", label: "Choisir…" }] : []),
                      ...parentChildren.map((student) => ({
                        value: String(student.id ?? ""),
                        label: parentStudentLabel(student),
                      })),
                    ]}
                  />
                </Field>
                <Field label="Classe">
                  <p className="input-base flex items-center text-sm text-ink" aria-live="polite">
                    {formatParentClassLabel(selectedChild, String(scopeUser?.schoolPublicCode ?? ""))}
                  </p>
                </Field>
              </>
            ) : null}
            <Field label="Période">
              <Select
                aria-label="Période"
                value={period}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === period) return;
                  requestContextChange(() => setPeriod(next));
                }}
                options={periodOptions}
              />
            </Field>
            {parentMode ? (
              <Field label="Cours">
                <Select
                  aria-label="Cours"
                  value={selectedCourse}
                  onChange={(e) => setSelectedCourse(e.target.value)}
                  options={courseOptions}
                />
              </Field>
            ) : null}
            {!parentMode && queueDefaults.showStatusFilter ? (
              <Field label="Statut">
                <Select
                  aria-label="Statut"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  options={[...EVALUATION_STATUS_FILTER_OPTIONS]}
                />
              </Field>
            ) : null}
            {!parentMode && tab !== "eleve" ? (
              <Field label="Classe">
                <Select
                  value={selectedClass}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === selectedClass) return;
                    requestContextChange(() => setSelectedClass(next));
                  }}
                  options={classNames.map((name) => ({ value: name, label: name }))}
                />
              </Field>
            ) : null}
            {!parentMode && tab === "eleve" ? (
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
            ) : null}
          </div>
        </ToolLayout.Context>

        <ToolLayout.Content>
          {tab === "evaluations" ? (
            filteredEvaluations.length === 0 ? (
              <EmptyState
                title="Aucune évaluation"
                description={
                  parentMode
                    ? "Aucune évaluation publiée pour cet enfant."
                    : evaluationsEmptyDescription(period, statusFilter)
                }
                action={
                  canCreateEvaluations ? (
                    <Button
                      onClick={() => {
                        setEditingEvaluation(null);
                        setFormOpen(true);
                      }}
                    >
                      {PEDAGOGY_COPY.newEvaluation /* Nouvelle évaluation */}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <Card className="p-6">
                <Table
                  columns={evaluationColumns}
                  rows={filteredEvaluations}
                  rowKey={(row) => row.id}
                />
              </Card>
            )
          ) : null}

          {tab === "notes" ? (
            selectedChild ? (
              <ParentChildGradesPanel
                student={selectedChild}
                grades={parentGrades}
                evaluations={evaluations}
                period={period}
                courseFilter={selectedCourse}
                highlightGradeId={deepLinkGradeId}
              />
            ) : (
              <EmptyState
                title="Aucun enfant sélectionné"
                description="Choisissez un enfant pour consulter ses notes."
              />
            )
          ) : null}

          {tab === "matiere" ? (
            selectedChild ? (
              <ParentChildGradesPanel
                student={selectedChild}
                grades={parentGrades}
                evaluations={evaluations}
                period={period}
                courseFilter={selectedCourse}
                highlightGradeId={deepLinkGradeId}
              />
            ) : (
              <EmptyState
                title="Aucun enfant sélectionné"
                description="Choisissez un enfant pour consulter les moyennes par matière."
              />
            )
          ) : null}

          {!parentMode && tab === "saisie" ? (
            <Card className="p-6">
              <Field label="Évaluation">
                <Select
                  aria-label="Évaluation"
                  value={selectedEvaluationId}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === selectedEvaluationId) return;
                    requestContextChange(() => setSelectedEvaluationId(next));
                  }}
                  options={[
                    { value: "", label: "Choisir une évaluation…" },
                    ...gradeEntryEvaluations.map((evaluation) => ({
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
                    canEdit={canEnterGrades && canEnterGradesForEvaluation(scopeUser, selectedEvaluation, state)}
                    user={scopeUser}
                    onSave={handleSaveGrades}
                    onError={(message) => showToast(message, "error")}
                    onDirtyChange={handleGradeEntryDirtyChange}
                  />
                  {canCorrectValidatedGrades(scopeUser) && !parentMode ? (
                    <div className="mt-4">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          const validated = allGrades(state).find(
                            (grade) =>
                              grade.evaluationId === selectedEvaluation.id &&
                              (grade.gradeStatus === "Validée" || grade.gradeStatus === "Corrigée"),
                          );
                          if (!validated) {
                            showToast(
                              "Aucune note validée à corriger pour cette évaluation.",
                              "error",
                            );
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
              ) : (
                <div className="mt-4">
                  <EmptyState
                    title="Aucune évaluation sélectionnée"
                    description="Choisissez une évaluation pour saisir les notes."
                  />
                </div>
              )}
            </Card>
          ) : null}

          {!parentMode && tab === "classe" ? (
            <ClassGradesOverview
              className={selectedClass}
              period={period}
              state={state}
              user={scopeUser}
            />
          ) : null}

          {!parentMode && tab === "eleve" ? (
            selectedStudentId ? (
              <StudentGradesPanel
                student={students.find((row) => String(row.id) === selectedStudentId) ?? null}
                state={state}
                user={scopeUser}
                period={period}
                highlightGradeId={deepLinkGradeId}
              />
            ) : (
              <EmptyState
                title="Aucun élève sélectionné"
                description="Choisissez un élève dans le contexte pour consulter ses notes."
              />
            )
          ) : null}

          {!parentMode && tab === "stats" ? (
            <ClassGradesOverview
              className={selectedClass}
              period={period}
              state={state}
              user={scopeUser}
              difficultyThreshold={10}
            />
          ) : null}
        </ToolLayout.Content>
      </ToolLayout>

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
          <Field label="Nouvelle note" required>
            <Input
              type="number"
              value={correctionValue}
              onChange={(e) => setCorrectionValue(e.target.value)}
            />
          </Field>
          <Field label="Motif" required>
            <Input value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
