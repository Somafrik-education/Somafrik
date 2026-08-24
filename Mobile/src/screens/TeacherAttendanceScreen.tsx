import { Alert, ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { canManagePresences, canReadRoute } from "../domain/security/permissions";
import {
  classNameMatches,
  resolveStudentApiId,
  resolveTeacherAssignmentsForSession,
  scopedStudentsForSession,
} from "../lib/establishment";
import {
  assertAttendanceClassIdentity,
  filterStudentsByClassIdentity,
  listScopedAttendanceClasses,
  presenceIntentionId,
  type AttendanceClassIdentity,
} from "../lib/attendanceClassIdentity";
import { overlayPresenceOutboxOnAttendance } from "../lib/attendanceOffline";
import { savePresences } from "../services/api";
import { clearConfirmedAttendanceDirty } from "../lib/attendanceDraft";
import {
  applyRollCallStatus,
  assertRollCallReadyToSave,
  confirmRollCallEntries,
  findTodayPresenceForStudent,
  formatAttendanceDate,
  formatAttendanceHour,
  getRollCallDraftStats,
  markRollCallSyncState,
  markRosterPresent,
  presentFlagForStatus,
  resolveClassCourseLabel,
  rollCallEntryFromPresence,
  rollCallSourceLabel,
  shouldPreserveLocalAttendanceDraft,
  type AttendanceStatus,
  type RollCallEntry,
  ROLL_CALL_COPY,
} from "../lib/attendanceTruth";
import { attendanceStatusTheme } from "../lib/attendanceStatusTheme";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { createInFlightLock, createIntentionStore } from "../lib/mutationGuard";
import { NETWORK_COPY } from "../lib/networkResilience";
import { isOfflineContext } from "../lib/connectivity";
import {
  listOutbox,
  resolveOutboxIntentionKey,
  subscribeOutbox,
  submitProtectedMutation,
} from "../lib/outbox";
import {
  ATTENDANCE_ACTIONS,
  attendanceActionForStudent,
  MIN_TOUCH_TARGET_DP,
  USABILITY_TEST_IDS,
} from "../lib/mobileUsability";

type SavedCall = {
  id: string;
  className: string;
  course: string;
  teacherId: string;
  date: string;
  hour: string;
  entries: Record<string, RollCallEntry>;
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
  const {
    studentsData,
    classesData,
    presencesData,
    teachersData,
    assignmentsData,
    loadPresences,
    applyConfirmedPresences,
    loadStudents,
    loadTeachers,
    loadClasses,
    studentsSnapshot,
    presencesSnapshot,
    resourceScopeKey,
    syncStatus,
  } = useAdminData();
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
    () => listScopedAttendanceClasses(classStudents, classesData),
    [classStudents, classesData],
  );
  const assignments = useMemo(
    () => resolveTeacherAssignmentsForSession(session, assignmentsData),
    [session, assignmentsData],
  );
  const [selectedClass, setSelectedClass] = useState<AttendanceClassIdentity | null>(null);
  const [savedCalls, setSavedCalls] = useState<SavedCall[]>([]);
  const [auditLog, setAuditLog] = useState<string[]>([]);
  const [attendance, setAttendance] = useState<Record<string, RollCallEntry>>({});

  const todayLabel = formatAttendanceDate(new Date());
  const currentHour = formatAttendanceHour(new Date());

  useFocusEffect(
    useCallback(() => {
      void loadStudents();
      void loadPresences();
      void loadTeachers();
      void loadClasses();
    }, [loadStudents, loadPresences, loadTeachers, loadClasses, resourceScopeKey]),
  );

  useEffect(() => {
    setAttendance({});
  }, [resourceScopeKey]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const entries = selectedClass ? await listOutbox().catch(() => []) : [];
      if (cancelled) return;
      setAttendance((current) => {
        const next = { ...current };
        for (const student of classStudents) {
          if (shouldPreserveLocalAttendanceDraft(next[student.id])) continue;
          const latest = findTodayPresenceForStudent(presencesData, student, todayLabel);
          next[student.id] = rollCallEntryFromPresence(latest);
        }
        if (!selectedClass) return next;
        return overlayPresenceOutboxOnAttendance({
          attendance: next,
          students: classStudents,
          entries,
          identity: selectedClass,
          todayLabel,
        });
      });
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [classStudents, presencesData, studentsSnapshot.status, presencesSnapshot.status, selectedClass, todayLabel]);

  useEffect(() => {
    if (!selectedClass) return undefined;
    const identity = selectedClass;
    return subscribeOutbox((entries) => {
      setAttendance((current) =>
        overlayPresenceOutboxOnAttendance({
          attendance: current,
          students: classStudents,
          entries,
          identity,
          todayLabel,
        }),
      );
    });
  }, [classStudents, selectedClass, todayLabel]);

  const selectedRows = selectedClass
    ? filterStudentsByClassIdentity(classStudents, selectedClass, classesData)
    : [];
  const selectedIds = selectedRows.map((student) => student.id);
  const canUpdatePresences = canManagePresences(session);
  const canOpenStudentDetail = canReadRoute(session, "StudentDetail");

  const dailyStats = useMemo(
    () => getRollCallDraftStats(selectedIds, attendance),
    [attendance, selectedIds],
  );

  const setAttendanceStatus = (studentId: string, nextStatus: AttendanceStatus) => {
    if (!canUpdatePresences) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de modifier les présences.");
      return;
    }

    setAttendance((current) => {
      const currentEntry = current[studentId];
      const nextEntry = applyRollCallStatus(currentEntry, nextStatus, session?.user.name ?? "Enseignant");
      const studentName = selectedRows.find((row) => row.id === studentId)?.name ?? studentId;

      setAuditLog((log) => [
        `${formatAttendanceDate(new Date())} ${formatAttendanceHour(new Date())} • ${studentName} : ${currentEntry?.status ?? ROLL_CALL_COPY.unset} -> ${nextStatus}`,
        ...log.slice(0, 9),
      ]);

      return { ...current, [studentId]: nextEntry };
    });
  };

  const markClassPresent = (identity: AttendanceClassIdentity) => {
    if (!canUpdatePresences) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de modifier les présences.");
      return;
    }

    const rows = filterStudentsByClassIdentity(classStudents, identity, classesData);
    setAttendance((current) => markRosterPresent(
      rows.map((student) => student.id),
      current,
      session?.user.name ?? "Enseignant",
    ));
  };

  const saveCall = async (identity: AttendanceClassIdentity) => {
    if (!saveLockRef.current.tryBegin()) return;
    if (!canUpdatePresences) {
      saveLockRef.current.end();
      Alert.alert("Accès refusé", "Votre rôle ne permet pas d'enregistrer l'appel.");
      return;
    }
    if (!assertAttendanceClassIdentity(identity)) {
      saveLockRef.current.end();
      Alert.alert("Classe incomplète", ROLL_CALL_COPY.missingClassIdentity);
      return;
    }

    const rows = filterStudentsByClassIdentity(classStudents, identity, classesData);
    if (!rows.length) {
      saveLockRef.current.end();
      Alert.alert(
        "Aucun élève chargé",
        "Impossible d'enregistrer l'appel: aucun élève n'est rattaché à cette classe dans la synchronisation."
      );
      return;
    }

    const ready = assertRollCallReadyToSave(rows.map((student) => student.id), attendance);
    if (!ready.ok) {
      saveLockRef.current.end();
      Alert.alert(ROLL_CALL_COPY.incompleteSave, ROLL_CALL_COPY.incompleteSaveBody);
      return;
    }

    const classAssignments = assignments.filter(
      (assignment) =>
        String(assignment.classId ?? "").trim() === identity.classId ||
        String(assignment.classCode ?? "").trim() === identity.classCode ||
        classNameMatches(assignment.className, identity.className),
    );
    const entries = Object.fromEntries(rows.map((student) => [student.id, attendance[student.id]]));
    const absentCount = Object.values(entries).filter((entry) => entry.status === "Absent").length;
    const lateCount = Object.values(entries).filter((entry) => entry.status === "Retard").length;
    const justifiedCount = Object.values(entries).filter((entry) => entry.status === "Justifié").length;

    const presencePayload = rows.map((student) => {
      const entry = entries[student.id];
      const status = entry.status as AttendanceStatus;
      const studentApiId = String(student.id ?? resolveStudentApiId(student));
      return {
        id: `PRE-${todayLabel}-${studentApiId}`,
        publicId: `PRE-${todayLabel}-${studentApiId}`,
        studentId: studentApiId,
        classId: identity.classId,
        classCode: identity.classCode,
        className: identity.className,
        date: todayLabel,
        present: presentFlagForStatus(status),
        status,
        reason: entry.reason,
      };
    });

    const payload = {
      classId: identity.classId,
      classCode: identity.classCode,
      className: identity.className,
      date: todayLabel,
      hour: currentHour,
      items: presencePayload,
    };
    const intentionId = presenceIntentionId(identity.classId, todayLabel);
    const knownOffline = syncStatus === "offline" || isOfflineContext();
    setSaving(true);
    setSaveHint(NETWORK_COPY.recording);
    try {
      const persistedKey = await resolveOutboxIntentionKey(intentionId);
      const key = intentionRef.current.seed(intentionId, persistedKey);
      const submitted = await submitProtectedMutation({
        domain: "presences",
        method: "POST",
        path: "/presences",
        payload,
        idempotencyKey: key,
        intentionId,
        replacePendingPayload: true,
        userId: String(session?.user.id ?? ""),
        schoolScope: String(session?.school?.code ?? session?.user.schoolCode ?? ""),
        persistOutbox: true,
        knownOffline,
        request: () => savePresences(payload, { idempotencyKey: key }),
      });
      if (submitted.outcome === "queued") {
        const studentIds = rows.map((student) => student.id);
        setAttendance((current) => markRollCallSyncState(current, studentIds, "queued"));
        setSaveHint(ROLL_CALL_COPY.queued);
        Alert.alert(ROLL_CALL_COPY.queuedAlertTitle, ROLL_CALL_COPY.queuedAlertBody);
        return;
      }
      if (submitted.outcome !== "confirmed") {
        const studentIds = rows.map((student) => student.id);
        if (submitted.persistFailed) {
          setSaveHint(ROLL_CALL_COPY.persistFailedTitle);
          Alert.alert(ROLL_CALL_COPY.persistFailedTitle, ROLL_CALL_COPY.persistFailedBody);
          return;
        }
        setAttendance((current) => markRollCallSyncState(current, studentIds, "failed"));
        setSaveHint(NETWORK_COPY.failed);
        Alert.alert(
          NETWORK_COPY.failed,
          submitted.error instanceof Error
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
          id: `CALL-${todayLabel}-${identity.classId}`,
          className: identity.className,
          course: resolveClassCourseLabel(classAssignments.map((assignment) => String(assignment.course ?? ""))),
          teacherId: session?.user.id ?? "",
          date: todayLabel,
          hour: currentHour,
          entries,
        },
        ...current,
      ]);
      applyConfirmedPresences(savedPresences);
      const refreshed = await loadPresences();
      const studentIds = rows.map((student) => student.id);
      setAttendance((current) => {
        const confirmed = confirmRollCallEntries(clearConfirmedAttendanceDirty(current, studentIds), studentIds);
        if (refreshed === false) return confirmed;
        return confirmed;
      });
      intentionRef.current.rotate(intentionId);
      setSaveHint("");
      Alert.alert(
        ROLL_CALL_COPY.syncedAlertTitle,
        `${identity.className} • ${rows.length} élève(s)\n${absentCount} absent(s), ${lateCount} retard(s), ${justifiedCount} absence(s) justifiée(s).\n${ROLL_CALL_COPY.postgres}.`
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
        .filter(
          (assignment) =>
            String(assignment.classId ?? "").trim() === selectedClass.classId ||
            String(assignment.classCode ?? "").trim() === selectedClass.classCode ||
            classNameMatches(assignment.className, selectedClass.className),
        )
        .map((assignment) => String(assignment.course ?? ""))
    : [];
  const selectedCourseLabel = resolveClassCourseLabel(selectedClassCourses);
  const selectedClassStats = selectedClass ? dailyStats : null;
  const todayCallGroups = groupAttendanceCalls(
    presencesData.filter((presence) => sameAttendanceDay(presence.date, todayLabel)),
    studentsData,
  );

  if (!selectedClass) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={contentStyle}>
        <Text style={styles.title}>Présences</Text>
        <Text style={styles.subtitle}>Sélectionnez une classe • {todayLabel} à {currentHour}</Text>
        <Text style={styles.sectionTitle}>Mes classes</Text>
        <View testID="attendance-class-list" style={isTablet ? styles.classGridTablet : undefined}>
          {assignedClasses.map((classRef) => {
            const rows = filterStudentsByClassIdentity(classStudents, classRef, classesData);
            const classCourses = assignments
              .filter(
                (assignment) =>
                  String(assignment.classId ?? "").trim() === classRef.classId ||
                  String(assignment.classCode ?? "").trim() === classRef.classCode ||
                  classNameMatches(assignment.className, classRef.className),
              )
              .map((assignment) => String(assignment.course ?? ""));
            const courseLabel = resolveClassCourseLabel(classCourses);
            const savedCount = todayCallGroups.filter((call) => classNameMatches(call.className, classRef.className)).length;
            return (
              <TouchableOpacity
                key={classRef.classId}
                testID={USABILITY_TEST_IDS.attendanceClass(classRef.className)}
                activeOpacity={0.85}
                style={[styles.selectClassCard, isTablet && styles.selectClassCardTablet]}
                onPress={() => setSelectedClass(classRef)}
                accessibilityRole="button"
                accessibilityLabel={`Ouvrir l'appel de ${classRef.className}`}
              >
                <View style={styles.selectClassIcon}>
                  <Ionicons name="grid-outline" size={24} color="#2563EB" />
                </View>
                <View style={styles.selectClassText}>
                  <Text style={styles.className}>{classRef.className}</Text>
                  <Text
                    testID={classCourses.filter(Boolean).length ? "attendance-courses" : "attendance-courses-fallback"}
                    style={styles.meta}
                  >
                    {rows.length} élève(s) • {courseLabel}
                  </Text>
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
          <Text style={styles.subtitle}>Appel de {selectedClass.className} • {todayLabel} à {currentHour}</Text>
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
            <StatPill
              testID={USABILITY_TEST_IDS.attendancePresentCount}
              label="Présents"
              value={dailyStats.present}
              color="#16A34A"
            />
            <StatPill
              testID={USABILITY_TEST_IDS.attendanceAbsentCount}
              label="Absents"
              value={dailyStats.absent}
              color="#DC2626"
            />
            <StatPill
              testID={USABILITY_TEST_IDS.attendanceLateCount}
              label="Retards"
              value={dailyStats.late}
              color="#D97706"
            />
            <StatPill
              testID={USABILITY_TEST_IDS.attendanceRate}
              label="Taux"
              value={`${dailyStats.rate}%`}
              color="#2563EB"
            />
          </View>
          <View style={styles.classCard}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.classHeader}
              onPress={() => navigation.navigate("Students", { className: selectedClass.className })}
              accessibilityRole="button"
              accessibilityLabel={`Voir les élèves de ${selectedClass.className}`}
            >
              <View>
                <Text style={styles.className}>{selectedClass.className}</Text>
                <Text
                  testID={selectedClassCourses.filter(Boolean).length ? "attendance-courses" : "attendance-courses-fallback"}
                  style={styles.meta}
                >
                  {selectedCourseLabel}
                </Text>
                <Text style={styles.meta}>
                  {selectedClassStats?.attended}/{selectedRows.length} présent(s) • {selectedClassStats?.absent} absent(s) • {selectedClassStats?.late} retard(s)
                </Text>
              </View>
              <Ionicons name="checkbox-outline" size={24} color="#16A34A" />
            </TouchableOpacity>
            {canUpdatePresences && (
              <View style={styles.classActions}>
                <TouchableOpacity
                  testID={USABILITY_TEST_IDS.attendanceMarkAllPresent}
                  style={styles.secondaryButton}
                  onPress={() => markClassPresent(selectedClass)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Marquer toute la classe ${selectedClass.className} présente`}
                  accessibilityState={{ disabled: saving }}
                >
                  <Text style={styles.secondaryText}>Tout présent</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={USABILITY_TEST_IDS.attendanceSave}
                  style={styles.saveButton}
                  onPress={() => saveCall(selectedClass)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Enregistrer l'appel de ${selectedClass.className}`}
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
        const entry = attendance[student.id] ?? rollCallEntryFromPresence(undefined);
        const status = entry.status;
        return (
          <View testID={USABILITY_TEST_IDS.attendanceStudent(student.id)} style={styles.studentRow}>
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
                <Text
                  testID={USABILITY_TEST_IDS.attendanceCurrentStatus(student.id)}
                  accessibilityLabel={`Statut ${student.name}: ${status ?? ROLL_CALL_COPY.unset}`}
                  style={styles.statusLabel}
                >
                  Statut : {status ?? ROLL_CALL_COPY.unset}
                  {rollCallSourceLabel(entry.source) ? ` • ${rollCallSourceLabel(entry.source)}` : ""}
                </Text>
                {status ? (
                  <View
                    testID={USABILITY_TEST_IDS.attendanceCurrentStatusValue(student.id, status)}
                    accessible={false}
                  />
                ) : null}
              </View>
            </TouchableOpacity>
            <View style={styles.statusActions}>
              {ATTENDANCE_ACTIONS.map((action) => {
                const selected = status === action;
                const spec = attendanceActionForStudent(student.id, action);
                const visual = attendanceStatusTheme(action, {
                  selected,
                  disabled: !canUpdatePresences || saving,
                });
                return (
                  <TouchableOpacity
                    key={action}
                    testID={spec.testID}
                    accessibilityRole="button"
                    accessibilityLabel={`${action} pour ${student.name}`}
                    accessibilityState={{ selected, disabled: !canUpdatePresences || saving }}
                    disabled={!canUpdatePresences || saving}
                    onPress={() => setAttendanceStatus(student.id, action)}
                    style={[
                      styles.statusAction,
                      {
                        backgroundColor: visual.fill,
                        borderColor: visual.borderColor,
                        borderWidth: visual.borderWidth,
                      },
                    ]}
                  >
                    {selected ? (
                      <Ionicons name={visual.icon as any} size={12} color={visual.text} />
                    ) : null}
                    <Text style={[styles.statusActionText, { color: visual.text, fontWeight: visual.fontWeight }]}>
                      {action}
                    </Text>
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
            {todayCallGroups.filter((call) => classNameMatches(call.className, selectedClass.className)).length} appel(s) enregistré(s) pour {selectedClass.className}
          </Text>
          {todayCallGroups
            .filter((call) => classNameMatches(call.className, selectedClass.className))
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

function StatPill({
  label,
  value,
  color,
  testID,
}: {
  label: string;
  value: string | number;
  color: string;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      accessibilityLabel={`${label} ${value}`}
      style={styles.statPill}
    >
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function studentPresenceKeys(student: { id?: string; matricule?: string; publicId?: string }) {
  return [student.id, student.matricule, student.publicId]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function groupAttendanceCalls(presences: any[], students: any[]) {
  const studentClassById = new Map<string, string>();
  students.forEach((student) => {
    const className = String(student.className ?? "").trim();
    studentPresenceKeys(student).forEach((key) => studentClassById.set(key, className));
  });
  const groups = new Map<string, { id: string; date: string; className: string; total: number; attended: number }>();

  presences.forEach((presence) => {
    const date = normalizeAttendanceDateKey(presence.date);
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

function sameAttendanceDay(left?: string, right?: string) {
  return normalizeAttendanceDateKey(left) === normalizeAttendanceDateKey(right);
}

function normalizeAttendanceDateKey(value?: string) {
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
    minHeight: MIN_TOUCH_TARGET_DP,
    justifyContent: "center",
  },
  secondaryText: { color: "#334155", fontWeight: "900" },
  saveButton: {
    flex: 1,
    backgroundColor: "#2563EB",
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    minHeight: MIN_TOUCH_TARGET_DP,
    justifyContent: "center",
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
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 4,
  },
  statusActionText: { fontSize: 12 },
  reportCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
  },
  reportTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  auditRow: { color: "#64748B", fontSize: 12, fontWeight: "700", marginTop: 8 },
});
