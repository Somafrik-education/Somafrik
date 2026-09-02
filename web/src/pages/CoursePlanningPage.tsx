import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { ApiError } from "../api/client";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import { scopedClasses } from "../lib/establishment";
import { normalize } from "../lib/format";
import { CoursePlanningCalendar } from "../components/planning/CoursePlanningCalendar";
import {
  ALL_PLANNING_PERIODS,
  extractTimeFromIso,
  filterSlotsByClass,
  filterSlotsByPeriod,
  formatScheduleRecurrenceSummary,
  getDefaultPlanningPeriod,
  getMasterScheduleId,
  getOccurrenceDateFromEventId,
  getSchoolAcademicPeriods,
  isoWeekdayFromLocalDate,
  isExamSchedule,
  mapServerOccurrencesToCalendarEvents,
  normalizePlanningSlotForSave,
  pickPlanningPeriodWithSlots,
  PLANNING_WEEKDAYS,
  resolveCourseTeacher,
  scopedCourseSchedules,
  filterSlotsForPlanningWrite,
  resolvePlanningWriteSchoolIdentity,
  type CourseScheduleSlot,
  type PlanningCalendarEvent,
} from "../lib/coursePlanning";
import { pedagogyApi } from "../lib/pedagogyApi";
import { schoolRoomsApi, type SchoolRoom } from "../lib/planningRoomsReplacementsApi";
import { syncSchoolCourseSchedules } from "../lib/pedagogyPlanningSync";
import {
  mapPlanningCourseOptions,
  planningNoSchedulableCoursesMessage,
  resolveClassAcademicYearId,
  type PlanningSchoolCourseOption,
} from "../lib/planningWeeklyWrite";
import type { BackOfficeState, SessionUser } from "../types";

function classNamesKeyFromState(data: BackOfficeState, user: SessionUser | null): string {
  return scopedClasses(user, data)
    .map((row) => String(row.name ?? "").trim())
    .filter(Boolean)
    .join("\u0000");
}

type FormState = {
  id: string;
  className: string;
  schoolCourseId: string;
  academicYearId: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  roomId: string;
  occurrenceDate: string;
};

