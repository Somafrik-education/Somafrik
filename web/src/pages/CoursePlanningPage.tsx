import { useEffect, useMemo, useState } from "react";
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
  buildClassSubjectResources,
  createScheduleId,
  detectScheduleConflicts,
  findCourseAssignment,
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

  useEffect(() => {
    if (!classes.length) {
      setSelectedClassName("");
      return;
    }
    if (!selectedClassName || !classes.includes(selectedClassName)) {
      setSelectedClassName(classes[0]);
    }
  }, [classes, selectedClassName]);

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

  const resources = useMemo(
    () => buildClassSubjectResources(selectedClassName, scopeUser, state, schoolCode),
    [selectedClassName, scopeUser, state, schoolCode],
  );

  const events = useMemo(
    () => slotsToClassCalendarEvents(schoolSlots, selectedClassName),
    [schoolSlots, selectedClassName],
  );

  const editable = canCreate || canUpdate;

  function openCreate(start: string, end: string, subject: string) {
    if (!canCreate) {
      showToast("Vous n'avez pas le droit de créer un créneau.", "error");
      return;
    }
    if (!selectedClassName) {
      showToast("Sélectionnez une classe.", "error");
      return;
    }
    const base = { ...EMPTY_FORM(selectedClassName), start, end, subject };
    const { teacherId, teacherName } = resolveCourseTeacher(state, scopeUser, selectedClassName, subject);
    base.teacherId = teacherId;
    base.teacherName = teacherName;
    setForm(base);
  }

  function openEdit(slot: CourseScheduleSlot) {
    if (!canUpdate && !canRead) return;
    setForm({
      id: slot.id,
      className: slot.className,
      subject: slot.subject,
      teacherId: slot.teacherId ?? "",
      teacherName: slot.teacherName ?? "",
      start: slot.start,
      end: slot.end,
      room: slot.room ?? "",
    });
  }

  async function persistSlots(nextSchoolSlots: CourseScheduleSlot[], message: string) {
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
      setForm(null);
    } catch {
      showToast("Échec de l'enregistrement du planning.", "error");
    } finally {
      setSaving(false);
    }
  }

  function buildSlotFromForm(): CourseScheduleSlot | null {
    if (!form || !schoolCode) return null;
    const assignment = findCourseAssignment(state, scopeUser, form.className, form.subject);
    const teacherFromForm = teachers.find((row) => String(row.id) === form.teacherId);
    const teacherName =
      form.teacherName ||
      String(teacherFromForm?.name ?? `${teacherFromForm?.firstName ?? ""} ${teacherFromForm?.lastName ?? ""}`.trim()) ||
      String(assignment?.teacherName ?? "");

    return {
      id: form.id || createScheduleId(),
      schoolCode,
      className: form.className.trim(),
      subject: form.subject.trim(),
      teacherId: form.teacherId || String(assignment?.teacherId ?? teacherFromForm?.id ?? ""),
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

  async function handleEventDrop(eventId: string, start: string, end: string, subject: string) {
    if (!canUpdate) return;
    const current = schoolSlots.find((row) => row.id === eventId);
    if (!current) return;

    const patch: CourseScheduleSlot = {
      ...current,
      start,
      end,
      className: selectedClassName,
      subject: subject || current.subject,
    };

    const assignment = findCourseAssignment(state, scopeUser, patch.className, patch.subject);
    if (assignment) {
      patch.teacherId = String(assignment.teacherId ?? patch.teacherId ?? "");
      patch.teacherName = String(assignment.teacherName ?? patch.teacherName ?? "");
    }

    const conflicts = detectScheduleConflicts(schoolSlots, patch, eventId);
    if (conflicts.length) {
      showToast(conflicts[0], "error");
      return;
    }

    const next = schoolSlots.map((row) => (row.id === eventId ? patch : row));
    await persistSlots(next, "Créneau déplacé");
  }

  function applySubjectDefaults(subject: string) {
    const { teacherId, teacherName } = resolveCourseTeacher(state, scopeUser, selectedClassName, subject);
    setForm((current) =>
      current
        ? {
            ...current,
            className: selectedClassName,
            subject,
            teacherId: teacherId || current.teacherId,
            teacherName: teacherName || current.teacherName,
          }
        : current,
    );
  }

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
          Emploi du temps par classe : choisissez une classe, puis organisez les créneaux de chaque
          matière sur la semaine. Les affectations matière / enseignant pré-remplissent les cours.
        </p>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title={selectedClassName ? `Classe ${selectedClassName}` : "Calendrier"}
          description={
            selectedClassName
              ? `${classSlots.length} créneau(x) · ${resources.length} matière(s)`
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
                onClick={() =>
                  openCreate(
                    new Date().toISOString(),
                    new Date(Date.now() + 3600000).toISOString(),
                    resources[0]?.id ?? "",
                  )
                }
              >
                Nouveau créneau
              </Button>
            </div>
          ) : null}
        </div>

        <div className="mt-4">
          {!selectedClassName ? (
            <p className="text-sm font-semibold text-muted">Aucune classe disponible pour cet établissement.</p>
          ) : resources.length ? (
            <CoursePlanningCalendar
              className={selectedClassName}
              events={events}
              resources={resources}
              editable={editable}
              onSelectSlot={openCreate}
              onEventClick={(eventId) => {
                const slot = schoolSlots.find((row) => row.id === eventId);
                if (slot) openEdit(slot);
              }}
              onEventDrop={handleEventDrop}
            />
          ) : (
            <p className="text-sm font-semibold text-muted">
              Aucune matière configurée pour {selectedClassName}. Ajoutez des cours ou des affectations
              pour cette classe.
            </p>
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
                onChange={(event) => {
                  const subject = event.target.value;
                  setForm({ ...form, subject, className: selectedClassName });
                  applySubjectDefaults(subject);
                }}
                options={subjectOptions.map((name) => ({ value: name, label: name }))}
              />
            </Field>
            <Field label="Enseignant">
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
                options={teachers.map((row) => ({
                  value: String(row.id ?? ""),
                  label: String((row.name ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()) || row.id),
                }))}
              />
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
