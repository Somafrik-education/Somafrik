import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import { scopedClasses, scopedTeachers } from "../lib/establishment";
import { normalize } from "../lib/format";
import { CoursePlanningCalendar } from "../components/planning/CoursePlanningCalendar";
import {
  ALL_PLANNING_PERIODS,
  auditSchoolPlanningConsistency,
  buildSchoolPlanningResetPatch,
  buildExamSlotTimes,
  buildSlotTemplateTimes,
  canRepairSchoolPlanning,
  createScheduleId,
  EXAM_TYPE_OPTIONS,
  extractTimeFromIso,
  filterSlotsByClass,
  filterSlotsByKind,
  filterSlotsByPeriod,
  formatScheduleRecurrenceSummary,
  getClassSubjectNames,
  getDefaultPlanningPeriod,
  getMasterScheduleId,
  getSchoolAcademicPeriods,
  isExamSchedule,
  isoToPeriodDate,
  mergePlanningLinkedExams,
  normalizePlanningSlotForSave,
  normalizeScheduleKind,
  pickPlanningPeriodWithSlots,
  PLANNING_WEEKDAYS,
  repairSchoolCourseSchedules,
  resolveCourseTeacher,
  scopedCourseSchedules,
  slotsToClassCalendarEvents,
  validatePlanningSlotBusinessRules,
  weekdayFromIso,
  type CourseScheduleSlot,
  type PlanningScheduleKind,
  type PlanningViewFilter,
} from "../lib/coursePlanning";
import { syncSchoolCourseSchedules } from "../lib/pedagogyPlanningSync";
import { inputToPeriodDate, parsePeriodDate, periodDateToInput } from "../lib/academicPeriods";
import type { BackOfficeState, SessionUser } from "../types";

function classNamesKeyFromState(data: BackOfficeState, user: SessionUser | null): string {
  return scopedClasses(user, data)
    .map((row) => String(row.name ?? "").trim())
    .filter(Boolean)
    .join("\u0000");
}

type FormState = {
  id: string;
  kind: PlanningScheduleKind;
  className: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  room: string;
  periodName: string;
  periodStart: string;
  periodEnd: string;
  examType: string;
  examName: string;
  examDate: string;
  examId: string;
};

const EMPTY_FORM = (
  className: string,
  period: Pick<CourseScheduleSlot, "periodName" | "periodStart" | "periodEnd">,
  kind: PlanningScheduleKind = "course",
): FormState => ({
  id: "",
  kind,
  className,
  subject: "",
  teacherId: "",
  teacherName: "",
  weekday: 1,
  startTime: "08:00",
  endTime: "09:00",
  room: "",
  periodName: period.periodName ?? "",
  periodStart: period.periodStart ?? "",
  periodEnd: period.periodEnd ?? "",
  examType: EXAM_TYPE_OPTIONS[0],
  examName: "",
  examDate: period.periodStart ?? "",
  examId: "",
});

function formFromSlot(
  slot: CourseScheduleSlot,
  fallbackPeriod: Pick<CourseScheduleSlot, "periodName" | "periodStart" | "periodEnd">,
): FormState {
  const kind = normalizeScheduleKind(slot.kind);
  return {
    id: slot.id,
    kind,
    className: slot.className,
    subject: slot.subject,
    teacherId: slot.teacherId ?? "",
    teacherName: slot.teacherName ?? "",
    weekday: weekdayFromIso(slot.start),
    startTime: extractTimeFromIso(slot.start),
    endTime: extractTimeFromIso(slot.end),
    room: slot.room ?? "",
    periodName: slot.periodName ?? fallbackPeriod.periodName ?? "",
    periodStart: slot.periodStart ?? fallbackPeriod.periodStart ?? "",
    periodEnd: slot.periodEnd ?? fallbackPeriod.periodEnd ?? "",
    examType: slot.examType ?? EXAM_TYPE_OPTIONS[0],
    examName: slot.examName ?? "",
    examDate: kind === "exam" ? isoToPeriodDate(slot.start) : fallbackPeriod.periodStart ?? "",
    examId: slot.examId ?? "",
  };
}

