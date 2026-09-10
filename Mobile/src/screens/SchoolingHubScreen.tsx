import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { canReadRoute, canReadView } from "../domain/security/permissions";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { isMetricReady, metricLabelFromSnapshot } from "../lib/dataTruth";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  SCOLARITE_COPY,
  countStudentsWithoutClass,
  filterCanonicalClasses,
  selectCurrentAcademicYear,
} from "../lib/schoolingTruth";
import { listAcademicYears, type AcademicYearRecord } from "../services/schoolSettingsApi";
import { scopedClassesForSession } from "../lib/establishment";

type HubAction = {
  key: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

export default function SchoolingHubScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const { session } = useAuth();
  const {
    classesData,
    studentsData,
    teachersData,
    assignmentsData,
    schoolsData,
    loadClasses,
    loadStudents,
    loadTeachers,
    loadAssignments,
    classesSnapshot,
    studentsSnapshot,
    teachersSnapshot,
    assignmentsSnapshot,
    resourceScopeKey,
    establishmentStudents,
  } = useAdminData();
  const [years, setYears] = useState<AcademicYearRecord[]>([]);
  const [yearsError, setYearsError] = useState<string | null>(null);

  const schoolCode = String(session?.school?.code ?? session?.user?.schoolCode ?? "");
  const currentSchool =
    schoolsData.find((item) => item.code === schoolCode) ?? session?.school ?? schoolsData[0];
  const teacherScopeState = {
    teachers: teachersData,
    assignments: assignmentsData,
    classes: classesData,
    assignmentsSource: assignmentsSnapshot.source,
  };
  const canonicalClasses = filterCanonicalClasses(
    scopedClassesForSession(session, classesData, studentsData, teacherScopeState),
  );
  const studentCount = establishmentStudents.length;
  const classCount = canonicalClasses.length;
  const missingClassCount = countStudentsWithoutClass(establishmentStudents);
  const currentYear = selectCurrentAcademicYear(years);
  const yearLabel = yearsError || currentYear?.name || "Aucune année scolaire active";

  useFocusEffect(
    useCallback(() => {
      void Promise.all([loadClasses(), loadStudents(), loadTeachers(), loadAssignments()]).catch(() => null);
    }, [loadClasses, loadStudents, loadTeachers, loadAssignments, resourceScopeKey]),
  );

  useEffect(() => {
    let cancelled = false;
    void listAcademicYears()
      .then((rows) => {
        if (cancelled) return;
        setYears(Array.isArray(rows) ? rows : []);
        setYearsError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setYears([]);
        setYearsError(error instanceof Error ? error.message : "Impossible de charger l'année scolaire.");
      });
    return () => {
      cancelled = true;
    };
  }, [schoolCode]);

  const canOpenClasses = canReadRoute(session, "Classes");
  const canOpenStudents = canReadRoute(session, session?.role === "teacher" ? "TeacherStudents" : "Students");
  const canOpenTeachers = canReadRoute(session, "Teachers");
  const canOpenYear = canReadView(session, "SchoolYearSettings");
  const canOpenStructure = canReadView(session, "SchoolPedagogicalStructure");
  const studentsRoute = session?.role === "teacher" ? "TeacherStudents" : "Students";
  const teacherCount = teachersData.length;

  const actions: HubAction[] = [
    canOpenClasses
      ? {
          key: "classes",
          label: "Classes",
          description: "Liste et organisation des classes.",
          icon: "grid-outline",
          onPress: () => navigation.navigate("Classes"),
        }
      : null,
    canOpenStudents
      ? {
          key: "students",
          label: "Élèves",
          description: "Annuaire des élèves de l'établissement.",
          icon: "people-outline",
          onPress: () => navigation.navigate(studentsRoute, { className: "Toutes les classes" }),
        }
      : null,
    canOpenClasses
      ? {
          key: "enrollments",
          label: "Inscriptions",
          description: SCOLARITE_COPY.enrollmentsHint,
          icon: "person-add-outline",
          onPress: () => navigation.navigate("Classes"),
        }
      : null,
    canOpenStructure
      ? {
          key: "structure",
          label: "Structure pédagogique",
          description: "Niveaux, filières et groupes activés.",
          icon: "layers-outline",
          onPress: () => navigation.navigate("SchoolPedagogicalStructure"),
        }
      : null,
    canOpenYear
      ? {
          key: "year",
          label: "Année scolaire",
          description: "Année active, périodes et barème.",
          icon: "calendar-outline",
          onPress: () => navigation.navigate("SchoolYearSettings"),
        }
      : null,
  ].filter((item): item is HubAction => Boolean(item));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingTop: 52,
        paddingHorizontal: horizontalPadding,
        paddingBottom: scrollContentPaddingBottom,
        maxWidth: contentMaxWidth,
        alignSelf: "center",
        width: "100%",
      }}
      testID="schooling-hub"
    >
      <Text style={styles.title} accessibilityRole="header">
        Scolarité
      </Text>
      <Text style={styles.subtitle} testID="schooling-year">
        {[currentSchool?.name, yearLabel].filter(Boolean).join(" · ")}
      </Text>

      <Text style={styles.section}>{SCOLARITE_COPY.indicators}</Text>
      <View style={styles.kpiRow}>
        {canOpenStudents ? (
          <TouchableOpacity
            style={styles.kpiCard}
            accessibilityRole="button"
            accessibilityLabel={`${studentCount} Élèves`}
            testID="schooling-kpi-students"
            onPress={() => navigation.navigate(studentsRoute, { className: "Toutes les classes" })}
          >
            <Text style={styles.kpiValue}>
              {isMetricReady(studentsSnapshot) ? String(studentCount) : metricLabelFromSnapshot(studentsSnapshot, () => String(studentCount))}
            </Text>
            <Text style={styles.kpiLabel}>Élèves</Text>
          </TouchableOpacity>
        ) : null}
        {canOpenClasses ? (
          <TouchableOpacity
            style={styles.kpiCard}
            accessibilityRole="button"
            accessibilityLabel={`${classCount} Classes`}
            testID="schooling-kpi-classes"
            onPress={() => navigation.navigate("Classes")}
          >
            <Text style={styles.kpiValue}>
              {isMetricReady(classesSnapshot) ? String(classCount) : metricLabelFromSnapshot(classesSnapshot, () => String(classCount))}
            </Text>
            <Text style={styles.kpiLabel}>Classes</Text>
          </TouchableOpacity>
        ) : null}
        {canOpenTeachers ? (
          <TouchableOpacity
            style={styles.kpiCard}
            accessibilityRole="button"
            accessibilityLabel={`${teacherCount} Enseignants`}
            testID="schooling-kpi-teachers"
            onPress={() => navigation.navigate("Teachers")}
          >
            <Text style={styles.kpiValue}>
              {isMetricReady(teachersSnapshot)
                ? String(teacherCount)
                : metricLabelFromSnapshot(teachersSnapshot, () => String(teacherCount))}
            </Text>
            <Text style={styles.kpiLabel}>Enseignants</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {missingClassCount > 0 ? (
        <View style={styles.alert}>
          <Text style={styles.alertText}>{`${missingClassCount} élève(s) sans classe affectée`}</Text>
        </View>
      ) : null}

      <Text style={styles.section}>{SCOLARITE_COPY.actions}</Text>
      {actions.map((action) => (
        <TouchableOpacity
          key={action.key}
          style={styles.actionCard}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
        >
          <View style={styles.actionIcon}>
            <Ionicons name={action.icon} size={22} color="#2563EB" />
          </View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>{action.label}</Text>
            <Text style={styles.actionDescription}>{action.description}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  title: { fontSize: 34, fontWeight: "900", color: "#0F172A", letterSpacing: -0.8 },
  subtitle: { marginTop: 6, fontSize: 15, fontWeight: "600", color: "#64748B" },
  section: {
    marginTop: 24,
    marginBottom: 10,
    fontSize: 12,
    fontWeight: "800",
    color: "#2563EB",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  kpiCard: {
    flexGrow: 1,
    flexBasis: "42%",
    minWidth: 148,
    minHeight: 88,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16,
    justifyContent: "center",
  },
  kpiValue: { fontSize: 28, fontWeight: "900", color: "#0F172A" },
  kpiLabel: { marginTop: 4, fontSize: 14, fontWeight: "700", color: "#475569" },
  alert: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FCD34D",
    backgroundColor: "#FFFBEB",
    padding: 12,
  },
  alertText: { fontSize: 14, fontWeight: "700", color: "#92400E" },
  actionCard: {
    minHeight: MIN_TOUCH_TARGET_DP,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  actionCopy: { flex: 1, minWidth: 0 },
  actionTitle: { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  actionDescription: { marginTop: 2, fontSize: 13, fontWeight: "500", color: "#64748B" },
});
