import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { api } from "../api/client";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Field";
import { PrintButton } from "../components/ui/PrintButton";
import { useToast } from "../components/ui/Toast";
import { useFeaturePermissions, usePermissionContext } from "../lib/usePermissionContext";
import { canManagePresences } from "../lib/permissions";
import { scopedClasses, scopedStudents, teacherScopedClassNames } from "../lib/establishment";
import { normalize } from "../lib/format";
import {
  type AttendanceStatus,
  findTodayPresenceForStudent,
  formatAttendanceDate,
  formatAttendanceHour,
  getPresenceStats,
  presenceIsAttended,
  presenceMatchesStudent,
  resolveStudentApiId,
  rollCallInitialStatus,
  sameAttendanceDay,
} from "../lib/presenceMetrics";

const STATUS_OPTIONS: AttendanceStatus[] = ["Présent", "Absent", "Retard", "Justifié"];

/** Groupe virtuel pour les élèves de l'établissement non rattachés à une classe. */
const UNASSIGNED_CLASS = "Sans classe";

const STATUS_STYLES: Record<AttendanceStatus, { active: string; idle: string }> = {
  Présent: {
    active: "bg-emerald-600 text-white border-emerald-600",
    idle: "bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50",
  },
  Absent: {
    active: "bg-red-600 text-white border-red-600",
    idle: "bg-white text-red-700 border-red-200 hover:bg-red-50",
  },
  Retard: {
    active: "bg-amber-500 text-white border-amber-500",
    idle: "bg-white text-amber-700 border-amber-200 hover:bg-amber-50",
  },
  Justifié: {
    active: "bg-blue-600 text-white border-blue-600",
    idle: "bg-white text-blue-700 border-blue-200 hover:bg-blue-50",
  },
};

type StudentRow = Record<string, unknown>;
type PresenceRow = Record<string, unknown>;

function uniqueClassNames(classes: StudentRow[], fallback: string[]) {
  const fromStudents = [...new Set(classes.map((student) => String(student.className ?? "").trim()).filter(Boolean))];
  return fromStudents.length ? fromStudents.sort() : [...new Set(fallback.filter(Boolean))].sort();
}

function buildInitialAttendance(
  students: StudentRow[],
  presences: PresenceRow[],
  todayLabel: string,
): Record<string, AttendanceStatus> {
  return Object.fromEntries(
    students.map((student) => {
      const studentId = String(student.id ?? "");
      const latest = findTodayPresenceForStudent(presences, student, todayLabel);
      return [studentId, rollCallInitialStatus(latest)];
    }),
  );
}