function slotTimesFromForm(form: FormState): { start: string; end: string } {
  return buildSlotTemplateTimes(form.weekday, form.startTime, form.endTime, form.periodStart);
}

export function CoursePlanningPage() {
  const { session } = useAuth();
  const { state, update, refresh } = useData();
  const stateRef = useRef(state);
  stateRef.current = state;
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { scopedUser, activeSchoolCode } = useActiveSchool();
  const scopeUser = scopedUser ?? session?.user ?? null;
  const schoolCode = activeSchoolCode || scopeUser?.schoolCode || "";
  const { canRead, canCreate, canUpdate, canDelete } = useFeaturePermissions("Planning de cours");

  const [selectedClassName, setSelectedClassName] = useState("");
  const selectedClassRef = useRef("");
  const [selectedPeriodName, setSelectedPeriodName] = useState("");
  const [viewKindFilter, setViewKindFilter] = useState<PlanningViewFilter>("all");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const schoolPeriods = useMemo(
    () => getSchoolAcademicPeriods(state, schoolCode),
    [state.academicConfigs, schoolCode],
  );

  const defaultPeriod = useMemo(
    () => getDefaultPlanningPeriod(state, schoolCode),
    [state.academicConfigs, schoolCode],
  );

  const schoolSlots = useMemo(
    () => scopedCourseSchedules(scopeUser, state),
    [scopeUser, state.courseSchedules],
  );

  useEffect(() => {
    if (!schoolPeriods.length) {
      setSelectedPeriodName(defaultPeriod.periodName ?? "");
      return;
    }
    setSelectedPeriodName((current) => {
      if (current === ALL_PLANNING_PERIODS) return current;
      if (current && schoolPeriods.some((row) => row.name === current)) return current;
      const preferred = pickPlanningPeriodWithSlots(schoolPeriods, schoolSlots, schoolCode);
      return preferred?.name ?? schoolPeriods.find((row) => row.active)?.name ?? schoolPeriods[0]?.name ?? "";
    });
  }, [schoolPeriods, defaultPeriod.periodName, schoolSlots, schoolCode]);

  const activePeriod = useMemo(() => {
    if (selectedPeriodName === ALL_PLANNING_PERIODS) return null;
    return schoolPeriods.find((row) => row.name === selectedPeriodName) ?? null;
  }, [schoolPeriods, selectedPeriodName]);

  const classes = useMemo(
    () =>
      classNamesKeyFromState(state, scopeUser)
        .split("\u0000")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "fr")),
    [scopeUser, classNamesKeyFromState(state, scopeUser)],
  );

  const classNamesKey = useMemo(() => classes.join("\u0000"), [classes]);

  useEffect(() => {
    if (!classes.length) return;
    setSelectedClassName((current) => {
      if (current && classes.includes(current)) {
        selectedClassRef.current = current;
        return current;
      }
      const fallback = selectedClassRef.current && classes.includes(selectedClassRef.current)
        ? selectedClassRef.current
        : classes[0];
      selectedClassRef.current = fallback;
      return fallback;
    });
  }, [classNamesKey, classes.length]);

  const teachers = useMemo(() => scopedTeachers(scopeUser, state), [scopeUser, state]);

  const subjectOptions = useMemo(
    () => getClassSubjectNames(scopeUser, state, selectedClassName, schoolCode),
    [scopeUser, state, selectedClassName, schoolCode],
  );

  const periodScopedSlots = useMemo(
    () => filterSlotsByPeriod(schoolSlots, activePeriod),
    [schoolSlots, activePeriod],
  );

  const kindScopedSlots = useMemo(
    () => filterSlotsByKind(periodScopedSlots, viewKindFilter),
    [periodScopedSlots, viewKindFilter],
  );

  const classSlots = useMemo(
    () => filterSlotsByClass(kindScopedSlots, selectedClassName),
    [kindScopedSlots, selectedClassName],
  );

  const classCourseCount = useMemo(
    () => classSlots.filter((slot) => !isExamSchedule(slot)).length,
    [classSlots],
  );

  const classExamCount = useMemo(
    () => classSlots.filter(isExamSchedule).length,
    [classSlots],
  );

  const events = useMemo(
    () => slotsToClassCalendarEvents(kindScopedSlots, selectedClassName),
    [kindScopedSlots, selectedClassName],
  );

  const consistencyIssues = useMemo(
    () => auditSchoolPlanningConsistency(schoolSlots, state, scopeUser, schoolCode),
    [schoolSlots, state, scopeUser, schoolCode],
  );

  const planningRepairAvailable = useMemo(
    () => Boolean(schoolCode && canRepairSchoolPlanning(state, scopeUser, schoolCode)),
    [state, scopeUser, schoolCode],
  );

  const autoRepairRef = useRef(false);

  async function handleRepairPlanningData() {
    if (!schoolCode || !canUpdate) return;
    const report = repairSchoolCourseSchedules(stateRef.current, scopeUser, schoolCode);
    const summary = [
      report.encodingFixes ? `${report.encodingFixes} libellé(s) corrigé(s)` : "",
      report.periodsAdded ? `${report.periodsAdded} période(s) ajoutée(s)` : "",
      report.duplicatesRemoved ? `${report.duplicatesRemoved} doublon(s) horaire(s) supprimé(s)` : "",
      report.subjectPeriodDuplicatesRemoved
        ? `${report.subjectPeriodDuplicatesRemoved} doublon(s) matière/période supprimé(s)`
        : "",
      report.conflictsResolved ? `${report.conflictsResolved} conflit(s) horaire(s) résolu(s)` : "",
      report.migratedFromPedagogy
        ? `${report.migratedFromPedagogy} matière(s) importée(s) au planning`
        : "",
      report.examsLinked ? `${report.examsLinked} examen(s) relié(s) au calendrier` : "",
      report.teachersSynced ? `${report.teachersSynced} enseignant(s) complété(s)` : "",
      report.invalidRemoved ? `${report.invalidRemoved} créneau(x) invalide(s) retiré(s)` : "",
    ]
      .filter(Boolean)
      .join(", ");
    await persistSlots(
      report.slots,
      summary ? `Planning corrigé : ${summary}.` : "Planning cohérent — aucune correction nécessaire.",
    );
  }

  useEffect(() => {
    autoRepairRef.current = false;
  }, [schoolCode]);

  async function handleResetPlanning() {
    if (!schoolCode || !canDelete) return;
    const confirmed = await confirm({
      title: "Réinitialiser le planning ?",
      description:
        "Tous les créneaux cours et examens seront supprimés. Les affectations legacy et les examens planifiés seront retirés. Les matières, classes et périodes académiques (Configuration) sont conservées.",
      confirmLabel: "Réinitialiser",
      tone: "danger",
    });
    if (!confirmed) return;

    const previousSchoolSlots = scopedCourseSchedules(scopeUser, stateRef.current).filter(
      (row) => normalize(row.schoolCode) === normalize(schoolCode),
    );
    const resetPatch = buildSchoolPlanningResetPatch(stateRef.current, schoolCode);
    setSaving(true);
    try {
      await syncSchoolCourseSchedules(previousSchoolSlots, []);
      await update({ exams: resetPatch.exams }, { partial: true });
      await refresh();
      setForm(null);
      autoRepairRef.current = true;
      showToast("Planning réinitialisé. Vous pouvez recréer vos créneaux.", "success");
    } catch {
      showToast("Échec de la réinitialisation du planning.", "error");
    } finally {
      setSaving(false);
    }
  }

  const editable = canCreate || canUpdate;

  function openCreate(kind: PlanningScheduleKind, start: string, end: string, subject = "") {
    if (!canCreate) {
      showToast("Vous n'avez pas le droit de créer un créneau.", "error");
      return;
    }
    if (!selectedClassName) {
      showToast("Sélectionnez une classe.", "error");
      return;
    }
    const defaultSubject = subject || subjectOptions[0] || "";
    const period = activePeriod
      ? {
          periodName: activePeriod.name,
          periodStart: activePeriod.startDate,
          periodEnd: activePeriod.endDate,
        }
      : defaultPeriod;
    const base = {
      ...EMPTY_FORM(selectedClassName, period, kind),
      weekday: weekdayFromIso(start),
      startTime: extractTimeFromIso(start),
      endTime: extractTimeFromIso(end),
      examDate: isoToPeriodDate(start) || period.periodStart || "",
      subject: defaultSubject,
    };
    const { teacherId, teacherName } = resolveCourseTeacher(
      state,
      scopeUser,
      selectedClassName,
      defaultSubject,
    );
    base.teacherId = teacherId;
    base.teacherName = teacherName;
    setForm(base);
  }

  function openEdit(slot: CourseScheduleSlot) {
    if (!canUpdate && !canRead) return;
    const resolved = resolveCourseTeacher(state, scopeUser, slot.className, slot.subject);
    const fallbackPeriod = activePeriod
      ? { periodName: activePeriod.name, periodStart: activePeriod.startDate, periodEnd: activePeriod.endDate }
      : defaultPeriod;
    const base = formFromSlot(slot, fallbackPeriod);
    setForm({
      ...base,
      teacherId: resolved.fromCourse ? resolved.teacherId : base.teacherId || resolved.teacherId,
      teacherName: resolved.fromCourse ? resolved.teacherName : base.teacherName || resolved.teacherName,
    });
  }

  async function persistSlots(
    nextSchoolSlots: CourseScheduleSlot[],
    message: string,
    options: { keepForm?: boolean } = {},
  ) {
    if (!schoolCode) {
      showToast("Sélectionnez un établissement actif.", "error");
      return;
    }
    const previousSchoolSlots = scopedCourseSchedules(scopeUser, stateRef.current).filter(
      (row) => normalize(row.schoolCode) === normalize(schoolCode),
    );
    setSaving(true);
    try {
      await syncSchoolCourseSchedules(previousSchoolSlots, nextSchoolSlots);
      const exams = mergePlanningLinkedExams(stateRef.current, nextSchoolSlots, previousSchoolSlots);
      await update({ exams }, { partial: true });
      await refresh();
      showToast(message, "success");
      if (!options.keepForm) {
        setForm(null);
      }
    } catch {
      showToast("Échec de l'enregistrement du planning.", "error");
    } finally {
      setSaving(false);
    }
  }

  function buildSlotFromForm(): CourseScheduleSlot | null {
    if (!form || !schoolCode) return null;
    const resolved = resolveCourseTeacher(state, scopeUser, form.className, form.subject);
    const teacherId = resolved.fromCourse ? resolved.teacherId : form.teacherId || resolved.teacherId;
    const teacherName = resolved.fromCourse ? resolved.teacherName : form.teacherName || resolved.teacherName;
    const isExam = form.kind === "exam";
    const { start, end } = isExam
      ? buildExamSlotTimes(form.examDate, form.startTime, form.endTime)
      : slotTimesFromForm(form);
    const scheduleId = form.id || createScheduleId();

    return normalizePlanningSlotForSave({
      id: scheduleId,
      schoolCode,
      className: form.className.trim(),
      subject: form.subject.trim(),
      teacherId,
      teacherName,
      start,
      end,
      room: form.room.trim() || undefined,
      kind: form.kind,
      examType: isExam ? form.examType.trim() || EXAM_TYPE_OPTIONS[0] : undefined,
      examName: isExam ? form.examName.trim() || undefined : undefined,
      examId: isExam ? form.examId || `EX-${scheduleId}` : undefined,
      periodName: (isExam ? activePeriod?.name ?? form.periodName : form.periodName)?.trim() || undefined,
      periodStart: isExam ? undefined : form.periodStart.trim() || undefined,
      periodEnd: isExam ? undefined : form.periodEnd.trim() || undefined,
    });
  }

  async function saveForm() {
    if (!form) return;
    const slot = buildSlotFromForm();
    if (!slot) return;
    if (!slot.className || !slot.subject || !form.startTime || !form.endTime) {
      showToast("Classe, matière et horaires sont obligatoires.", "error");
      return;
    }

    if (form.kind === "exam") {
      if (!form.examDate.trim()) {
        showToast("Indiquez la date de l'examen.", "error");
        return;
      }
    } else if (!slot.periodStart || !slot.periodEnd) {
      showToast("Indiquez la période (dates de début et de fin) pour ce cours.", "error");
      return;
    }

    if (form.kind === "course") {
      const periodStart = parsePeriodDate(slot.periodStart);
      const periodEnd = parsePeriodDate(slot.periodEnd);
      if (!periodStart || !periodEnd || periodEnd < periodStart) {
        showToast("La date de fin doit être postérieure ou égale à la date de début.", "error");
        return;
      }
    }

    const conflicts = validatePlanningSlotBusinessRules(schoolSlots, slot, {
      ignoreId: form?.id,
      allowedSubjects: subjectOptions,
    });
    if (conflicts.length) {
      showToast(conflicts[0], "error");
      return;
    }

    const next = form?.id
      ? schoolSlots.map((row) => (row.id === slot.id ? slot : row))
      : [...schoolSlots, slot];
    await persistSlots(next, form?.id ? "Planning mis à jour" : form.kind === "exam" ? "Examen planifié" : "Cours planifié sur la période");
  }

  async function deleteForm() {
    if (!form?.id || !canDelete) return;
    const next = schoolSlots.filter((row) => row.id !== form.id);
    await persistSlots(next, "Créneau supprimé");
  }

  async function persistSlotChange(eventId: string, start: string, end: string, message: string) {
    if (!canUpdate) return;
    const masterId = getMasterScheduleId(eventId);
    const current = schoolSlots.find((row) => row.id === masterId);
    if (!current) return;

    const patch = normalizePlanningSlotForSave({
      ...current,
      start,
      end,
      className: selectedClassName,
    });

    const resolved = resolveCourseTeacher(state, scopeUser, patch.className, patch.subject);
    if (resolved.fromCourse) {
      patch.teacherId = resolved.teacherId;
      patch.teacherName = resolved.teacherName;
    }

    const conflicts = validatePlanningSlotBusinessRules(schoolSlots, patch, {
      ignoreId: masterId,
      allowedSubjects: getClassSubjectNames(scopeUser, state, selectedClassName, schoolCode),
    });
    if (conflicts.length) {
      showToast(conflicts[0], "error");
      return;
    }

    const next = schoolSlots.map((row) => (row.id === masterId ? patch : row));
    await persistSlots(next, message, { keepForm: true });
  }

  const handleSelectSlot = useCallback(
    (start: string, end: string) => openCreate("course", start, end),
    // openCreate lit state / subjectOptions au moment du clic
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedClassName, canCreate, subjectOptions.join("\u0000"), schoolCode],
  );

  const handleEventClick = useCallback(
    (eventId: string) => {
      const masterId = getMasterScheduleId(eventId);
      const slot = schoolSlots.find((row) => row.id === masterId);
      if (slot) openEdit(slot);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schoolSlots, canRead, canUpdate],
  );

  const handleEventMoveStable = useCallback(
    (eventId: string, start: string, end: string) => {
      void persistSlotChange(eventId, start, end, "Créneau déplacé");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schoolSlots, selectedClassName, canUpdate, state, scopeUser],
  );

  const handleEventResizeStable = useCallback(
    (eventId: string, start: string, end: string) => {
      void persistSlotChange(eventId, start, end, "Créneau redimensionné");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schoolSlots, selectedClassName, canUpdate, state, scopeUser],
  );

  function applyPeriodDefaults(periodName: string) {
    const period = schoolPeriods.find((row) => row.name === periodName);
    if (!period) return;
    setForm((current) =>
      current
        ? {
            ...current,
            periodName: period.name,
            periodStart: period.startDate,
            periodEnd: period.endDate,
          }
        : current,
    );
  }

  function applySubjectDefaults(subject: string) {
    const resolved = resolveCourseTeacher(state, scopeUser, selectedClassName, subject);
    setForm((current) =>
      current
        ? {
            ...current,
            className: selectedClassName,
            subject: subject.trim(),
            teacherId: resolved.teacherId,
            teacherName: resolved.teacherName,
          }
        : current,
    );
  }

  const resolvedFormTeacher = useMemo(() => {
    if (!form?.subject.trim()) return null;
    return resolveCourseTeacher(state, scopeUser, form.className || selectedClassName, form.subject);
  }, [form?.className, form?.subject, selectedClassName, scopeUser, state]);

  if (!canRead) {
    return (
      <Card className="p-6">
        <p className="text-sm font-semibold text-muted">Accès refusé au planning de cours.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-slate-800 to-brand p-6 text-white">
        <p className="text-sm font-semibold text-white/75">Pédagogie</p>
        <h2 className="mt-2 text-2xl font-black">Planning de cours</h2>
        <p className="mt-2 max-w-3xl text-sm text-white/85">
          Point unique pour planifier cours et examens : créneaux récurrents, enseignant par matière,
          calendrier et horaires. Les anciennes affectations sont migrées ici ; le module Examens sert
          uniquement au suivi des statuts.
        </p>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title={selectedClassName ? `Classe ${selectedClassName}` : "Calendrier"}
          description={
            selectedClassName && activePeriod
              ? `${classCourseCount} cours · ${classExamCount} examen(s) · ${activePeriod.name}`
              : selectedClassName
                ? `${classCourseCount} cours · ${classExamCount} examen(s)`
                : "Sélectionnez une classe pour afficher son emploi du temps."
          }
          actions={
            selectedClassName ? (
              <PrintButton
                documentTitle={`Emploi du temps — ${selectedClassName}${
                  activePeriod ? ` — ${activePeriod.name}` : ""
                }`}
              />
            ) : undefined
          }
        />
        <div className="no-print mt-4 flex flex-wrap gap-3">
          <Field label="Classe">
            <Select
              value={selectedClassName}
              onChange={(event) => {
                const value = event.target.value;
                selectedClassRef.current = value;
                setSelectedClassName(value);
                setForm(null);
              }}
              options={classes.map((name) => ({ value: name, label: name }))}
            />
          </Field>
          <Field label="Période">
            <Select
              value={selectedPeriodName}
              onChange={(event) => {
                setSelectedPeriodName(event.target.value);
                setForm(null);
              }}
              options={
                schoolPeriods.length
                  ? [
                      { value: ALL_PLANNING_PERIODS, label: "Toutes les périodes" },
                      ...schoolPeriods.map((row) => ({
                        value: row.name,
                        label: `${row.name} (${row.startDate} → ${row.endDate})`,
                      })),
                    ]
                  : [
                      {
                        value: defaultPeriod.periodName ?? "",
                        label: defaultPeriod.periodName
                          ? `${defaultPeriod.periodName} (${defaultPeriod.periodStart} → ${defaultPeriod.periodEnd})`
                          : "Période",
                      },
                    ]
              }
            />
          </Field>
          <Field label="Afficher">
            <Select
              value={viewKindFilter}
              onChange={(event) => setViewKindFilter(event.target.value as PlanningViewFilter)}
              options={[
                { value: "all", label: "Cours et examens" },
                { value: "course", label: "Cours uniquement" },
                { value: "exam", label: "Examens uniquement" },
              ]}
            />
          </Field>
          {canCreate && selectedClassName ? (
            <div className="flex flex-wrap items-end gap-2">
              <Button
                onClick={() => {
                  const monday = new Date();
                  monday.setHours(10, 0, 0, 0);
                  const day = monday.getDay();
                  const diff = day === 0 ? -6 : 1 - day;
                  monday.setDate(monday.getDate() + diff);
                  const start = monday.toISOString();
                  const end = new Date(monday.getTime() + 3600000).toISOString();
                  openCreate("course", start, end);
                }}
              >
                Planifier un cours
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const today = new Date();
                  today.setHours(10, 0, 0, 0);
                  const start = today.toISOString();
                  const end = new Date(today.getTime() + 2 * 3600000).toISOString();
                  openCreate("exam", start, end);
                }}
              >
                Planifier un examen
              </Button>
              {canDelete ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => void handleResetPlanning()}
                >
                  Réinitialiser le planning
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {consistencyIssues.length ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-semibold">{consistencyIssues.length} alerte(s) de cohérence</p>
              {planningRepairAvailable && canUpdate ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => void handleRepairPlanningData()}
                >
                  Corriger les données
                </Button>
              ) : null}
            </div>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
              {consistencyIssues.slice(0, 5).map((issue) => (
                <li key={`${issue.slotId}-${issue.message}`}>{issue.message}</li>
              ))}
              {consistencyIssues.length > 5 ? (
                <li>… et {consistencyIssues.length - 5} autre(s)</li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <div className="relative mt-4">
          <CoursePlanningCalendar
            key={`${selectedClassName}__${selectedPeriodName}__${viewKindFilter}`}
            className={selectedClassName || "—"}
            events={selectedClassName ? events : []}
            legendSubjects={selectedClassName ? subjectOptions : []}
            editable={editable && Boolean(selectedClassName)}
            onSelectSlot={handleSelectSlot}
            onEventClick={handleEventClick}
            onEventMove={handleEventMoveStable}
            onEventResize={handleEventResizeStable}
          />
          {!selectedClassName ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-white/85">
              <p className="text-sm font-semibold text-muted">
                Aucune classe disponible pour cet établissement.
              </p>
            </div>
          ) : null}
        </div>
      </Card>

      {form ? (
        <Card className="p-6">
          <SectionHeader
            title={
              form.id
                ? form.kind === "exam"
                  ? "Modifier l'examen"
                  : "Modifier le cours"
                : form.kind === "exam"
                  ? "Planifier un examen"
                  : "Planifier un cours"
            }
            description={
              form.kind === "exam"
                ? `Session d'évaluation ponctuelle pour ${selectedClassName}.`
                : `Cours récurrent sur une période pour ${selectedClassName}.`
            }
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Type de planification">
              <Select
                value={form.kind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    kind: event.target.value as PlanningScheduleKind,
                  })
                }
                options={[
                  { value: "course", label: "Cours (récurrent chaque semaine)" },
                  { value: "exam", label: "Examen (date unique)" },
                ]}
              />
            </Field>
            <Field label="Classe">
              <Input value={selectedClassName} readOnly />
            </Field>
            <Field label="Matière">
              <Select
                value={form.subject}
                onChange={(event) => applySubjectDefaults(event.target.value)}
                options={subjectOptions.map((name) => ({ value: name, label: name }))}
              />
            </Field>
            {form.kind === "exam" ? (
              <>
                <Field label="Type d'examen">
                  <Select
                    value={form.examType}
                    onChange={(event) => setForm({ ...form, examType: event.target.value })}
                    options={EXAM_TYPE_OPTIONS.map((value) => ({ value, label: value }))}
                  />
                </Field>
                <Field label="Intitulé" hint="Optionnel — par défaut : type + matière.">
                  <Input
                    value={form.examName}
                    onChange={(event) => setForm({ ...form, examName: event.target.value })}
                    placeholder={`${form.examType} — ${form.subject || "Matière"}`}
                  />
                </Field>
                <Field label="Date de l'examen">
                  <Input
                    type="date"
                    value={periodDateToInput(form.examDate)}
                    onChange={(event) =>
                      setForm({ ...form, examDate: inputToPeriodDate(event.target.value) })
                    }
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Jour de la semaine">
                  <Select
                    value={String(form.weekday)}
                    onChange={(event) =>
                      setForm({ ...form, weekday: Number(event.target.value) })
                    }
                    options={PLANNING_WEEKDAYS.map((row) => ({
                      value: String(row.value),
                      label: row.label,
                    }))}
                  />
                </Field>
                <Field label="Période (modèle)" hint="Remplit les dates ci-dessous ; vous pouvez les ajuster.">
                  <Select
                    value={form.periodName}
                    onChange={(event) => applyPeriodDefaults(event.target.value)}
                    options={[
                      ...schoolPeriods.map((row) => ({
                        value: row.name,
                        label: `${row.name} (${row.startDate} → ${row.endDate})`,
                      })),
                      ...(form.periodName && !schoolPeriods.some((row) => row.name === form.periodName)
                        ? [{ value: form.periodName, label: form.periodName }]
                        : []),
                    ]}
                  />
                </Field>
                <Field label="Du (inclus)" hint="Ex. 10-09-2026">
                  <Input
                    type="date"
                    value={periodDateToInput(form.periodStart)}
                    onChange={(event) =>
                      setForm({ ...form, periodStart: inputToPeriodDate(event.target.value) })
                    }
                  />
                </Field>
                <Field label="Au (inclus)" hint="Ex. 23-12-2026">
                  <Input
                    type="date"
                    value={periodDateToInput(form.periodEnd)}
                    onChange={(event) =>
                      setForm({ ...form, periodEnd: inputToPeriodDate(event.target.value) })
                    }
                  />
                </Field>
              </>
            )}
            <Field label="Heure de début">
              <Input
                type="time"
                value={form.startTime}
                onChange={(event) => setForm({ ...form, startTime: event.target.value })}
              />
            </Field>
            <Field label="Heure de fin">
              <Input
                type="time"
                value={form.endTime}
                onChange={(event) => setForm({ ...form, endTime: event.target.value })}
              />
            </Field>
            <Field
              label="Enseignant"
              hint={
                resolvedFormTeacher?.fromCourse
                  ? "Professeur affecté automatiquement à ce cours pour cette classe."
                  : undefined
              }
            >
              {resolvedFormTeacher?.fromCourse ? (
                <Input value={resolvedFormTeacher.teacherName} readOnly />
              ) : (
                <Select
                  value={form.teacherId}
                  onChange={(event) => {
                    const teacher = teachers.find((row) => String(row.id) === event.target.value);
                    setForm({
                      ...form,
                      teacherId: event.target.value,
                      teacherName: String(
                        teacher?.name ?? `${teacher?.firstName ?? ""} ${teacher?.lastName ?? ""}`.trim(),
                      ),
                    });
                  }}
                  options={[
                    { value: "", label: "— Sélectionner —" },
                    ...teachers.map((row) => ({
                      value: String(row.id ?? ""),
                      label: String((row.name ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()) || row.id),
                    })),
                  ]}
                />
              )}
            </Field>
            <Field label="Salle">
              <Input value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} />
            </Field>
          </div>
          {buildSlotFromForm() ? (
            <p className="mt-3 rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm text-ink">
              {formatScheduleRecurrenceSummary(buildSlotFromForm()!)}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button disabled={saving} onClick={() => void saveForm()}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
            {form.id && canDelete ? (
              <Button variant="secondary" disabled={saving} onClick={() => void deleteForm()}>
                Supprimer
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setForm(null)}>
              Annuler
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
