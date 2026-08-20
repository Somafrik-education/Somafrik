import { Alert, ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { getPresenceStats, rollCallInitialStatus } from "../domain/metrics/schoolMetrics";
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
import { createInFlightLock, createIntentionStore } from "../lib/mutationGuard";
import { NETWORK_COPY } from "../lib/networkResilience";
import { submitProtectedMutation } from "../lib/outbox";
import {
  ATTENDANCE_ACTIONS,
  attendanceActionForStudent,
  MIN_TOUCH_TARGET_DP,
} from "../lib/mobileUsability";

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
      width: "100%" as const,
    },
  ];
  const { session } = useAuth();
  const { studentsData, classesData, presencesData, teachersData, assignmentsData, loadPresences, loadStudents, loadTeachers, loadClasses, studentsSnapshot, presencesSnapshot } =
    useAdminData();
  const saveLockRef = useRef(createInFlightLock());
  const intentionRef = useRef(createIntentionStore());
  const [saving, setSaving] = useState(false);
  const [saveHint, setSaveHint] = useState("");
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
  const [attendance, setAttendance] = useState<Record<string, AttendanceEntry>>({});

  useFocusEffect(
    useCallback(() => {
      void loadStudents();
      void loadPresences();
      void loadTeachers();
      void loadClasses();
    }, [loadStudents, loadPresences, loadTeachers, loadClasses]),
  );

  useEffect(() => {
    setAttendance((current) => {
      const next = { ...current };
      for (const student of classStudents) {
        if (next[student.id]?.modifiedAt) continue;
        const latest = [...presencesData]
          .reverse()
          .find((presence) => presenceMatchesStudent(presence, student));
        next[student.id] = {
          status: rollCallInitialStatus(latest) as AttendanceStatus,
        };
      }
      return next;
    });
  }, [classStudents, presencesData, studentsSnapshot.status, presencesSnapshot.status]);

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

  const setAttendanceStatus = (studentId: string, nextStatus: AttendanceStatus) => {
    if (!canUpdatePresences) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de modifier les présences.");
      return;
    }

    setAttendance((current) => {
      const currentEntry = current[studentId] ?? { status: "Présent" };
      const nextEntry = buildEntry(nextStatus, currentEntry.status, session?.user.name ?? "Enseignant");
      const studentName = selectedRows.find((row) => row.id === studentId)?.name ?? studentId;

      setAuditLog((log) => [
        `${formatDate(new Date())} ${formatHour(new Date())} • ${studentName} : ${currentEntry.status} -> ${nextStatus}`,
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
    if (!saveLockRef.current.tryBegin()) return;
    if (!canUpdatePresences) {
      saveLockRef.current.end();
      Alert.alert("Accès refusé", "Votre rôle ne permet pas d'enregistrer l'appel.");
      return;
    }

    const rows = filterStudentsByClassName(classStudents, className);
    if (!rows.length) {
      saveLockRef.current.end();
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

    const payload = {
      className,
      date: todayLabel,
      hour: currentHour,
      items: presencePayload,
    };
    const intentionId = `presence:${className}:${todayLabel}`;
    const idempotencyKey = intentionRef.current.getOrCreate(intentionId);
    setSaving(true);
    setSaveHint(NETWORK_COPY.recording);
    try {
      const submitted = await submitProtectedMutation({
        domain: "presences",
        method: "POST",
        path: "/presences",
        payload,
        idempotencyKey,
        userId: String(session?.user.id ?? ""),
        schoolScope: String(session?.school?.code ?? session?.user.schoolCode ?? ""),
        persistOutbox: true,
        request: () => savePresences(payload, { idempotencyKey }),
      });
      if (submitted.outcome !== "confirmed") {
        setSaveHint(submitted.outcome === "queued" ? NETWORK_COPY.queued : NETWORK_COPY.failed);
        Alert.alert(
          submitted.outcome === "queued" ? NETWORK_COPY.queued : NETWORK_COPY.failed,
          submitted.outcome === "queued"
            ? "L'appel est conservé en file d'attente avec la même intention. Aucune confirmation locale."
            : submitted.error instanceof Error
              ? submitted.error.message
              : "Impossible d'enregistrer l'appel dans la base.",
        );
        return;
      }
      const savedPresences = submitted.result;
      if (!Array.isArray(savedPresences) || !savedPresences.length) {
        throw new Error("Aucune présence n'a été enregistrée par le backend.");
      }

      setSavedCalls((current) => [
        {
          id: `CALL-${todayLabel}-${className}`,
          className,
          course: classAssignments[0]?.course ?? "Cours non renseigné",
          teacherId: session?.user.id ?? "",
          date: todayLabel,
          hour: currentHour,
          entries,
        },
        ...current,
      ]);
      await loadPresences();
      intentionRef.current.rotate(intentionId);
      setSaveHint("");
      Alert.alert(
        "Appel enregistré",
        `${className} • ${rows.length} élève(s)\n${absentCount} absent(s), ${lateCount} retard(s), ${justifiedCount} absence(s) justifiée(s).\nAppel enregistré.`
      );
    } catch (error) {
      setSaveHint(NETWORK_COPY.failed);
      Alert.alert(
        NETWORK_COPY.failed,
        error instanceof Error ? error.message : "Impossible d'enregistrer l'appel dans la base."
      );
    } finally {
      setSaving(false);
      saveLockRef.current.end();
    }
  };

  const selectedClassCourses = selectedClass
    ? assignments
        .filter((assignment) => classNameMatches(assignment.className, selectedClass))
        .map((assignment) => assignment.course)
    : [];
  const selectedClassStats = selectedClass
    ? getPresenceStats(
        selectedRows.map((student) => ({
          id: `CURRENT-${student.id}`,
          publicId: `CURRENT-${student.id}`,
          studentId: student.id,
          date: todayLabel,
          present: false,
          status: attendance[student.id]?.status ?? "Présent",
        })),
      )
    : null;

  if (!selectedClass) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={contentStyle}>
        <Text style={styles.title}>Présences</Text>
        <Text style={styles.subtitle}>Sélectionnez une classe • {todayLabel} à {currentHour}</Text>
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
                accessibilityRole="button"
                accessibilityLabel={`Ouvrir l'appel de ${className}`}
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
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={contentStyle}
      data={selectedRows}
      keyExtractor={(student) => student.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          <Text style={styles.title}>Présences</Text>
          <Text style={styles.subtitle}>Appel de {selectedClass} • {todayLabel} à {currentHour}</Text>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.backToClasses}
            onPress={() => setSelectedClass(null)}
            accessibilityRole="button"
            accessibilityLabel="Changer de classe"
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
          <View style={styles.classCard}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.classHeader}
              onPress={() => navigation.navigate("Students", { className: selectedClass })}
              accessibilityRole="button"
              accessibilityLabel={`Voir les élèves de ${selectedClass}`}
            >
              <View>
                <Text style={styles.className}>{selectedClass}</Text>
                <Text style={styles.meta}>{selectedClassCourses.join(", ") || "Cours non renseignés"}</Text>
                <Text style={styles.meta}>
                  {selectedClassStats?.attended}/{selectedRows.length} présent(s) • {selectedClassStats?.absent} absent(s) • {selectedClassStats?.late} retard(s)
                </Text>
              </View>
              <Ionicons name="checkbox-outline" size={24} color="#16A34A" />
            </TouchableOpacity>
            {canUpdatePresences && (
              <View style={styles.classActions}>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => markClassPresent(selectedClass)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Marquer toute la classe ${selectedClass} présente`}
                  accessibilityState={{ disabled: saving }}
                >
                  <Text style={styles.secondaryText}>Tout présent</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveButton}
                  onPress={() => saveCall(selectedClass)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Enregistrer l'appel de ${selectedClass}`}
                  accessibilityState={{ busy: saving, disabled: saving }}
                >
                  {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Enregistrer l'appel</Text>}
                </TouchableOpacity>
              </View>
            )}
            {saveHint ? <Text style={styles.meta}>{saveHint}</Text> : null}
          </View>
        </>
      }
      renderItem={({ item: student }) => {
        const entry = attendance[student.id] ?? { status: "Présent" as AttendanceStatus };
        const status = entry.status;
        return (
          <View style={styles.studentRow}>
            <TouchableOpacity
              style={styles.studentIdentity}
              onLongPress={() => canOpenStudentDetail && navigation.navigate("StudentDetail", { studentId: student.id })}
              accessibilityRole="button"
              accessibilityLabel={`Élève ${student.name}`}
              accessibilityHint="Appui long pour ouvrir la fiche"
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{student.name.charAt(0)}</Text>
              </View>
              <View style={styles.studentContent}>
                <Text style={styles.studentName} numberOfLines={3}>{student.name}</Text>
                <Text style={styles.meta}>
                  {student.matricule}
                  {entry.arrivalTime ? ` • arrivée ${entry.arrivalTime}` : ""}
                  {entry.reason ? ` • ${entry.reason}` : ""}
                </Text>
                <Text style={styles.statusLabel}>Statut : {status}</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.statusActions}>
              {ATTENDANCE_ACTIONS.map((action) => {
                const selected = status === action;
                const spec = attendanceActionForStudent(student.id, action);
                return (
                  <TouchableOpacity
                    key={action}
                    testID={spec.testID}
                    accessibilityRole="button"
                    accessibilityLabel={`${action} pour ${student.name}`}
                    accessibilityState={{ selected, disabled: !canUpdatePresences || saving }}
                    disabled={!canUpdatePresences || saving}
                    onPress={() => setAttendanceStatus(student.id, action)}
                    style={[styles.statusAction, selected && styles.statusActionActive]}
                  >
                    <Text style={[styles.statusActionText, selected && styles.statusActionTextActive]}>{action}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      }}
      ListFooterComponent={
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
      }
    />
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
    reason: status === "Justifié" ? "Absence justifiée" : undefined,
  };
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
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  studentIdentity: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: MIN_TOUCH_TARGET_DP,
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
  statusLabel: { color: "#334155", fontWeight: "800", marginTop: 4 },
  statusActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusAction: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  statusActionActive: { backgroundColor: "#0F172A" },
  statusActionText: { color: "#334155", fontWeight: "800", fontSize: 12 },
  statusActionTextActive: { color: "#FFFFFF" },
  reportCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
  },
  reportTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  auditRow: { color: "#64748B", fontSize: 12, fontWeight: "700", marginTop: 8 },
});
