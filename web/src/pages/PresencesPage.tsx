import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { api } from "../api/client";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { useToast } from "../components/ui/Toast";
import { useFeaturePermissions, usePermissionContext } from "../lib/usePermissionContext";
import { canManagePresences } from "../lib/permissions";
import { resolveTeacherRecordForUser } from "../lib/establishment";
import { classStudentsApi, type ClassStudent } from "../lib/classStudentsApi";
import {
  buildPresenceClassCards,
  findPresenceClassCard,
  type PresenceClassCard,
} from "../lib/presenceRoster";
import {
  ATTENDANCE_PEDAGOGICAL_TEACHER_COPY,
  attachAttendanceTeacherToPayload,
  explicitAttendanceTeacherId,
  resolvePedagogicalAttendanceTeacher,
} from "../lib/attendanceAuthor";
import { Field, Select } from "../components/ui/Field";
import {
  type AttendanceStatus,
  findTodayPresenceForStudent,
  formatAttendanceDate,
  formatAttendanceHour,
  getPresenceStats,
  presenceIsAttended,
  resolveStudentApiId,
  rollCallInitialStatus,
  sameAttendanceDay,
} from "../lib/presenceMetrics";

const STATUS_OPTIONS: AttendanceStatus[] = ["Présent", "Absent", "Retard", "Justifié"];

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
  const { state, refresh } = useData();
  const { scopedUser } = useActiveSchool();
  const { showToast } = useToast();
  const scopeUser = scopedUser ?? session?.user ?? null;
  const permissionCtx = usePermissionContext();
  const { canRead } = useFeaturePermissions("Présences");
  const canUpdate = canManagePresences(permissionCtx);

  const presences = (state.presences ?? []) as PresenceRow[];
  const todayLabel = formatAttendanceDate(new Date());
  const currentHour = formatAttendanceHour(new Date());

  const classCards = useMemo(() => {
    const teacher = resolveTeacherRecordForUser(scopeUser, state) as Record<string, unknown> | null;
    return buildPresenceClassCards({
      role: scopeUser?.role,
      classes: (state.classes ?? []) as Record<string, unknown>[],
      assignments: (state.assignments ?? []) as Record<string, unknown>[],
      teacherRecord: teacher,
      currentUser: (scopeUser ?? null) as Record<string, unknown> | null,
    });
  }, [scopeUser, state]);

  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedClassCode, setSelectedClassCode] = useState<string | null>(null);
  const [roster, setRoster] = useState<ClassStudent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [attendanceDirty, setAttendanceDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");

  const selectedCard = useMemo(
    () => findPresenceClassCard(classCards, { classId: selectedClassId, classCode: selectedClassCode }),
    [classCards, selectedClassId, selectedClassCode],
  );

  const attendanceTeacher = useMemo(
    () =>
      resolvePedagogicalAttendanceTeacher({
        role: scopeUser?.role,
        assignments: (state.assignments ?? []) as Record<string, unknown>[],
        identity: selectedCard,
        teachers: (state.teachers ?? []) as Record<string, unknown>[],
        selectedTeacherId,
      }),
    [scopeUser?.role, state.assignments, state.teachers, selectedCard, selectedTeacherId],
  );

  useEffect(() => {
    if (!selectedCard) {
      setRoster([]);
      setRosterError(null);
      setRosterLoading(false);
      return;
    }

    let cancelled = false;
    setRosterLoading(true);
    setRosterError(null);
    setAttendanceDirty(false);
    void classStudentsApi
      .list(selectedCard.classCode)
      .then((rows) => {
        if (cancelled) return;
        setRoster(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (cancelled) return;
        setRoster([]);
        setRosterError(error instanceof Error ? error.message : "Impossible de charger le roster.");
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCard?.classId, selectedCard?.classCode]);

  const classStudents = roster as unknown as StudentRow[];

  useEffect(() => {
    if (!selectedCard || attendanceDirty || rosterLoading) return;
    setAttendance(buildInitialAttendance(classStudents, presences, todayLabel));
  }, [selectedCard, todayLabel, classStudents, presences, attendanceDirty, rosterLoading]);

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

  function selectClass(card: PresenceClassCard) {
    setSelectedClassId(card.classId);
    setSelectedClassCode(card.classCode);
    setSelectedTeacherId("");
  }

  function clearSelectedClass() {
    setSelectedClassId(null);
    setSelectedClassCode(null);
    setSelectedTeacherId("");
    setRoster([]);
    setRosterError(null);
  }

  function setStudentStatus(studentId: string, status: AttendanceStatus) {
    if (!canUpdate) {
      showToast("Action refusée — vous n'êtes pas autorisé à modifier les présences.", "error");
      return;
    }
    setAttendanceDirty(true);
    setAttendance((current) => ({ ...current, [studentId]: status }));
  }

  function markAllPresent() {
    if (!canUpdate) {
      showToast("Action refusée — vous n'êtes pas autorisé à modifier les présences.", "error");
      return;
    }
    if (!selectedCard) return;
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
    if (!selectedCard) return;
    if (!classStudents.length) {
      showToast("Aucun élève dans cette classe.", "error");
      return;
    }
    if (attendanceTeacher.status === "blocked") {
      showToast(attendanceTeacher.message, "error");
      return;
    }
    if (attendanceTeacher.status === "need_selection") {
      showToast(ATTENDANCE_PEDAGOGICAL_TEACHER_COPY.needSelection, "error");
      return;
    }

    const items = classStudents.map((student) => {
      const studentId = String(student.id ?? "");
      const studentApiId = resolveStudentApiId(student);
      const status = attendance[studentId] ?? "Présent";
      return {
        id: `PRE-${todayLabel}-${studentApiId}`,
        publicId: `PRE-${todayLabel}-${studentApiId}`,
        studentId: studentApiId,
        classId: selectedCard.classId,
        classCode: selectedCard.classCode,
        date: todayLabel,
        present: presenceIsAttended(status),
        status,
        reason: status === "Justifié" ? "Absence justifiée" : undefined,
      };
    });
    const payload = attachAttendanceTeacherToPayload(
      {
        classId: selectedCard.classId,
        classCode: selectedCard.classCode,
        date: todayLabel,
        hour: currentHour,
        items,
      },
      explicitAttendanceTeacherId(attendanceTeacher),
    );

    setBusy(true);
    try {
      const saved = await api.post<PresenceRow[]>("/presences", payload);
      if (!saved?.length) {
        throw new Error("Aucune présence enregistrée.");
      }
      await refresh(["presences"]);
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

  if (!selectedCard) {
    return (
      <div className="space-y-6">
        <SectionHeader
          title="Présences"
          description={`Sélectionnez une classe pour faire l'appel — ${todayLabel} à ${currentHour}`}
        />
        <div className="grid gap-3 md:grid-cols-2">
          {classCards.map((card) => {
            const savedToday = presences.filter(
              (presence) =>
                sameAttendanceDay(String(presence.date ?? ""), todayLabel) && asClassMatch(presence, card),
            ).length;

            return (
              <button
                key={card.classId}
                type="button"
                onClick={() => selectClass(card)}
                className="rounded-2xl border border-line bg-white p-5 text-left transition hover:border-brand/40 hover:shadow-sm"
              >
                <p className="text-lg font-black text-ink">{card.className}</p>
                <p className="mt-1 text-sm font-semibold text-muted">{card.studentCount} élève(s)</p>
                <p className="mt-1 text-xs text-muted">{savedToday} enregistrement(s) aujourd&apos;hui</p>
              </button>
            );
          })}
        </div>
        {!classCards.length ? (
          <Card className="p-6">
            <p className="text-sm text-muted">Aucune classe dans votre périmètre.</p>
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
            title={`Appel — ${selectedCard.className}`}
            description={`${todayLabel} · Appel du jour (journée entière) · Présent, Absent, Retard ou Justifié (absence justifiée).`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton documentTitle={`Feuille d'appel — ${selectedCard.className} — ${todayLabel}`} />
          <Button variant="secondary" onClick={clearSelectedClass}>
            Changer de classe
          </Button>
        </div>
      </div>

      {canUpdate ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={markAllPresent} disabled={rosterLoading || !classStudents.length}>
            Tous présents
          </Button>
          <Button
            disabled={
              busy ||
              rosterLoading ||
              attendanceTeacher.status === "blocked" ||
              attendanceTeacher.status === "need_selection"
            }
            onClick={() => void saveCall()}
          >
            {busy ? "Enregistrement…" : "Enregistrer l'appel"}
          </Button>
        </div>
      ) : null}

      {canUpdate && attendanceTeacher.status === "need_selection" ? (
        <Field label="Enseignant pédagogique" htmlFor="attendance-teacher" required>
          <Select
            id="attendance-teacher"
            value={selectedTeacherId}
            onChange={(event) => setSelectedTeacherId(event.target.value)}
            options={[
              { value: "", label: "Choisir l'enseignant pédagogique" },
              ...attendanceTeacher.options.map((option) => ({
                value: option.teacherId,
                label: option.label,
              })),
            ]}
          />
        </Field>
      ) : null}

      {canUpdate && attendanceTeacher.status === "blocked" ? (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">{attendanceTeacher.message}</p>
        </Card>
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

      {rosterError ? (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-800">{rosterError}</p>
        </Card>
      ) : null}

      {rosterLoading ? (
        <Card className="p-4">
          <p className="text-sm font-semibold text-muted">Chargement du roster…</p>
        </Card>
      ) : null}

      {savedTodayCount > 0 && !rosterLoading ? (
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

function asClassMatch(presence: PresenceRow, card: PresenceClassCard) {
  const presenceClassId = String(presence.classId ?? presence.class_id ?? "").trim();
  const presenceClassCode = String(presence.classCode ?? presence.class_code ?? "").trim();
  if (presenceClassId && presenceClassId === card.classId) return true;
  if (presenceClassCode && presenceClassCode === card.classCode) return true;
  return false;
}
