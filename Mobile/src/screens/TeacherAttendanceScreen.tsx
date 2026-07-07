import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { getPresenceStats, normalizePresenceStatus } from "../domain/metrics/schoolMetrics";
import { canManagePresences, canReadRoute } from "../domain/security/permissions";
import {
  classNameMatches,
  filterStudentsByClassName,
  resolveStudentApiId,
  resolveTeacherAssignmentsForSession,
  scopedStudentsForSession,
  teacherScopedClassLabels,
} from "../lib/establishment";
import { savePresences } from "../services/api";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";

type AttendanceStatus = "Présent" | "Absent" | "Retard" | "Justifié";

type AttendanceEntry = {
  status: AttendanceStatus;
  arrivalTime?: string;
  reason?: string;
  modifiedAt?: string;
  modifiedBy?: string;
  previousStatus?: AttendanceStatus;
};

type SavedCall = {
  id: string;
  className: string;
  course: string;
  teacherId: string;
  date: string;
  hour: string;
  entries: Record<string, AttendanceEntry>;
};

export default function TeacherAttendanceScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { isTablet, horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const contentStyle = [
    styles.content,
    {
      paddingBottom: scrollContentPaddingBottom,
      paddingHorizontal: horizontalPadding,
      maxWidth: contentMaxWidth,
      alignSelf: "center" as const,
      width: "100%",
    },
  ];
  const { session } = useAuth();
  const { studentsData, classesData, presencesData, teachersData, assignmentsData, upsertPresenceItems } =
    useAdminData();
  const scopeState = useMemo(
    () => ({ teachers: teachersData, assignments: assignmentsData, classes: classesData }),
    [teachersData, assignmentsData, classesData],
  );
  const classStudents = useMemo(
    () => scopedStudentsForSession(session, studentsData, scopeState),
    [session, studentsData, scopeState],
  );
  const assignedClasses = useMemo(
    () => teacherScopedClassLabels(session, classStudents, scopeState),
    [session, classStudents, scopeState],
  );
  const assignments = useMemo(
    () => resolveTeacherAssignmentsForSession(session, assignmentsData),
    [session, assignmentsData],
  );
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [savedCalls, setSavedCalls] = useState<SavedCall[]>([]);
  const [auditLog, setAuditLog] = useState<string[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceEntry>>(() =>
    Object.fromEntries(
      classStudents.map((student) => {
        const latest = [...presencesData]
          .reverse()
          .find((presence) => presenceMatchesStudent(presence, student));
        return [
          student.id,
          {
            status: normalizePresenceStatus(latest) as AttendanceStatus,
          },
        ];
      })
    )
  );

  const todayLabel = formatDate(new Date());
  const currentHour = formatHour(new Date());
  const todayCallGroups = groupAttendanceCalls(
    presencesData.filter((presence) => sameDay(presence.date, todayLabel)),
    studentsData
  );
  const selectedRows = selectedClass ? filterStudentsByClassName(classStudents, selectedClass) : [];
  const canUpdatePresences = canManagePresences(session);
  const canOpenStudentDetail = canReadRoute(session, "StudentDetail");

  const dailyStats = useMemo(() => {
    return getPresenceStats(
      selectedRows.map((student) => ({
        id: `CURRENT-${student.id}`,
        publicId: `CURRENT-${student.id}`,
        studentId: student.id,
        date: todayLabel,
        present: false,
        status: attendance[student.id]?.status ?? "Présent",
      }))
    );
  }, [attendance, selectedRows]);

  const cycleAttendance = (studentId: string) => {
    if (!canUpdatePresences) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de modifier les présences.");
      return;
    }

    setAttendance((current) => {
      const currentEntry = current[studentId] ?? { status: "Présent" };
      const nextStatus = getNextStatus(currentEntry.status);
      const nextEntry = buildEntry(nextStatus, currentEntry.status, session?.user.name ?? "Enseignant");

      setAuditLog((log) => [
        `${formatDate(new Date())} ${formatHour(new Date())} • ${studentId} : ${currentEntry.status} -> ${nextStatus}`,
        ...log.slice(0, 9),
      ]);

      return { ...current, [studentId]: nextEntry };
    });
  };

  const markClassPresent = (className: string) => {
    if (!canUpdatePresences) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de modifier les présences.");
      return;
    }

    const rows = filterStudentsByClassName(classStudents, className);
    setAttendance((current) => ({
      ...current,
      ...Object.fromEntries(
        rows.map((student) => [
          student.id,
          buildEntry("Présent", current[student.id]?.status, session?.user.name ?? "Enseignant"),
        ])
      ),
    }));
  };

  const saveCall = async (className: string) => {
    if (!canUpdatePresences) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas d'enregistrer l'appel.");
      return;
    }

    const rows = filterStudentsByClassName(classStudents, className);
    if (!rows.length) {
      Alert.alert(
        "Aucun élève chargé",
        "Impossible d'enregistrer l'appel: aucun élève n'est rattaché à cette classe dans la synchronisation."
      );
      return;
    }

    const classAssignments = assignments.filter((assignment) => classNameMatches(assignment.className, className));
    const entries = Object.fromEntries(
      rows.map((student) => [student.id, attendance[student.id] ?? { status: "Présent" }])
    );
    const absentCount = Object.values(entries).filter((entry) => entry.status === "Absent").length;
    const lateCount = Object.values(entries).filter((entry) => entry.status === "Retard").length;
    const justifiedCount = Object.values(entries).filter((entry) => entry.status === "Justifié").length;

    const presencePayload = rows.map((student) => {
        const entry = entries[student.id] ?? { status: "Présent" };
        const studentApiId = String(student.id ?? resolveStudentApiId(student));
        return {
          id: `PRE-${todayLabel}-${studentApiId}`,
          publicId: `PRE-${todayLabel}-${studentApiId}`,
          schoolCode: student.schoolCode,
          studentId: studentApiId,
          className: student.className ?? className,
          date: todayLabel,
          present: entry.status === "Présent" || entry.status === "Retard",
          status: entry.status,
          reason: entry.reason,
        };
      });

    try {
      const savedPresences = await savePresences({
        className,
        date: todayLabel,
        hour: currentHour,
        items: presencePayload,
      });
      if (!savedPresences.length) {
        throw new Error("Aucune présence n'a été enregistrée par le backend.");
      }

      setSavedCalls((current) => [
        {
          id: `CALL-${Date.now()}`,
          className,
          course: classAssignments[0]?.course ?? "Cours non renseigné",
          teacherId: session?.user.id ?? "",
          date: todayLabel,
          hour: currentHour,
          entries,
        },
        ...current,
      ]);
      upsertPresenceItems(savedPresences as any);

      Alert.alert(
        "Appel enregistré",
        `${className} • ${rows.length} élève(s)\n${absentCount} absent(s), ${lateCount} retard(s), ${justifiedCount} justifié(s).\nLes parents concernés seront notifiés.`
      );
    } catch (error) {
      Alert.alert(
        "Appel non enregistré",
        error instanceof Error ? error.message : "Impossible d'enregistrer l'appel dans la base."
      );
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={contentStyle}>
      <Text style={styles.title}>Présences</Text>
      <Text style={styles.subtitle}>
        {selectedClass ? `Appel de ${selectedClass}` : "Sélectionnez une classe"} • {todayLabel} à {currentHour}
      </Text>

      {!selectedClass && (
        <>
          <Text style={styles.sectionTitle}>Mes classes</Text>
          <View style={isTablet ? styles.classGridTablet : undefined}>
          {assignedClasses.map((className, index) => {
            const rows = filterStudentsByClassName(classStudents, className);
            const classCourses = assignments
              .filter((assignment) => classNameMatches(assignment.className, className))
              .map((assignment) => assignment.course);
            const savedCount = todayCallGroups.filter((call) => classNameMatches(call.className, className)).length;

            return (
              <TouchableOpacity
                key={`${className}-${index}`}
                activeOpacity={0.85}
                style={[styles.selectClassCard, isTablet && styles.selectClassCardTablet]}
                onPress={() => setSelectedClass(className)}
              >
                <View style={styles.selectClassIcon}>
                  <Ionicons name="grid-outline" size={24} color="#2563EB" />
                </View>
                <View style={styles.selectClassText}>
                  <Text style={styles.className}>{className}</Text>
                  <Text style={styles.meta}>{rows.length} élève(s) • {classCourses.join(", ") || "Cours non renseignés"}</Text>
                  <Text style={styles.meta}>{savedCount} appel(s) enregistré(s) aujourd'hui</Text>
                </View>
                <Ionicons name="chevron-forward-outline" size={20} color="#CBD5E1" />
              </TouchableOpacity>
            );
          })}
          </View>
        </>
      )}

      {selectedClass && (
        <>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.backToClasses}
            onPress={() => setSelectedClass(null)}
          >
            <Ionicons name="arrow-back" size={18} color="#0F172A" />
            <Text style={styles.backToClassesText}>Changer de classe</Text>
          </TouchableOpacity>

          <View style={styles.dashboard}>
            <StatPill label="Présents" value={dailyStats.present} color="#16A34A" />
            <StatPill label="Absents" value={dailyStats.absent} color="#DC2626" />
            <StatPill label="Retards" value={dailyStats.late} color="#D97706" />
            <StatPill label="Taux" value={`${dailyStats.rate}%`} color="#2563EB" />
          </View>

      {[selectedClass].map((className, index) => {
        const rows = filterStudentsByClassName(classStudents, className);
        const classCourses = assignments
          .filter((assignment) => classNameMatches(assignment.className, className))
          .map((assignment) => assignment.course);
        const classStats = getPresenceStats(
          rows.map((student) => ({
            id: `CURRENT-${student.id}`,
            publicId: `CURRENT-${student.id}`,
            studentId: student.id,
            date: todayLabel,
            present: false,
            status: attendance[student.id]?.status ?? "Présent",
          }))
        );

        return (
          <View key={`${className}-${index}`} style={styles.classCard}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.classHeader}
              onPress={() => navigation.navigate("Students", { className })}
            >
              <View>
                <Text style={styles.className}>{className}</Text>
                <Text style={styles.meta}>{classCourses.join(", ") || "Cours non renseignés"}</Text>
                <Text style={styles.meta}>
                  {classStats.attended}/{rows.length} présent(s) • {classStats.absent} absent(s) • {classStats.late} retard(s)
                </Text>
              </View>
              <Ionicons name="checkbox-outline" size={24} color="#16A34A" />
            </TouchableOpacity>

            {canUpdatePresences && (
              <View style={styles.classActions}>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => markClassPresent(className)}>
                  <Text style={styles.secondaryText}>Tout présent</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveButton} onPress={() => saveCall(className)}>
                  <Text style={styles.saveText}>Enregistrer l'appel</Text>
                </TouchableOpacity>
              </View>
            )}

            {rows.map((student) => {
              const entry = attendance[student.id] ?? { status: "Présent" };
              const status = entry.status;

              return (
                <TouchableOpacity
                  key={student.id}
                  activeOpacity={0.85}
                  style={styles.studentRow}
                  onPress={() => cycleAttendance(student.id)}
                  onLongPress={() => canOpenStudentDetail && navigation.navigate("StudentDetail", { studentId: student.id })}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{student.name.charAt(0)}</Text>
                  </View>
                  <View style={styles.studentContent}>
                    <Text style={styles.studentName}>{student.name}</Text>
                    <Text style={styles.meta}>
                      {student.matricule}
                      {entry.arrivalTime ? ` • arrivée ${entry.arrivalTime}` : ""}
                      {entry.reason ? ` • ${entry.reason}` : ""}
                    </Text>
                  </View>
                  <Text style={[styles.badge, getStatusStyle(status)]}>{status}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}
        </>
      )}

      {selectedClass && (
        <View style={styles.reportCard}>
          <Text style={styles.reportTitle}>Historique synchronisé</Text>
          <Text style={styles.meta}>
            {todayCallGroups.filter((call) => classNameMatches(call.className, selectedClass)).length} appel(s) enregistré(s) pour {selectedClass}
          </Text>
          {todayCallGroups
            .filter((call) => classNameMatches(call.className, selectedClass))
            .slice(0, 3)
            .map((call) => (
              <Text key={call.id} style={styles.auditRow}>
                {call.date} • {call.className} • {call.total} élève(s) • {call.attended} présent(s)
              </Text>
            ))}
          {auditLog.slice(0, 3).map((row) => (
            <Text key={row} style={styles.auditRow}>{row}</Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function StatPill({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function buildEntry(
  status: AttendanceStatus,
  previousStatus: AttendanceStatus | undefined,
  modifiedBy: string
): AttendanceEntry {
  return {
    status,
    previousStatus,
    modifiedBy,
    modifiedAt: `${formatDate(new Date())} ${formatHour(new Date())}`,
    arrivalTime: status === "Retard" ? formatHour(new Date()) : undefined,
    reason: status === "Justifié" ? "Maladie" : undefined,
  };
}

function getNextStatus(status: AttendanceStatus): AttendanceStatus {
  if (status === "Présent") return "Absent";
  if (status === "Absent") return "Retard";
  if (status === "Retard") return "Justifié";
  return "Présent";
}

function studentPresenceKeys(student: { id?: string; matricule?: string; publicId?: string }) {
  return [student.id, student.matricule, student.publicId]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function presenceMatchesStudent(presence: { studentId?: string }, student: { id?: string; matricule?: string; publicId?: string }) {
  const presenceId = String(presence.studentId ?? "").trim();
  return studentPresenceKeys(student).includes(presenceId);
}

function formatDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

function formatHour(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}


function groupAttendanceCalls(presences: any[], students: any[]) {
  const studentClassById = new Map<string, string>();
  students.forEach((student) => {
    const className = String(student.className ?? "").trim();
    studentPresenceKeys(student).forEach((key) => studentClassById.set(key, className));
  });
  const groups = new Map<string, { id: string; date: string; className: string; total: number; attended: number }>();

  presences.forEach((presence) => {
    const date = normalizeDateKey(presence.date);
    const className = presence.className ?? studentClassById.get(presence.studentId) ?? "Classe inconnue";
    const key = `${date}-${className}`;
    const current = groups.get(key) ?? { id: key, date, className, total: 0, attended: 0 };
    current.total += 1;
    if (presence.present || ["present", "présent", "retard", "late"].includes(String(presence.status ?? "").trim().toLowerCase())) {
      current.attended += 1;
    }
    groups.set(key, current);
  });

  return [...groups.values()];
}

function sameDay(left?: string, right?: string) {
  return normalizeDateKey(left) === normalizeDateKey(right);
}

function normalizeDateKey(value?: string) {
  const text = String(value ?? "").trim();
  const localMatch = text.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (localMatch) return `${localMatch[3]}-${localMatch[2]}-${localMatch[1]}`;
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  return text;
}

function getStatusStyle(status: AttendanceStatus) {
  if (status === "Présent") return styles.success;
  if (status === "Retard") return styles.warning;
  if (status === "Justifié") return styles.info;
  return styles.danger;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  title: { fontSize: 32, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 6, marginBottom: 16, color: "#64748B", fontWeight: "700" },
  sectionTitle: { color: "#0F172A", fontSize: 20, fontWeight: "900", marginBottom: 12 },
  selectClassCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  selectClassCardTablet: {
    width: "48%",
    marginHorizontal: "1%",
  },
  classGridTablet: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  selectClassIcon: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  selectClassText: { flex: 1 },
  backToClasses: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  backToClassesText: { color: "#0F172A", fontWeight: "900", marginLeft: 8 },
  dashboard: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  statPill: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
  },
  statValue: { fontSize: 24, fontWeight: "900" },
  statLabel: { color: "#64748B", fontWeight: "800", marginTop: 4 },
  classCard: { backgroundColor: "#FFFFFF", borderRadius: 24, padding: 16, marginBottom: 16 },
  classHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  className: { fontSize: 20, fontWeight: "900", color: "#0F172A" },
  meta: { marginTop: 4, color: "#64748B", fontWeight: "700" },
  classActions: { flexDirection: "row", gap: 10, marginBottom: 8 },
  secondaryButton: {
    flex: 1,
    backgroundColor: "#F1F5F9",
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
  },
  secondaryText: { color: "#334155", fontWeight: "900" },
  saveButton: {
    flex: 1,
    backgroundColor: "#2563EB",
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
  },
  saveText: { color: "#FFFFFF", fontWeight: "900" },
  studentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: { color: "#2563EB", fontWeight: "900", fontSize: 18 },
  studentContent: { flex: 1 },
  studentName: { color: "#0F172A", fontWeight: "900", fontSize: 16 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, fontWeight: "900" },
  success: { backgroundColor: "#DCFCE7", color: "#166534" },
  warning: { backgroundColor: "#FEF3C7", color: "#92400E" },
  info: { backgroundColor: "#DBEAFE", color: "#1D4ED8" },
  danger: { backgroundColor: "#FEE2E2", color: "#991B1B" },
  reportCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
  },
  reportTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  auditRow: { color: "#64748B", fontSize: 12, fontWeight: "700", marginTop: 8 },
});
