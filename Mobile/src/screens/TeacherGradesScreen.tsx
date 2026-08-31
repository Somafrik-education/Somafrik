import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import FormField from "../components/FormField";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { hasSecurityPermission } from "../domain/security/permissions";
import { isTeacherSession, resolveTeacherAssignmentsForSession } from "../lib/establishment";
import { sessionRoleToPlatformRole } from "../lib/orgHierarchy";
import {
  createEvaluation,
  getStudents,
  saveNote,
  updateEvaluation,
  getEvaluationTypes,
  type CanonicalEvaluationType,
} from "../services/api";
import { ApiClientError } from "../services/httpClient";
import QueryStateView from "../components/QueryStateView";
import { DATA_TRUTH_TEST_IDS } from "../lib/dataTruth";
import {
  buildCreateEvaluationPayload,
  buildSaveNotePayload,
  buildValidateEvaluationPatch,
  canonicalPeriodsFromConfig,
  evaluationAllowsGradeEntry,
  EVALUATIONS_V2_COPY,
  EVALUATIONS_V2_TEST_IDS,
  gradeSaveActorScope,
  gradesForEvaluation,
  isDraftOrOpenEvaluationStatus,
  rosterStudentsForEvaluation,
  selectablePeriods,
  studentApiId,
  teacherCreatePayloadContainsForbiddenFields,
  validateGradeValue,
  type CanonicalEvaluation,
  type CanonicalGrade,
  type CanonicalPeriod,
  type CanonicalRosterStudent,
} from "../lib/evaluationsV2";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { createInFlightLock, createIntentionStore } from "../lib/mutationGuard";
import { NETWORK_COPY, executeMutation } from "../lib/networkResilience";
import { submitProtectedMutation } from "../lib/outbox";
import KeyboardAwareScreen, { KeyboardAvoidingContainer } from "../components/KeyboardAwareScreen";
import { MIN_TOUCH_TARGET_DP, USABILITY_TEST_IDS } from "../lib/mobileUsability";

type GradeDraft = {
  value: string;
  status: "graded" | "absent" | "not_submitted";
};

type ViewMode = "list" | "create" | "grades";

