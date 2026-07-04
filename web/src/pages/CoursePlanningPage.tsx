import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import { scopedClasses, scopedTeachers } from "../lib/establishment";
import { normalize } from "../lib/format";
import { CoursePlanningCalendar } from "../components/planning/CoursePlanningCalendar";
import {
  createScheduleId,
  detectScheduleConflicts,
  formatSlotLabel,
  getClassSubjectNames,
  mergeCourseSchedules,
  resolveCourseTeacher,
  scopedCourseSchedules,
  slotsToClassCalendarEvents,
  type CourseScheduleSlot,
} from "../lib/coursePlanning";

type FormState = {
  id: string;
  className: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  start: string;
  end: string;
  room: string;
};

const EMPTY_FORM = (className: string): FormState => ({
  id: "",
  className,
  subject: "",
  teacherId: "",
  teacherName: "",
  start: "",
  end: "",
  room: "",
});

function toLocalInputValue(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value: string): string {
  if (!value) return "";
  return new Date(value).toISOString();
}

export function CoursePlanningPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();
  const { scopedUser, activeSchoolCode } = useActiveSchool();
  const scopeUser = scopedUser ?? session?.user ?? null;
  const schoolCode = activeSchoolCode || scopeUser?.schoolCode || "";
  const { canRead, canCreate, canUpdate, canDelete } = useFeaturePermissions("Planning de cours");

  const [selectedClassName, setSelectedClassName] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const classes = useMemo(
    () =>
      scopedClasses(scopeUser, state)
        .map((row) => String(row.name ?? "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "fr")),
    [scopeUser, state],
  );

  const classNamesKey = useMemo(() => classes.join("\u0000"), [classes]);

  useEffect(() => {
    if (!classes.length) {
      setSelectedClassName("");
      return;
    }
    setSelectedClassName((current) => {
      if (current && classes.includes(current)) return current;
      return classes[0];
    });
  }, [classNamesKey, classes.length]);

  const teachers = useMemo(() => scopedTeachers(scopeUser, state), [scopeUser, state]);

  const subjectOptions = useMemo(
    () => getClassSubjectNames(scopeUser, state, selectedClassName, schoolCode),
    [scopeUser, state, selectedClassName, schoolCode],
  );

  const schoolSlots = useMemo(
    () => scopedCourseSchedules(scopeUser, state),
    [scopeUser, state],
  );

  const classSlots = useMemo(
    () => schoolSlots.filter((slot) => normalize(slot.className) === normalize(selectedClassName)),
    [schoolSlots, selectedClassName],
  );

  const events = useMemo(
    () => slotsToClassCalendarEvents(schoolSlots, selectedClassName),
    [schoolSlots, selectedClassName],
  );

  const editable = canCreate || canUpdate;

  function openCreate(start: string, end: string, subject = "") {
    if (!canCreate) {
      showToast("Vous n'avez pas le droit de créer un créneau.", "error");
      return;
    }
    if (!selectedClassName) {
      showToast("Sélectionnez une classe.", "error");
      return;
    }
    const defaultSubject = subject || subjectOptions[0] || "";
    const base = {
      ...EMPTY_FORM(selectedClassName),
      start,
      end,
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
    setForm({
      id: slot.id,
      className: slot.className,
      subject: slot.subject,
      teacherId: resolved.fromCourse ? resolved.teacherId : slot.teacherId ?? resolved.teacherId,
      teacherName: resolved.fromCourse ? resolved.teacherName : slot.teacherName ?? resolved.teacherName,
      start: slot.start,
      end: slot.end,
      room: slot.room ?? "",
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
    setSaving(true);
    try {
      await update(
        { courseSchedules: mergeCourseSchedules(state, schoolCode, nextSchoolSlots) },
        { partial: true },
      );
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

    return {
      id: form.id || createScheduleId(),
      schoolCode,
      className: form.className.trim(),
      subject: form.subject.trim(),
      teacherId,
      teacherName,
      start: form.start,
      end: form.end,
      room: form.room.trim() || undefined,
    };
  }

  async function saveForm() {
    const slot = buildSlotFromForm();
    if (!slot) return;
    if (!slot.className || !slot.subject || !slot.start || !slot.end) {
      showToast("Classe, matière et horaires sont obligatoires.", "error");
      return;
    }

    const conflicts = detectScheduleConflicts(schoolSlots, slot, form?.id);
    if (conflicts.length) {
      showToast(conflicts[0], "error");
      return;
    }

    const next = form?.id
      ? schoolSlots.map((row) => (row.id === slot.id ? slot : row))
      : [...schoolSlots, slot];
    await persistSlots(next, form?.id ? "Créneau mis à jour" : "Créneau ajouté au planning");
  }

  async function deleteForm() {
    if (!form?.id || !canDelete) return;
    const next = schoolSlots.filter((row) => row.id !== form.id);
    await persistSlots(next, "Créneau supprimé");
  }

  async function persistSlotChange(eventId: string, start: string, end: string, message: string) {
    if (!canUpdate) return;
    const current = schoolSlots.find((row) => row.id === eventId);
    if (!current) return;

    const patch: CourseScheduleSlot = {
      ...current,
      start,
      end,
      className: selectedClassName,
    };

    const resolved = resolveCourseTeacher(state, scopeUser, patch.className, patch.subject);
    if (resolved.fromCourse) {
      patch.teacherId = resolved.teacherId;
      patch.teacherName = resolved.teacherName;
    }

    const conflicts = detectScheduleConflicts(schoolSlots, patch, eventId);
    if (conflicts.length) {
      showToast(conflicts[0], "error");
      return;
    }

    const next = schoolSlots.map((row) => (row.id === eventId ? patch : row));
    await persistSlots(next, message, { keepForm: true });
  }

  const handleSelectSlot = useCallback(
    (start: string, end: string) => openCreate(start, end),
    // openCreate lit state / subjectOptions au moment du clic
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedClassName, canCreate, subjectOptions.join("\u0000"), schoolCode],
  );

  const handleEventClick = useCallback(
    (eventId: string) => {
      const slot = schoolSlots.find((row) => row.id === eventId);
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
          Emploi du temps par classe : vues jour, semaine, mois et planning horaire. Matière dans chaque
          créneau — glisser-déposer et redimensionnement des plages horaires.
        </p>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title={selectedClassName ? `Classe ${selectedClassName}` : "Calendrier"}
          description={
            selectedClassName
              ? `${classSlots.length} créneau(x) · ${subjectOptions.length} matière(s) disponible(s)`
              : "Sélectionnez une classe pour afficher son emploi du temps."
          }
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <Field label="Classe">
            <Select
              value={selectedClassName}
              onChange={(event) => {
                setSelectedClassName(event.target.value);
                setForm(null);
              }}
              options={classes.map((name) => ({ value: name, label: name }))}
            />
          </Field>
          {canCreate && selectedClassName ? (
            <div className="flex items-end">
              <Button
                onClick={() => {
                  const now = new Date();
                  openCreate(now.toISOString(), new Date(now.getTime() + 3600000).toISOString());
                }}
              >
                Nouveau créneau
              </Button>
            </div>
          ) : null}
        </div>

        <div className="mt-4">
          {!selectedClassName ? (
            <p className="text-sm font-semibold text-muted">Aucune classe disponible pour cet établissement.</p>
          ) : (
            <CoursePlanningCalendar
              className={selectedClassName}
              events={events}
              legendSubjects={subjectOptions}
              editable={editable}
              onSelectSlot={handleSelectSlot}
              onEventClick={handleEventClick}
              onEventMove={handleEventMoveStable}
              onEventResize={handleEventResizeStable}
            />
          )}
        </div>
      </Card>

      {form ? (
        <Card className="p-6">
          <SectionHeader
            title={form.id ? "Modifier le créneau" : "Nouveau créneau"}
            description={`Créneau pour la classe ${selectedClassName}.`}
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
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
            <Field label="Début">
              <Input
                type="datetime-local"
                value={toLocalInputValue(form.start)}
                onChange={(event) => setForm({ ...form, start: fromLocalInputValue(event.target.value) })}
              />
            </Field>
            <Field label="Fin">
              <Input
                type="datetime-local"
                value={toLocalInputValue(form.end)}
                onChange={(event) => setForm({ ...form, end: fromLocalInputValue(event.target.value) })}
              />
            </Field>
          </div>
          {form.id && buildSlotFromForm() ? (
            <p className="mt-3 text-sm text-muted">{formatSlotLabel(buildSlotFromForm()!)}</p>
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
