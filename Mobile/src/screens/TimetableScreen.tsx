import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getTeacherById, timetable, type CourseScheduleSlot } from "../data/catalog";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { classNameMatches, teacherScopedClassNames } from "../lib/establishment";
import { normalize } from "../lib/format";
import {
  detectConflicts,
  groupSlotsByDay,
  isExamSlot,
  scopeSlots,
  slotTimeRange,
} from "../lib/coursePlanning";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

const days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

export default function TimetableScreen() {
  const stackPaddingBottom = useStackScreenBottomPadding();
  const contentStyle = [styles.content, { paddingBottom: stackPaddingBottom }];
  const { session, selectedStudentId } = useAuth();
  const { studentsData, teachersData, assignmentsData, classesData, courseSchedulesData, activeSchoolCode } =
    useAdminData();
  const teacherScopeState = { teachers: teachersData, assignments: assignmentsData, classes: classesData };

  const schoolCode = session?.user?.schoolCode || session?.school?.code || activeSchoolCode || "";

  // Créneaux réels synchronisés depuis le back-office (jour/heure), scopés au rôle.
  const scopedSlots = useMemo<CourseScheduleSlot[]>(() => {
    let slots = scopeSlots(courseSchedulesData, { schoolCode });

    if (session?.role === "teacher") {
      const scopedClasses = teacherScopedClassNames(session, teacherScopeState);
      const teacherId = String(session.user?.id ?? "");
      slots = slots.filter((slot) => {
        if (teacherId && String(slot.teacherId ?? "") === teacherId) return true;
        if (scopedClasses) return scopedClasses.has(normalize(slot.className));
        return true;
      });
    } else if ((session?.role === "parent_student" || session?.role === "student") && selectedStudentId) {
      const student = studentsData.find((item) => item.id === selectedStudentId);
      slots = slots.filter((slot) => classNameMatches(slot.className, student?.className));
    }

    return slots;
  }, [courseSchedulesData, schoolCode, session, selectedStudentId, studentsData, teachersData, assignmentsData, classesData]);

  const dayGroups = useMemo(() => groupSlotsByDay(scopedSlots), [scopedSlots]);
  const conflicts = useMemo(() => detectConflicts(scopedSlots), [scopedSlots]);
  const hasRealPlanning = scopedSlots.length > 0;

  // Repli sur les données de démonstration si aucun créneau réel n'est disponible.
  const demoRows = useMemo(() => {
    if (hasRealPlanning) return [];
    if (session?.role === "teacher") {
      const scopedClasses = teacherScopedClassNames(session, teacherScopeState);
      if (!scopedClasses) return timetable;
      return timetable.filter((item) => scopedClasses.has(normalize(item.className)));
    }
    if ((session?.role === "parent_student" || session?.role === "student") && selectedStudentId) {
      const student = studentsData.find((item) => item.id === selectedStudentId);
      return timetable.filter((item) => classNameMatches(item.className, student?.className));
    }
    return timetable;
  }, [hasRealPlanning, assignmentsData, classesData, selectedStudentId, session, studentsData, teachersData]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={contentStyle}>
      <Text style={styles.title}>Emploi du temps</Text>
      <Text style={styles.subtitle}>
        {hasRealPlanning ? `${scopedSlots.length} créneau(x) planifié(s)` : `${demoRows.length} créneau(x) planifié(s)`}
      </Text>

      {conflicts.length > 0 && (
        <View style={styles.conflictBanner}>
          <View style={styles.conflictHeader}>
            <Ionicons name="warning-outline" size={18} color="#B45309" />
            <Text style={styles.conflictTitle}>
              {conflicts.length} conflit(s) d'horaire détecté(s)
            </Text>
          </View>
          {conflicts.slice(0, 4).map((conflict, index) => (
            <Text key={`${conflict.slotId}-${index}`} style={styles.conflictText}>
              • {conflict.message}
            </Text>
          ))}
          {conflicts.length > 4 && (
            <Text style={styles.conflictText}>… et {conflicts.length - 4} autre(s).</Text>
          )}
        </View>
      )}

      {hasRealPlanning
        ? dayGroups.map((group) => (
            <View key={group.weekday} style={styles.dayBlock}>
              <Text style={styles.dayTitle}>{group.label}</Text>
              {group.slots.map((slot) => {
                const exam = isExamSlot(slot);
                return (
                  <View key={slot.id} style={[styles.card, exam && styles.examCard]}>
                    <View style={[styles.timeBox, exam && styles.examTimeBox]}>
                      <Text style={[styles.time, exam && styles.examTime]}>{slotTimeRange(slot).split("–")[0]}</Text>
                      <Text style={styles.timeMuted}>{slotTimeRange(slot).split("–")[1]}</Text>
                    </View>
                    <View style={styles.cardBody}>
                      <Text style={styles.course}>
                        {exam ? `${slot.examType || "Examen"} · ${slot.examName || slot.subject}` : slot.subject}
                      </Text>
                      <Text style={styles.meta}>
                        {slot.className}
                        {slot.room ? ` • ${slot.room}` : ""}
                      </Text>
                      <Text style={styles.meta}>{slot.teacherName || "Enseignant à affecter"}</Text>
                    </View>
                    <Ionicons
                      name={exam ? "clipboard-outline" : "calendar-outline"}
                      size={22}
                      color={exam ? "#C2410C" : "#2563EB"}
                    />
                  </View>
                );
              })}
            </View>
          ))
        : days.map((day) => {
            const dayRows = demoRows.filter((item) => item.day === day);
            if (!dayRows.length) return null;
            return (
              <View key={day} style={styles.dayBlock}>
                <Text style={styles.dayTitle}>{day}</Text>
                {dayRows.map((item) => {
                  const teacher = getTeacherById(item.teacherId);
                  return (
                    <View key={item.id} style={styles.card}>
                      <View style={styles.timeBox}>
                        <Text style={styles.time}>{item.startTime}</Text>
                        <Text style={styles.timeMuted}>{item.endTime}</Text>
                      </View>
                      <View style={styles.cardBody}>
                        <Text style={styles.course}>{item.course}</Text>
                        <Text style={styles.meta}>{item.className} • {item.room}</Text>
                        <Text style={styles.meta}>{teacher?.name ?? "Enseignant à affecter"}</Text>
                      </View>
                      <Ionicons name="calendar-outline" size={22} color="#2563EB" />
                    </View>
                  );
                })}
              </View>
            );
          })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  title: { color: "#0F172A", fontSize: 28, fontWeight: "900" },
  subtitle: { color: "#64748B", fontWeight: "800", marginTop: 4, marginBottom: 18 },
  conflictBanner: {
    backgroundColor: "#FEF3C7",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#FCD34D",
    padding: 14,
    marginBottom: 18,
  },
  conflictHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  conflictTitle: { color: "#B45309", fontWeight: "900", fontSize: 14, marginLeft: 8 },
  conflictText: { color: "#92400E", fontSize: 12, fontWeight: "700", marginTop: 3 },
  dayBlock: { marginBottom: 18 },
  dayTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginBottom: 10 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  examCard: { borderColor: "#FDBA74", backgroundColor: "#FFF7ED" },
  timeBox: {
    width: 72,
    borderRadius: 14,
    backgroundColor: "#EFF6FF",
    padding: 10,
    marginRight: 12,
  },
  examTimeBox: { backgroundColor: "#FFEDD5" },
  time: { color: "#2563EB", fontWeight: "900", textAlign: "center" },
  examTime: { color: "#C2410C" },
  timeMuted: { color: "#64748B", fontSize: 12, fontWeight: "800", textAlign: "center", marginTop: 3 },
  cardBody: { flex: 1, minWidth: 0 },
  course: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  meta: { color: "#64748B", fontSize: 12, fontWeight: "700", marginTop: 4 },
});