export default function TeacherGradesScreen() {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { isTablet, horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const contentStyle = [
    styles.content,
    {
      paddingBottom: scrollContentPaddingBottom,
      paddingHorizontal: horizontalPadding,
      maxWidth: contentMaxWidth,
      alignSelf: "center" as const,
      width: "100%" as const,
    },
  ];
  const { session } = useAuth();
  const {
    assignmentsData,
    teachersData,
    academicConfigData,
    evaluationsSnapshot,
    notesSnapshot,
    loadEvaluations,
    loadEvaluation,
    loadEvaluationGrades,
    loadAssignments,
    loadTeachers,
    assignmentsSnapshot,
  } = useAdminData();

  const teacher = isTeacherSession(session as { role?: string; user?: { role?: string } } | null);
  const platformRole = sessionRoleToPlatformRole(session?.role);
  const canCreate = hasSecurityPermission(session, "Notes", "CREATE");
  const canUpdate = hasSecurityPermission(session, "Notes", "UPDATE");
  const canValidate = canUpdate && !teacher;

  const [mode, setMode] = useState<ViewMode>("list");
  const [evaluationTypes, setEvaluationTypes] = useState<CanonicalEvaluationType[]>([]);
  const [typesError, setTypesError] = useState("");
  const [selected, setSelected] = useState<CanonicalEvaluation | null>(null);
  const [roster, setRoster] = useState<CanonicalRosterStudent[]>([]);
  const [rosterStatus, setRosterStatus] = useState<"idle" | "loading" | "success" | "empty" | "error" | "offline">("idle");
  const [rosterError, setRosterError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, GradeDraft>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [validating, setValidating] = useState(false);

  const [createClassId, setCreateClassId] = useState("");
  const [createSubjectKey, setCreateSubjectKey] = useState("");
  const [createPeriodId, setCreatePeriodId] = useState("");
  const [createTypeId, setCreateTypeId] = useState("");
  const [createDate, setCreateDate] = useState(formatIsoDate(new Date()));
  const [createScale, setCreateScale] = useState("20");
  const [createTitle, setCreateTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const createLockRef = useRef(createInFlightLock());
  const saveLockRef = useRef(createInFlightLock());
  const createIntentionRef = useRef(createIntentionStore());
  const noteIntentionRef = useRef(createIntentionStore());

  const periods = useMemo(
    () => selectablePeriods(canonicalPeriodsFromConfig(academicConfigData.periods ?? [])),
    [academicConfigData.periods],
  );

  const scopedAssignments = useMemo(
    () =>
      resolveTeacherAssignmentsForSession(session, {
        assignments: assignmentsData,
        teachers: teachersData,
        assignmentsSource: assignmentsSnapshot.source,
      }).filter((row) => Boolean(row.classId)),
    [assignmentsData, assignmentsSnapshot.source, session, teachersData],
  );

  const selectedAssignment = scopedAssignments.find(
    (row) => `${row.classId}|${row.subjectCode ?? row.course}` === `${createClassId}|${createSubjectKey}`,
  );

  const selectedPeriod = periods.find((period) => (period.id || period.name) === createPeriodId) ?? periods.find((period) => period.active);

  useFocusEffect(
    useCallback(() => {
      void loadEvaluations();
      void loadAssignments();
      void loadTeachers();
    }, [loadEvaluations, loadAssignments, loadTeachers]),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await getEvaluationTypes();
        if (cancelled) return;
        const active = (payload.types ?? []).filter((row) => row.status === "active");
        setEvaluationTypes(active);
        setTypesError("");
        if (!createTypeId && active[0]) setCreateTypeId(active[0].id);
      } catch (error) {
        if (cancelled) return;
        setEvaluationTypes([]);
        setTypesError(apiErrorMessage(error, "Impossible de charger les types d'évaluation."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!createClassId && scopedAssignments[0]?.classId) {
      setCreateClassId(String(scopedAssignments[0].classId));
      setCreateSubjectKey(String(scopedAssignments[0].subjectCode ?? scopedAssignments[0].course));
    }
  }, [createClassId, scopedAssignments]);

  useEffect(() => {
    if (!createPeriodId && periods[0]) {
      setCreatePeriodId(String(periods[0].id || periods[0].name));
    }
  }, [createPeriodId, periods]);

  useEffect(() => {
    const scale = Number(academicConfigData.defaultScale);
    if (scale > 0) setCreateScale(String(scale));
  }, [academicConfigData.defaultScale]);

  const openGrades = async (evaluation: CanonicalEvaluation) => {
    setSelected(evaluation);
    setMode("grades");
    setSaveError("");
    setRosterStatus("loading");
    try {
      const [fresh, students] = await Promise.all([
        loadEvaluation(evaluation.evaluationId),
        getStudents(),
      ]);
      const current = fresh ?? evaluation;
      setSelected(current);
      const scopedRoster = rosterStudentsForEvaluation(students, current);
      setRoster(scopedRoster);
      setRosterStatus(scopedRoster.length ? "success" : "empty");
      const grades = await loadEvaluationGrades(current.evaluationId);
      setDrafts(draftsFromGrades(scopedRoster, grades));
    } catch (error) {
      const classified = error && typeof error === "object" && "status" in error && Number((error as { status?: number }).status) === 0
        ? "offline"
        : "error";
      setRosterStatus(classified);
      setRosterError(apiErrorMessage(error, EVALUATIONS_V2_COPY.errorRoster));
    }
  };

  const handleCreate = async () => {
    if (!canCreate) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de créer une évaluation.");
      return;
    }
    if (!selectedAssignment?.classId) {
      Alert.alert("Cours requis", "Choisissez une classe et un cours autorisés.");
      return;
    }
    if (!selectedPeriod?.name) {
      Alert.alert("Période requise", "Aucune période canonique n'est disponible.");
      return;
    }
    if (!createTypeId) {
      Alert.alert("Type requis", typesError || "Aucun type d'évaluation actif.");
      return;
    }
    const scale = Number(String(createScale).replace(",", "."));
    try {
      const payload = buildCreateEvaluationPayload({
        classId: String(selectedAssignment.classId),
        subjectCode: selectedAssignment.subjectCode,
        subject: selectedAssignment.subject || selectedAssignment.course,
        period: selectedPeriod.name,
        termId: selectedPeriod.id,
        evaluationTypeId: createTypeId,
        date: createDate,
        scale,
        title: createTitle || evaluationTypes.find((row) => row.id === createTypeId)?.name,
      });
      if (teacherCreatePayloadContainsForbiddenFields(payload)) {
        Alert.alert("Requête invalide", "teacherId et statut Validée sont interdits à la création.");
        return;
      }
      if (!createLockRef.current.tryBegin()) return;
      const intentionId = `evaluation:${createClassId}:${createSubjectKey}:${createDate}:${createTypeId}`;
      const idempotencyKey = createIntentionRef.current.getOrCreate(intentionId);
      setCreating(true);
      try {
        await executeMutation({
          request: () => createEvaluation(payload, { idempotencyKey }),
        });
        createIntentionRef.current.rotate(intentionId);
        setMode("list");
        await loadEvaluations();
      } finally {
        setCreating(false);
        createLockRef.current.end();
      }
    } catch (error) {
      Alert.alert("Création refusée", apiErrorMessage(error, "Impossible de créer l'évaluation."));
    }
  };

  const handleValidate = async (evaluation: CanonicalEvaluation) => {
    if (!canValidate) {
      Alert.alert("Accès refusé", EVALUATIONS_V2_COPY.teacherCannotValidate);
      return;
    }
    setValidating(true);
    try {
      const saved = await updateEvaluation(evaluation.evaluationId, buildValidateEvaluationPatch());
      setSelected(saved);
      await loadEvaluations();
      Alert.alert("Évaluation validée", `Statut serveur : ${saved.status}`);
    } catch (error) {
      Alert.alert("Validation refusée", apiErrorMessage(error, "Impossible de valider l'évaluation."));
    } finally {
      setValidating(false);
    }
  };

  const handleSaveGrades = async () => {
    if (!selected) return;
    if (!evaluationAllowsGradeEntry(selected)) {
      Alert.alert("Saisie refusée", EVALUATIONS_V2_COPY.notValidated);
      return;
    }
    let actorScope: { teacherId?: string };
    try {
      actorScope = gradeSaveActorScope(teacher, selected);
    } catch (error) {
      Alert.alert(
        "Enseignant requis",
        error instanceof Error ? error.message : EVALUATIONS_V2_COPY.missingEvaluationTeacher,
      );
      return;
    }
    const scale = Number(selected.scale);
    const entries: Array<{ student: CanonicalRosterStudent; payload: Record<string, unknown> }> = [];
    for (const student of roster) {
      const draft = drafts[studentApiId(student)] ?? { value: "", status: "not_submitted" as const };
      if (draft.status === "not_submitted" && !draft.value.trim()) continue;
      if (draft.status === "absent") {
        entries.push({
          student,
          payload: buildSaveNotePayload({
            evaluationId: selected.evaluationId,
            studentId: studentApiId(student),
            scale,
            gradeStatus: "absent",
            className: selected.className,
            subject: selected.subject || selected.courseName,
            period: selected.periodName,
            ...actorScope,
          }),
        });
        continue;
      }
      const parsed = validateGradeValue(draft.value, scale);
      if (!parsed.ok) {
        Alert.alert("Note invalide", `${student.name} : ${parsed.message}`);
        return;
      }
      entries.push({
        student,
        payload: buildSaveNotePayload({
            evaluationId: selected.evaluationId,
            studentId: studentApiId(student),
            scale,
            value: parsed.value,
            gradeStatus: "graded",
            className: selected.className,
            subject: selected.subject || selected.courseName,
            period: selected.periodName,
            ...actorScope,
          }),
      });
    }
    if (!entries.length) {
      Alert.alert("Aucune note", "Saisissez au moins une note ou marquez un élève absent.");
      return;
    }
    if (!saveLockRef.current.tryBegin()) return;
    setSaving(true);
    setSaveError("");
    try {
      let queued = 0;
      for (const entry of entries) {
        const intentionId = `note:${selected.evaluationId}:${studentApiId(entry.student)}`;
        const idempotencyKey = noteIntentionRef.current.getOrCreate(intentionId);
        const submitted = await submitProtectedMutation({
          domain: "notes",
          method: "POST",
          path: "/notes",
          payload: entry.payload,
          idempotencyKey,
          userId: String(session?.user.id ?? ""),
          schoolScope: String(session?.school?.code ?? session?.user.schoolCode ?? ""),
          persistOutbox: true,
          request: () => saveNote(entry.payload, { idempotencyKey }),
        });
        if (submitted.outcome === "confirmed") {
          noteIntentionRef.current.rotate(intentionId);
          continue;
        }
        if (submitted.outcome === "queued" || submitted.outcome === "in_flight") {
          queued += 1;
          continue;
        }
        setSaveError(apiErrorMessage(submitted.error, "Les notes n'ont pas été enregistrées."));
        return;
      }
      if (queued) {
        setSaveError(NETWORK_COPY.queued);
        return;
      }
      const grades = await loadEvaluationGrades(selected.evaluationId);
      setDrafts(draftsFromGrades(roster, grades));
      Alert.alert("Notes enregistrées", `${entries.length} note(s) enregistrée(s).`);
    } catch (error) {
      setSaveError(apiErrorMessage(error, "Les notes n'ont pas été enregistrées."));
    } finally {
      setSaving(false);
      saveLockRef.current.end();
    }
  };

  if (mode === "create") {
    return (
      <KeyboardAwareScreen style={styles.container} contentContainerStyle={contentStyle} testID={EVALUATIONS_V2_TEST_IDS.createForm}>
        <BackButton onPress={() => setMode("list")} />
        <Text style={styles.title}>Nouvelle évaluation</Text>
        <Text style={styles.subtitle}>
          Classe, cours, période et type viennent des référentiels canoniques. Le statut initial est décidé par le serveur.
        </Text>
        <Text style={styles.label}>Classe / cours autorisés</Text>
        <View style={styles.typeRow}>
          {scopedAssignments.map((assignment) => {
            const key = `${assignment.classId}|${assignment.subjectCode ?? assignment.course}`;
            const active = key === `${createClassId}|${createSubjectKey}`;
            return (
              <TouchableOpacity
                key={assignment.id ?? key}
                style={[styles.typePill, active && styles.typePillActive]}
                onPress={() => {
                  setCreateClassId(String(assignment.classId));
                  setCreateSubjectKey(String(assignment.subjectCode ?? assignment.course));
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${assignment.className} ${assignment.course}`}
              >
                <Text style={[styles.typeText, active && styles.typeTextActive]}>
                  {assignment.className} • {assignment.course}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {!scopedAssignments.length ? (
          <Text style={styles.empty}>Aucun cours autorisé pour votre session.</Text>
        ) : null}

        <Text style={styles.label}>Période</Text>
        <PeriodPills periods={periods} selectedId={createPeriodId} onSelect={setCreatePeriodId} />
        {!periods.length ? <Text style={styles.empty}>Aucune période canonique chargée.</Text> : null}

        <Text style={styles.label}>Type d'évaluation</Text>
        <View style={styles.typeRow}>
          {evaluationTypes.map((type) => (
            <TouchableOpacity
              key={type.id}
              style={[styles.typePill, createTypeId === type.id && styles.typePillActive]}
              onPress={() => setCreateTypeId(type.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: createTypeId === type.id }}
              accessibilityLabel={type.name}
            >
              <Text style={[styles.typeText, createTypeId === type.id && styles.typeTextActive]}>{type.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {typesError ? <Text style={styles.errorText}>{typesError}</Text> : null}

        <FormField
          label="Date"
          required
          type="date"
          value={createDate}
          onChangeText={setCreateDate}
          placeholder="Ex. 2026-08-22"
          accessibilityLabel="Date de l'évaluation"
        />
        <FormField
          label="Barème"
          required
          type="amount"
          value={createScale}
          onChangeText={setCreateScale}
          placeholder="Ex. 20"
          accessibilityLabel="Barème"
        />
        <FormField
          label="Titre"
          optional
          value={createTitle}
          onChangeText={setCreateTitle}
          placeholder="Ex. Devoir"
          accessibilityLabel="Titre de l'évaluation"
        />

        <TouchableOpacity
          style={[styles.primaryButton, creating && styles.disabledButton]}
          onPress={() => void handleCreate()}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryText}>{EVALUATIONS_V2_COPY.create}</Text>
          )}
        </TouchableOpacity>
      </KeyboardAwareScreen>
    );
  }

  if (mode === "grades" && selected) {
    const canEnter = evaluationAllowsGradeEntry(selected) && (canCreate || canUpdate);
    const rosterReady = rosterStatus === "success";
    return (
      <KeyboardAvoidingContainer style={styles.container} testID={EVALUATIONS_V2_TEST_IDS.gradesForm}>
        <FlatList
          data={rosterReady ? roster : []}
          keyExtractor={(student) => studentApiId(student)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={contentStyle}
          ListHeaderComponent={
            <>
              <BackButton onPress={() => setMode("list")} />
              <Text style={styles.title}>{selected.title}</Text>
              <Text style={styles.subtitle}>
                {selected.className} • {selected.courseName} • {selected.periodName} • {selected.status} • /{selected.scale}
              </Text>
              {!canEnter ? <Text style={styles.warning}>{EVALUATIONS_V2_COPY.notValidated}</Text> : null}
              {rosterStatus === "loading" || rosterStatus === "idle" ? (
                <QueryStateView
                  snapshot={{ status: "loading", data: [] }}
                  emptyMessage={EVALUATIONS_V2_COPY.emptyRoster}
                  errorMessage={EVALUATIONS_V2_COPY.errorRoster}
                  offlineMessage={EVALUATIONS_V2_COPY.offlineRoster}
                  emptyTestId="evaluations-v2-roster-empty"
                  errorTestId="evaluations-v2-roster-error"
                  onRetry={() => void openGrades(selected)}
                />
              ) : rosterStatus === "error" || rosterStatus === "offline" ? (
                <QueryStateView
                  snapshot={{ status: rosterStatus, data: [], errorMessage: rosterError }}
                  emptyMessage={EVALUATIONS_V2_COPY.emptyRoster}
                  errorMessage={EVALUATIONS_V2_COPY.errorRoster}
                  offlineMessage={EVALUATIONS_V2_COPY.offlineRoster}
                  emptyTestId="evaluations-v2-roster-empty"
                  errorTestId="evaluations-v2-roster-error"
                  onRetry={() => void openGrades(selected)}
                />
              ) : rosterStatus === "empty" ? (
                <QueryStateView
                  snapshot={{ status: "empty", data: [] }}
                  emptyMessage={EVALUATIONS_V2_COPY.emptyRoster}
                  errorMessage={EVALUATIONS_V2_COPY.errorRoster}
                  offlineMessage={EVALUATIONS_V2_COPY.offlineRoster}
                  emptyTestId="evaluations-v2-roster-empty"
                  errorTestId="evaluations-v2-roster-error"
                  onRetry={() => void openGrades(selected)}
                />
              ) : null}
            </>
          }
          renderItem={({ item: student }) => {
            const key = studentApiId(student);
            const draft = drafts[key] ?? { value: "", status: "not_submitted" as const };
            return (
              <View key={key} style={styles.gradeRow}>
                <View style={styles.studentInfo}>
                  <Text style={styles.name}>{student.name}</Text>
                  <Text style={styles.meta}>{student.matricule} • /{selected.scale}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.absentChip, draft.status === "absent" && styles.absentChipActive]}
                  onPress={() =>
                    setDrafts((current) => ({
                      ...current,
                      [key]: {
                        value: "",
                        status: draft.status === "absent" ? "not_submitted" : "absent",
                      },
                    }))
                  }
                  disabled={!canEnter || saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Marquer ${student.name} absent`}
                  accessibilityState={{ selected: draft.status === "absent", disabled: !canEnter || saving }}
                >
                  <Text style={[styles.absentText, draft.status === "absent" && styles.absentTextActive]}>Abs</Text>
                </TouchableOpacity>
                <FormField
                  label={`Note de ${student.name}`}
                  hideVisibleLabel
                  variant="compact"
                  type="amount"
                  keyboardType="decimal-pad"
                  value={draft.status === "absent" ? "" : draft.value}
                  onChangeText={(value) =>
                    setDrafts((current) => ({
                      ...current,
                      [key]: { value, status: value.trim() ? "graded" : "not_submitted" },
                    }))
                  }
                  placeholder={`/${selected.scale}`}
                  editable={canEnter && !saving && draft.status !== "absent"}
                  containerStyle={styles.gradeField}
                  inputStyle={styles.gradeInput}
                  testID={USABILITY_TEST_IDS.notesGradeInput(key)}
                  accessibilityLabel={`Note de ${student.name} sur ${selected.scale}`}
                />
              </View>
            );
          }}
          ListFooterComponent={
            <>
              {saveError ? (
                <Text style={styles.errorText} testID={EVALUATIONS_V2_TEST_IDS.saveError}>
                  {saveError}
                </Text>
              ) : null}
              <TouchableOpacity
                style={[styles.primaryButton, (saving || !canEnter) && styles.disabledButton]}
                onPress={() => void handleSaveGrades()}
                disabled={saving || !canEnter}
                testID={EVALUATIONS_V2_TEST_IDS.saveButton}
                accessibilityRole="button"
                accessibilityLabel={EVALUATIONS_V2_COPY.saveGrades}
                accessibilityState={{ disabled: saving || !canEnter, busy: saving }}
              >
                {saving ? (
                  <>
                    <ActivityIndicator color="#FFFFFF" />
                    <Text style={styles.primaryText}>{EVALUATIONS_V2_COPY.saving}</Text>
                  </>
                ) : (
                  <Text style={styles.primaryText}>{saveError ? EVALUATIONS_V2_COPY.retry : EVALUATIONS_V2_COPY.saveGrades}</Text>
                )}
              </TouchableOpacity>
            </>
          }
        />
      </KeyboardAvoidingContainer>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={contentStyle}>
      <Text style={styles.title}>Évaluations</Text>
      <Text style={styles.subtitle}>
        {teacher
          ? "Vos évaluations autorisées. La saisie des notes n'est possible qu'après validation."
          : `Workflow réel : ${platformRole}. Validation serveur, jamais locale.`}
      </Text>

      {canCreate ? (
        <TouchableOpacity style={styles.primaryButton} onPress={() => setMode("create")}>
          <Text style={styles.primaryText}>Créer une évaluation</Text>
        </TouchableOpacity>
      ) : null}

      {evaluationsSnapshot.status !== "success" ? (
        <QueryStateView
          snapshot={evaluationsSnapshot}
          emptyMessage={EVALUATIONS_V2_COPY.emptyEvaluations}
          errorMessage={EVALUATIONS_V2_COPY.errorEvaluations}
          offlineMessage={EVALUATIONS_V2_COPY.offlineEvaluations}
          emptyTestId={DATA_TRUTH_TEST_IDS.evaluationsEmpty}
          errorTestId={DATA_TRUTH_TEST_IDS.evaluationsError}
          onRetry={() => void loadEvaluations()}
        />
      ) : (
        <View testID={DATA_TRUTH_TEST_IDS.evaluationsList}>
          {evaluationsSnapshot.data.map((evaluation) => {
            const gradeCount = gradesForEvaluation(notesSnapshot.data, evaluation.evaluationId).length;
            return (
              <View key={evaluation.evaluationId} style={[styles.historyCard, isTablet && styles.assignmentCardTablet]}>
                <Text style={styles.historyTitle}>{evaluation.title}</Text>
                <Text style={styles.meta}>
                  {evaluation.className} • {evaluation.courseName} • {evaluation.periodName}
                </Text>
                <Text style={styles.statusBadge}>{evaluation.status}</Text>
                <Text style={styles.meta}>
                  {evaluation.date} • /{evaluation.scale} • {gradeCount} note(s)
                </Text>
                <View style={styles.actionsRow}>
                  {canValidate && isDraftOrOpenEvaluationStatus(evaluation.status) ? (
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => void handleValidate(evaluation)}
                      disabled={validating}
                      testID={EVALUATIONS_V2_TEST_IDS.validateButton}
                    >
                      <Text style={styles.secondaryText}>{EVALUATIONS_V2_COPY.validate}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={styles.primaryButton} onPress={() => void openGrades(evaluation)}>
                    <Text style={styles.primaryText}>
                      {evaluationAllowsGradeEntry(evaluation) ? EVALUATIONS_V2_COPY.enterGrades : "Consulter"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.backButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Retour aux évaluations"
    >
      <Ionicons name="arrow-back" size={18} color="#0F172A" />
      <Text style={styles.backText}>Retour</Text>
    </TouchableOpacity>
  );
}

function PeriodPills({
  periods,
  selectedId,
  onSelect,
}: {
  periods: CanonicalPeriod[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.typeRow}>
      {periods.map((period) => {
        const id = String(period.id || period.name);
        const active = id === selectedId;
        return (
          <TouchableOpacity
            key={id}
            style={[styles.typePill, active && styles.typePillActive]}
            onPress={() => onSelect(id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={period.name}
          >
            <Text style={[styles.typeText, active && styles.typeTextActive]}>
              {period.name}
              {period.active ? "" : " (inactive)"}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function draftsFromGrades(students: CanonicalRosterStudent[], grades: CanonicalGrade[]): Record<string, GradeDraft> {
  const byStudent = new Map(grades.map((grade) => [grade.studentId, grade]));
  const next: Record<string, GradeDraft> = {};
  for (const student of students) {
    const key = studentApiId(student);
    const grade =
      byStudent.get(key) ||
      byStudent.get(String(student.id)) ||
      byStudent.get(String(student.matricule ?? "")) ||
      byStudent.get(String(student.publicId ?? ""));
    if (!grade) {
      next[key] = { value: "", status: "not_submitted" };
      continue;
    }
    if (grade.gradeStatus === "absent") {
      next[key] = { value: "", status: "absent" };
      continue;
    }
    next[key] = {
      value: grade.value != null ? String(grade.value) : "",
      status: grade.value != null ? "graded" : "not_submitted",
    };
  }
  return next;
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) {
    if (error.status === 403) return error.message || "Accès refusé.";
    if (error.status === 404) return error.message || "Ressource introuvable.";
    if (error.status === 409) return error.message || "Conflit métier.";
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function formatIsoDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  title: { fontSize: 32, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 6, marginBottom: 20, color: "#64748B", fontWeight: "700" },
  assignmentCardTablet: { maxWidth: 640, alignSelf: "center", width: "100%" },
  meta: { marginTop: 4, color: "#64748B", fontWeight: "700" },
  primaryButton: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  disabledButton: { opacity: 0.6 },
  primaryText: { color: "#FFFFFF", fontWeight: "900" },
  secondaryButton: {
    backgroundColor: "#FEF3C7",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
    flex: 1,
  },
  secondaryText: { color: "#92400E", fontWeight: "900" },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
  },
  backText: { marginLeft: 8, color: "#0F172A", fontWeight: "900" },
  label: { color: "#0F172A", fontWeight: "900", marginBottom: 8 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  typePill: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: MIN_TOUCH_TARGET_DP,
    justifyContent: "center",
  },
  typePillActive: { backgroundColor: "#0F172A" },
  typeText: { color: "#334155", fontWeight: "900" },
  typeTextActive: { color: "#FFFFFF" },
  sessionInput: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 14,
  },
  gradeRow: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  studentInfo: { flex: 1, paddingRight: 12 },
  name: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  gradeField: {
    width: 86,
  },
  gradeInput: {
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  historyCard: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 14, marginBottom: 10 },
  historyTitle: { color: "#0F172A", fontSize: 17, fontWeight: "900" },
  empty: { color: "#64748B", fontWeight: "800", marginBottom: 12 },
  errorText: { color: "#991B1B", fontWeight: "800", marginBottom: 12 },
  warning: { color: "#92400E", fontWeight: "800", marginBottom: 12 },
  statusBadge: { marginTop: 8, color: "#1D4ED8", fontWeight: "900" },
  actionsRow: { gap: 8 },
  absentChip: {
    marginRight: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: MIN_TOUCH_TARGET_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
    alignItems: "center",
    justifyContent: "center",
  },
  absentChipActive: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  absentText: { color: "#334155", fontWeight: "900" },
  absentTextActive: { color: "#FFFFFF" },
});