const EMPTY_FORM = (className: string, academicYearId = ""): FormState => ({
  id: "",
  className,
  schoolCourseId: "",
  academicYearId,
  subject: "",
  teacherId: "",
  teacherName: "",
  weekday: 1,
  startTime: "08:00",
  endTime: "09:00",
  roomId: "",
  occurrenceDate: "",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function planningWriteErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function formFromSlot(
  slot: CourseScheduleSlot,
  academicYearId: string,
): FormState {
  const weekday = Number(slot.dayOfWeek);
  return {
    id: slot.id,
    className: slot.className,
    schoolCourseId: slot.schoolCourseId ?? "",
    academicYearId: slot.academicYearId || academicYearId,
    subject: String(slot.courseName ?? slot.subject ?? ""),
    teacherId: slot.teacherId ?? "",
    teacherName: slot.teacherName ?? "",
    weekday: weekday >= 1 && weekday <= 7 ? weekday : isoWeekdayFromLocalDate(new Date(slot.start)),
    startTime: String(slot.startTime ?? "").trim().slice(0, 5) || extractTimeFromIso(slot.start),
    endTime: String(slot.endTime ?? "").trim().slice(0, 5) || extractTimeFromIso(slot.end),
    roomId: slot.roomId ?? "",
    occurrenceDate: slot.occurrenceDate ?? "",
  };
}

export function CoursePlanningPage() {
  const { session } = useAuth();
  const { state, refresh } = useData();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const { scopedUser, activeSchoolCode, activeSchool } = useActiveSchool();
  const scopeUser = scopedUser ?? session?.user ?? null;
  const schoolCode = activeSchoolCode || scopeUser?.schoolCode || "";
  const writeSchoolIdentity = useMemo(
    () =>
      resolvePlanningWriteSchoolIdentity({
        user: scopeUser,
        activeSchool,
      }),
    [scopeUser, activeSchool],
  );
  const { canRead, canCreate, canUpdate, canDelete } = useFeaturePermissions("Planning de cours");
  const replacements = useFeaturePermissions("Remplacements");
  const navigate = useNavigate();

  const [selectedClassName, setSelectedClassName] = useState("");
  const selectedClassRef = useRef("");
  const [selectedPeriodName, setSelectedPeriodName] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [visibleRange, setVisibleRange] = useState<{ from: string; to: string } | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<PlanningCalendarEvent[]>([]);
  const [classCourses, setClassCourses] = useState<PlanningSchoolCourseOption[]>([]);
  const [courseOptionsStatus, setCourseOptionsStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [rooms, setRooms] = useState<SchoolRoom[]>([]);

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

  const classAcademicYearId = useMemo(
    () => resolveClassAcademicYearId(scopeUser, state, selectedClassName),
    [scopeUser, state, selectedClassName],
  );

  const selectedClassId = useMemo(() => {
    const row = scopedClasses(scopeUser, state).find(
      (item) => normalize(String(item.name ?? "")) === normalize(selectedClassName),
    );
    const id = String((row as { id?: string } | undefined)?.id ?? "").trim();
    return UUID_RE.test(id) ? id : "";
  }, [scopeUser, state.classes, selectedClassName]);

  useEffect(() => {
    if (!canRead) {
      setRooms([]);
      return;
    }
    let cancelled = false;
    schoolRoomsApi
      .list({ status: "active", classId: selectedClassId || undefined })
      .then((result) => {
        if (!cancelled) setRooms(result.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setRooms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, selectedClassId]);

  useEffect(() => {
    if (!canRead || !selectedClassName) {
      setClassCourses([]);
      setCourseOptionsStatus("idle");
      return;
    }
    let cancelled = false;
    setCourseOptionsStatus("loading");
    pedagogyApi
      .listPlanningCourseOptions({
        classId: selectedClassId || undefined,
        className: selectedClassName,
      })
      .then((payload) => {
        if (cancelled) return;
        setClassCourses(mapPlanningCourseOptions(payload?.items));
        setCourseOptionsStatus("ok");
      })
      .catch(() => {
        if (cancelled) return;
        setClassCourses([]);
        setCourseOptionsStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, selectedClassName, selectedClassId]);

  const weeklySlots = useMemo(
    () => schoolSlots.filter((slot) => !isExamSchedule(slot) && String(slot.status ?? "active") !== "cancelled"),
    [schoolSlots],
  );

  const periodScopedSlots = useMemo(
    () => filterSlotsByPeriod(weeklySlots, activePeriod),
    [weeklySlots, activePeriod],
  );

  const classSlots = useMemo(
    () => filterSlotsByClass(periodScopedSlots, selectedClassName),
    [periodScopedSlots, selectedClassName],
  );

  useEffect(() => {
    if (!canRead || !selectedClassName || !visibleRange?.from || !visibleRange?.to) {
      setCalendarEvents([]);
      return;
    }
    let cancelled = false;
    void pedagogyApi
      .listCourseScheduleOccurrences({
        from: visibleRange.from,
        to: visibleRange.to,
        academicYearId: classAcademicYearId || undefined,
        classId: selectedClassId || undefined,
      })
      .then((payload) => {
        if (cancelled) return;
        setCalendarEvents(mapServerOccurrencesToCalendarEvents(payload?.items, selectedClassName));
      })
      .catch(() => {
        if (!cancelled) setCalendarEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [
    canRead,
    selectedClassName,
    selectedClassId,
    classAcademicYearId,
    visibleRange?.from,
    visibleRange?.to,
    state.courseSchedules,
  ]);

  async function handleResetPlanning() {
    if (!schoolCode || !canDelete) return;
    if (!writeSchoolIdentity) {
      showToast("Établissement actif introuvable. Sélectionnez un établissement pour annuler le planning.", "error");
      return;
    }
    const confirmed = await confirm({
      title: "Annuler tous les créneaux hebdomadaires ?",
      description:
        "Chaque créneau actif sera annulé (statut cancelled). Les cours, classes, affectations et examens restent inchangés.",
      confirmLabel: "Annuler les créneaux",
      tone: "danger",
    });
    if (!confirmed) return;

    const previousSchoolSlots = filterSlotsForPlanningWrite(weeklySlots, writeSchoolIdentity);
    setSaving(true);
    try {
      await syncSchoolCourseSchedules(previousSchoolSlots, []);
      await refresh(["courseSchedules"]);
      setForm(null);
      showToast("Créneaux hebdomadaires annulés.", "success");
    } catch {
      showToast("Échec de l'annulation du planning.", "error");
    } finally {
      setSaving(false);
    }
  }

  const editable = canCreate || canUpdate;

  function openCreate(start?: string, end?: string) {
    if (!canCreate) {
      showToast("Vous n'avez pas le droit de créer un créneau.", "error");
      return;
    }
    if (!selectedClassName) {
      showToast("Sélectionnez une classe.", "error");
      return;
    }
    if (!classAcademicYearId) {
      showToast("Année académique introuvable pour cette classe.", "error");
      return;
    }
    if (courseOptionsStatus === "loading") {
      showToast("Chargement des cours planifiables…", "info");
      return;
    }
    if (courseOptionsStatus === "error") {
      showToast("Impossible de charger les cours planifiables. Réessayez.", "error");
      return;
    }
    if (!classCourses.length) {
      showToast(planningNoSchedulableCoursesMessage(selectedClassName), "error");
      return;
    }
    const course = classCourses[0];
    const weekday = start ? isoWeekdayFromLocalDate(new Date(start)) : 1;
    setForm({
      ...EMPTY_FORM(selectedClassName, classAcademicYearId),
      schoolCourseId: course.schoolCourseId,
      subject: course.name,
      teacherId: course.teacherId,
      teacherName: course.teacherName,
      weekday,
      startTime: start ? extractTimeFromIso(start) : "08:00",
      endTime: end ? extractTimeFromIso(end) : "09:00",
    });
  }

  function openEdit(slot: CourseScheduleSlot) {
    if (!canUpdate && !canRead) return;
    const base = formFromSlot(slot, slot.academicYearId || classAcademicYearId);
    const course = classCourses.find((row) => row.schoolCourseId === base.schoolCourseId);
    setForm({
      ...base,
      teacherId: course?.teacherId || base.teacherId,
      teacherName: course?.teacherName || base.teacherName,
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
    if (!writeSchoolIdentity) {
      showToast("Établissement actif introuvable. Sélectionnez un établissement.", "error");
      return;
    }
    const previousSchoolSlots = filterSlotsForPlanningWrite(weeklySlots, writeSchoolIdentity);
    const scopedNextSlots = filterSlotsForPlanningWrite(nextSchoolSlots, writeSchoolIdentity);
    setSaving(true);
    try {
      await syncSchoolCourseSchedules(previousSchoolSlots, scopedNextSlots);
      await refresh(["courseSchedules"]);
      showToast(message, "success");
      if (!options.keepForm) {
        setForm(null);
      }
    } catch (err) {
      showToast(planningWriteErrorMessage(err, "Échec de l'enregistrement du planning."), "error");
    } finally {
      setSaving(false);
    }
  }

  function buildSlotFromForm(): CourseScheduleSlot | null {
    if (!form || !schoolCode || !writeSchoolIdentity) return null;
    const course = classCourses.find((row) => row.schoolCourseId === form.schoolCourseId);
    const resolved = resolveCourseTeacher(state, scopeUser, form.className, course?.name || form.subject);
    return normalizePlanningSlotForSave({
      id: form.id || `tmp-${Date.now()}`,
      schoolId: writeSchoolIdentity.schoolId || undefined,
      schoolCode: writeSchoolIdentity.publicCode || schoolCode,
      className: form.className.trim(),
      subject: (course?.name || form.subject).trim(),
      courseName: (course?.name || form.subject).trim(),
      schoolCourseId: form.schoolCourseId,
      academicYearId: form.academicYearId || classAcademicYearId,
      teacherId: course?.teacherId || resolved.teacherId || form.teacherId,
      teacherName: course?.teacherName || resolved.teacherName || form.teacherName,
      dayOfWeek: form.weekday,
      startTime: form.startTime,
      endTime: form.endTime,
      start: "",
      end: "",
      room: rooms.find((row) => row.id === form.roomId)?.name,
      roomId: form.roomId || undefined,
      kind: "course",
      status: "active",
    });
  }

  async function saveForm() {
    if (!form) return;
    const slot = buildSlotFromForm();
    if (!slot) return;
    if (!slot.schoolCourseId || !slot.academicYearId || !form.startTime || !form.endTime) {
      showToast("Cours canonique, année académique et horaires sont obligatoires.", "error");
      return;
    }
    if (form.endTime <= form.startTime) {
      showToast("L'heure de fin doit être postérieure à l'heure de début.", "error");
      return;
    }
    const selectedRoom = rooms.find((row) => row.id === form.roomId);
    if (selectedRoom?.capacityWarning) {
      const ok = await confirm({
        title: "Capacité inférieure à l'effectif",
        description: `${selectedRoom.capacityWarning.message} Vous pouvez confirmer malgré tout.`,
        confirmLabel: "Confirmer",
      });
      if (!ok) return;
    }

    const next = form.id
      ? weeklySlots.map((row) => (row.id === slot.id ? slot : row))
      : [...weeklySlots, slot];
    await persistSlots(next, form.id ? "Créneau mis à jour" : "Créneau hebdomadaire créé");
  }

  async function deleteForm() {
    if (!form?.id || !canDelete) return;
    const next = weeklySlots.filter((row) => row.id !== form.id);
    await persistSlots(next, "Créneau annulé");
  }

  async function persistSlotChange(eventId: string, start: string, end: string, message: string) {
    if (!canUpdate) return;
    const masterId = getMasterScheduleId(eventId);
    const current = weeklySlots.find((row) => row.id === masterId);
    if (!current) return;

    const patch = normalizePlanningSlotForSave({
      ...current,
      dayOfWeek: isoWeekdayFromLocalDate(new Date(start)),
      startTime: extractTimeFromIso(start),
      endTime: extractTimeFromIso(end),
      start: "",
      end: "",
    });

    const next = weeklySlots.map((row) => (row.id === masterId ? patch : row));
    await persistSlots(next, message, { keepForm: true });
  }

  const handleSelectSlot = useCallback(
    (start: string, end: string) => openCreate(start, end),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedClassName, canCreate, classCourses, classAcademicYearId, schoolCode],
  );

  const handleEventClick = useCallback(
    (eventId: string) => {
      const masterId = getMasterScheduleId(eventId);
      const slot = weeklySlots.find((row) => row.id === masterId);
      const occurrenceDate = getOccurrenceDateFromEventId(eventId);
      if (slot) openEdit({ ...slot, occurrenceDate });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weeklySlots, canRead, canUpdate, classCourses, classAcademicYearId],
  );

  const handleEventMoveStable = useCallback(
    (eventId: string, start: string, end: string) => {
      void persistSlotChange(eventId, start, end, "Créneau déplacé");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weeklySlots, selectedClassName, canUpdate, classCourses],
  );

  const handleEventResizeStable = useCallback(
    (eventId: string, start: string, end: string) => {
      void persistSlotChange(eventId, start, end, "Créneau redimensionné");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weeklySlots, selectedClassName, canUpdate, classCourses],
  );

  function applyCourseDefaults(schoolCourseId: string) {
    const course = classCourses.find((row) => row.schoolCourseId === schoolCourseId);
    if (!course) return;
    setForm((current) =>
      current
        ? {
            ...current,
            className: selectedClassName,
            schoolCourseId: course.schoolCourseId,
            academicYearId: current.academicYearId || classAcademicYearId,
            subject: course.name,
            teacherId: course.teacherId,
            teacherName: course.teacherName,
          }
        : current,
    );
  }

  const resolvedFormTeacher = useMemo(() => {
    if (!form?.schoolCourseId && !form?.subject.trim()) return null;
    const course = classCourses.find((row) => row.schoolCourseId === form.schoolCourseId);
    if (course?.teacherName) {
      return { teacherId: course.teacherId, teacherName: course.teacherName, fromCourse: true };
    }
    return resolveCourseTeacher(state, scopeUser, form.className || selectedClassName, form.subject);
  }, [form, selectedClassName, scopeUser, state, classCourses]);

  if (!canRead) {
    return (
      <Card className="p-6" data-testid="planning-access-denied">
        <p className="text-sm font-semibold text-muted">Accès refusé au planning de cours.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="planning-page">
      <Card className="bg-gradient-to-br from-slate-800 to-brand p-6 text-white">
        <p className="text-sm font-semibold text-white/75">Pédagogie</p>
        <h2 className="mt-2 text-2xl font-black">Planning de cours</h2>
        <p className="mt-2 max-w-3xl text-sm text-white/85">
          Emploi du temps hebdomadaire rattaché à un cours canonique, une année académique et un
          enseignant. Les examens restent dans le module Examens. Les salles sont des ressources
          canoniques ; un remplacement ponctuel n'altère pas le titulaire du cours.
        </p>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title={selectedClassName ? `Classe ${selectedClassName}` : "Calendrier"}
          description={
            selectedClassName
              ? `${classSlots.length} créneau(x) hebdomadaire(s)${activePeriod ? ` · vue ${activePeriod.name}` : ""}`
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
              data-testid="planning-class-select"
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
          {canCreate && selectedClassName ? (
            <div className="flex flex-wrap items-end gap-2">
              <Button
                data-testid="planning-create-button"
                disabled={courseOptionsStatus === "loading"}
                onClick={() => openCreate()}
              >
                Planifier un cours
              </Button>
              {canDelete ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => void handleResetPlanning()}
                >
                  Annuler tous les créneaux
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="relative mt-4">
          <CoursePlanningCalendar
            key={`${selectedClassName}__${selectedPeriodName}`}
            className={selectedClassName || "—"}
            events={selectedClassName ? calendarEvents : []}
            legendSubjects={selectedClassName ? classCourses.map((row) => row.name) : []}
            editable={editable && Boolean(selectedClassName)}
            onSelectSlot={handleSelectSlot}
            onEventClick={handleEventClick}
            onEventMove={handleEventMoveStable}
            onEventResize={handleEventResizeStable}
            onVisibleRangeChange={setVisibleRange}
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
            title={form.id ? "Modifier le créneau hebdomadaire" : "Planifier un cours"}
            description={`Règle weekly pour ${selectedClassName} — jour 1–7 et heures locales, rattachée au cours canonique.`}
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Classe">
              <Input value={selectedClassName} readOnly />
            </Field>
            <Field label="Cours" hint="Identifiant school_courses, pas le libellé seul." required>
              <Select
                data-testid="planning-course-select"
                value={form.schoolCourseId}
                onChange={(event) => applyCourseDefaults(event.target.value)}
                options={classCourses.map((row) => ({ value: row.schoolCourseId, label: row.name }))}
              />
            </Field>
            <Field label="Jour de la semaine">
              <Select
                data-testid="planning-weekday"
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
            <Field label="Heure de début" required>
              <Input
                type="time"
                data-testid="planning-start-time"
                value={form.startTime}
                onChange={(event) => setForm({ ...form, startTime: event.target.value })}
              />
            </Field>
            <Field label="Heure de fin" required>
              <Input
                type="time"
                data-testid="planning-end-time"
                value={form.endTime}
                onChange={(event) => setForm({ ...form, endTime: event.target.value })}
              />
            </Field>
            <Field
              label="Enseignant"
              hint="Issu du cours canonique — non saisissable ici."
            >
              <Input value={resolvedFormTeacher?.teacherName || form.teacherName || "—"} readOnly />
            </Field>
            <Field label="Salle" hint="Salle canonique optionnelle. Aucune salle si l'établissement ne gère pas encore les locaux.">
              <Select
                data-testid="planning-room-select"
                value={form.roomId}
                onChange={(event) => setForm({ ...form, roomId: event.target.value })}
                options={[
                  { value: "", label: "Aucune salle" },
                  ...rooms.map((room) => ({
                    value: room.id,
                    label: `${room.name}${room.capacity ? ` · ${room.capacity} places` : ""}${
                      room.capacityWarning ? " · ⚠ capacité" : ""
                    }`,
                  })),
                ]}
              />
            </Field>
          </div>
          {buildSlotFromForm() ? (
            <p className="mt-3 rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm text-ink">
              {formatScheduleRecurrenceSummary(buildSlotFromForm()!)}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              data-testid="planning-save-button"
              disabled={saving || !(form.id ? canUpdate : canCreate)}
              onClick={() => void saveForm()}
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
            {form.id && canDelete ? (
              <Button
                variant="secondary"
                data-testid="planning-cancel-slot-button"
                disabled={saving}
                onClick={() => void deleteForm()}
              >
                Annuler le créneau
              </Button>
            ) : null}
            {form.id && form.occurrenceDate && replacements.canCreate ? (
              <Button
                variant="secondary"
                data-testid="planning-program-replacement"
                onClick={() =>
                  navigate(
                    `/planning/remplacements?weeklySlotId=${encodeURIComponent(form.id)}&occurrenceDate=${encodeURIComponent(form.occurrenceDate)}`,
                  )
                }
              >
                Programmer un remplacement
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setForm(null)}>
              Fermer
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