export function PresencesPage() {
  const { session } = useAuth();
  const { state, refresh, update } = useData();
  const { scopedUser } = useActiveSchool();
  const { showToast } = useToast();
  const scopeUser = scopedUser ?? session?.user ?? null;
  const permissionCtx = usePermissionContext();
  const { canRead } = useFeaturePermissions("Présences");
  const canUpdate = canManagePresences(permissionCtx);

  const students = scopedStudents(scopeUser, state) as StudentRow[];
  const classes = scopedClasses(scopeUser, state, students) as StudentRow[];
  const presences = (state.presences ?? []) as PresenceRow[];

  const todayLabel = formatAttendanceDate(new Date());
  const currentHour = formatAttendanceHour(new Date());

  const teacherClasses = teacherScopedClassNames(scopeUser, state);
  const isTeacherRestricted = Boolean(teacherClasses?.size);

  const classNames = useMemo(() => {
    if (teacherClasses?.size) {
      const labels = new Map<string, string>();
      students.forEach((student) => {
        const label = String(student.className ?? "").trim();
        const key = normalize(label);
        if (key && teacherClasses.has(key)) labels.set(key, label);
      });
      return [...labels.values()].sort((left, right) => left.localeCompare(right, "fr"));
    }
    return uniqueClassNames(students, classes.map((row) => String(row.name ?? "")));
  }, [teacherClasses, students, classes]);

  // Élèves de l'établissement non couverts par une carte de classe (classe vide/inconnue).
  // Non exposé aux enseignants (portée restreinte à leurs classes affectées).
  const unassignedStudents = useMemo(() => {
    if (isTeacherRestricted) return [];
    const cardKeys = new Set(classNames.map((name) => normalize(name)));
    return students.filter((student) => !cardKeys.has(normalize(student.className)));
  }, [classNames, students, isTeacherRestricted]);

  // Classes réelles proposables pour affecter un élève « Sans classe ».
  const assignableClassNames = useMemo(() => {
    const set = new Set<string>();
    classes.forEach((row) => {
      const name = String(row.name ?? "").trim();
      if (name) set.add(name);
    });
    classNames.forEach((name) => set.add(name));
    return [...set].sort((left, right) => left.localeCompare(right, "fr"));
  }, [classes, classNames]);

  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [attendanceDirty, setAttendanceDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const classStudents = useMemo(() => {
    if (!selectedClass) return [];
    if (selectedClass === UNASSIGNED_CLASS) return unassignedStudents;
    return students.filter((student) => normalize(student.className) === normalize(selectedClass));
  }, [selectedClass, students, unassignedStudents]);

  useEffect(() => {
    if (!selectedClass) return;
    setAttendanceDirty(false);
  }, [selectedClass]);

  useEffect(() => {
    if (!selectedClass || attendanceDirty) return;
    setAttendance(buildInitialAttendance(classStudents, presences, todayLabel));
  }, [selectedClass, todayLabel, classStudents, presences, attendanceDirty]);

  const liveStats = useMemo(() => {
    const rows = classStudents.map((student) => ({
      studentId: String(student.id ?? ""),
      status: attendance[String(student.id ?? "")] ?? "Présent",
      present: presenceIsAttended(attendance[String(student.id ?? "")] ?? "Présent"),
    }));
    return getPresenceStats(rows as PresenceRow[]);
  }, [attendance, classStudents]);

  const savedTodayCount = useMemo(
    () =>
      classStudents.filter((student) =>
        Boolean(findTodayPresenceForStudent(presences, student, todayLabel)),
      ).length,
    [classStudents, presences, todayLabel],
  );

  function setStudentStatus(studentId: string, status: AttendanceStatus) {
    if (!canUpdate) {
      showToast("Action refusée — vous n'êtes pas autorisé à modifier les présences.", "error");
      return;
    }
    setAttendanceDirty(true);
    setAttendance((current) => ({ ...current, [studentId]: status }));
  }

  async function assignStudentToClass(studentId: string, className: string) {
    if (!canUpdate) {
      showToast("Action refusée — vous n'êtes pas autorisé à modifier les élèves.", "error");
      return;
    }
    const target = className.trim();
    if (!studentId || !target) return;
    const nextStudents = (state.students ?? []).map((row) =>
      String((row as StudentRow).id ?? "") === studentId
        ? { ...(row as StudentRow), className: target }
        : row,
    );
    setBusy(true);
    try {
      await update({ students: nextStudents }, { partial: true });
      showToast(`Élève affecté à la classe ${target}.`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de l'affectation.", "error");
    } finally {
      setBusy(false);
    }
  }

  function markAllPresent() {
    if (!canUpdate) {
      showToast("Action refusée — vous n'êtes pas autorisé à modifier les présences.", "error");
      return;
    }
    if (!selectedClass) return;
    setAttendanceDirty(true);
    setAttendance((current) => ({
      ...current,
      ...Object.fromEntries(classStudents.map((student) => [String(student.id ?? ""), "Présent" as const])),
    }));
  }

  async function saveCall() {
    if (!canUpdate) {
      showToast("Action refusée — vous n'êtes pas autorisé à enregistrer l'appel.", "error");
      return;
    }
    if (!selectedClass) return;
    if (!classStudents.length) {
      showToast("Aucun élève dans cette classe.", "error");
      return;
    }

    const isUnassignedGroup = selectedClass === UNASSIGNED_CLASS;
    const batchClassName = isUnassignedGroup ? "" : selectedClass;

    const items = classStudents.map((student) => {
      const studentId = String(student.id ?? "");
      const studentApiId = resolveStudentApiId(student);
      const status = attendance[studentId] ?? "Présent";
      return {
        id: `PRE-${todayLabel}-${studentApiId}`,
        publicId: `PRE-${todayLabel}-${studentApiId}`,
        schoolCode: String(student.schoolCode ?? scopeUser?.schoolCode ?? session?.user?.schoolCode ?? "")
          .trim()
          .toUpperCase(),
        studentId: studentApiId,
        className: String(student.className ?? "").trim() || batchClassName,
        date: todayLabel,
        present: presenceIsAttended(status),
        status,
        reason: status === "Justifié" ? "Justifié" : undefined,
      };
    });

    setBusy(true);
    try {
      const saved = await api.post<PresenceRow[]>("/presences", {
        className: batchClassName,
        date: todayLabel,
        hour: currentHour,
        items,
      });
      if (!saved?.length) {
        throw new Error("Aucune présence enregistrée.");
      }
      await refresh();
      setAttendanceDirty(false);
      setAttendance(buildInitialAttendance(classStudents, saved ?? presences, todayLabel));
      const absentCount = items.filter((item) => item.status === "Absent").length;
      const lateCount = items.filter((item) => item.status === "Retard").length;
      const justifiedCount = items.filter((item) => item.status === "Justifié").length;
      showToast(
        `Appel enregistré — ${classStudents.length} élève(s), ${absentCount} absent(s), ${lateCount} retard(s), ${justifiedCount} justifié(s).`,
        "success",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Impossible d'enregistrer l'appel.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) {
    return (
      <Card className="p-6">
        <p className="text-sm font-semibold text-muted">Vous n&apos;avez pas l&apos;autorisation de consulter les présences.</p>
      </Card>
    );
  }

  if (!selectedClass) {
    return (
      <div className="space-y-6">
        <SectionHeader
          title="Présences"
          description={`Sélectionnez une classe pour faire l'appel — ${todayLabel} à ${currentHour}`}
        />
        <div className="grid gap-3 md:grid-cols-2">{classNames.map((className) => {
            const rows = students.filter((student) => normalize(student.className) === normalize(className));
            const savedToday = presences.filter(
              (presence) =>
                sameAttendanceDay(String(presence.date ?? ""), todayLabel) &&
                rows.some((student) => presenceMatchesStudent(presence, student)),
            ).length;

            return (
              <button
                key={className}
                type="button"
                onClick={() => setSelectedClass(className)}
                className="rounded-2xl border border-line bg-white p-5 text-left transition hover:border-brand/40 hover:shadow-sm"
              >
                <p className="text-lg font-black text-ink">{className}</p>
                <p className="mt-1 text-sm font-semibold text-muted">{rows.length} élève(s)</p>
                <p className="mt-1 text-xs text-muted">{savedToday} enregistrement(s) aujourd&apos;hui</p>
              </button>
            );
          })}
          {unassignedStudents.length ? (
            <button
              type="button"
              onClick={() => setSelectedClass(UNASSIGNED_CLASS)}
              className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-left transition hover:border-amber-400 hover:shadow-sm"
            >
              <p className="text-lg font-black text-amber-800">{UNASSIGNED_CLASS}</p>
              <p className="mt-1 text-sm font-semibold text-amber-700">
                {unassignedStudents.length} élève(s) sans classe
              </p>
              <p className="mt-1 text-xs text-amber-700">
                Élèves de l&apos;établissement non rattachés à une classe.
              </p>
            </button>
          ) : null}
        </div>
        {!classNames.length && !unassignedStudents.length ? (
          <Card className="p-6">
            <p className="text-sm text-muted">Aucune classe avec des élèves dans votre périmètre.</p>
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionHeader
            title={`Appel — ${selectedClass}`}
            description={`${todayLabel} à ${currentHour} · Cliquez sur Présent, Absent, Retard ou Justifié pour chaque élève.`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton documentTitle={`Feuille d'appel — ${selectedClass} — ${todayLabel}`} />
          <Button variant="secondary" onClick={() => setSelectedClass(null)}>
            Changer de classe
          </Button>
        </div>
      </div>

      {canUpdate ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={markAllPresent}>
            Tous présents
          </Button>
          <Button disabled={busy} onClick={() => void saveCall()}>
            {busy ? "Enregistrement…" : "Enregistrer l'appel"}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-slate-900 p-4 text-white">
          <p className="text-2xl font-black">{liveStats.rate}%</p>
          <p className="text-xs font-semibold text-slate-300">Taux de présence</p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-black text-emerald-700">{liveStats.present}</p>
          <p className="text-xs font-semibold text-muted">Présents</p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-black text-red-600">{liveStats.absent}</p>
          <p className="text-xs font-semibold text-muted">Absents</p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-black text-amber-600">{liveStats.late}</p>
          <p className="text-xs font-semibold text-muted">Retards</p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-black text-blue-600">{liveStats.justified}</p>
          <p className="text-xs font-semibold text-muted">Justifiés</p>
        </Card>
      </div>

      {savedTodayCount > 0 ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-800">
            {savedTodayCount === classStudents.length
              ? "Appel déjà enregistré aujourd'hui pour toute la classe."
              : `${savedTodayCount}/${classStudents.length} élève(s) déjà enregistré(s) aujourd'hui.`}
            {attendanceDirty ? " Modifications non sauvegardées." : ""}
          </p>
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-line">
          {classStudents.map((student) => {
            const studentId = String(student.id ?? "");
            const currentStatus = attendance[studentId] ?? "Présent";
            const name = String(student.name ?? `${student.firstName ?? ""} ${student.lastName ?? ""}`.trim());

            return (
              <li key={studentId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-black text-ink">{name || "Élève"}</p>
                  <p className="text-sm font-semibold text-muted">{String(student.matricule ?? student.publicId ?? "—")}</p>
                </div>
                {selectedClass === UNASSIGNED_CLASS && canUpdate ? (
                  <Select
                    value=""
                    disabled={busy || !assignableClassNames.length}
                    onChange={(event) => void assignStudentToClass(studentId, event.target.value)}
                    className="sm:w-56"
                    options={[
                      {
                        value: "",
                        label: assignableClassNames.length
                          ? "Affecter à une classe…"
                          : "Aucune classe disponible",
                      },
                      ...assignableClassNames.map((className) => ({
                        value: className,
                        label: className,
                      })),
                    ]}
                  />
                ) : null}
                {canUpdate ? (
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setStudentStatus(studentId, status)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                          currentStatus === status ? STATUS_STYLES[status].active : STATUS_STYLES[status].idle
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      STATUS_STYLES[currentStatus]?.active ?? "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {currentStatus}
                  </span>
                )}
                <span
                  className={`print-only rounded-full px-3 py-1 text-xs font-bold ${
                    STATUS_STYLES[currentStatus]?.active ?? "bg-slate-100 text-slate-700"
                  }`}
                >
                  {currentStatus}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}