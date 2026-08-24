import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { getPresenceStats } from "../domain/metrics/schoolMetrics";
import { canReadRoute } from "../domain/security/permissions";
import {
  classNameMatches,
  scopedClassesForSession,
  scopedStudentsForSession,
} from "../lib/establishment";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  CLASS_CARD_TEST_ID,
  CLASSES_STUDENT_COPY,
  CLASSES_STUDENT_TEST_IDS,
} from "../lib/classesStudentJourneySpec";
import {
  CLASSES_LOADING_COPY,
  CLASSES_LOADING_TEST_IDS,
  CLASSES_SKELETON_CARD_COUNT,
  classesSkeletonCardTestId,
} from "../lib/classesLoadingSpec";
import { OFFLINE_COPY, OFFLINE_TEST_IDS } from "../lib/offlineModeSpec";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { isMetricReady, metricLabelFromSnapshot } from "../lib/dataTruth";
import { filterClassesByQuery, USABILITY_TEST_IDS } from "../lib/mobileUsability";
import ClassMutationControls from "../components/ClassMutationControls";
import FormField from "../components/FormField";

export default function ClassesScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const scrollContentStyle = [
    styles.scrollContent,
    {
      paddingBottom: scrollContentPaddingBottom,
      paddingHorizontal: horizontalPadding,
      maxWidth: contentMaxWidth,
      alignSelf: "center" as const,
      width: "100%" as const,
    },
  ];
  const { session } = useAuth();
  const { classesData, studentsData, teachersData, assignmentsData, presencesSnapshot, loadClasses, loadStudents, loadPresences, loadTeachers, loadAssignments, classesSnapshot, studentsSnapshot, resourceScopeKey } = useAdminData();
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [offlineActionMessage, setOfflineActionMessage] = useState<string | null>(null);
  const isOffline = classesSnapshot.status === "offline" || studentsSnapshot.status === "offline" || presencesSnapshot.status === "offline";
  const showLoading = isLoading && !isOffline;
  const blockNetworkActions = showLoading || isOffline;
  const teacherScopeState = { teachers: teachersData, assignments: assignmentsData, classes: classesData };
  const visibleStudents = scopedStudentsForSession(session, studentsData, teacherScopeState);
  const visibleClasses = scopedClassesForSession(session, classesData, studentsData, teacherScopeState);
  const totalStudents = visibleStudents.length;
  const canOpenStudents = canReadRoute(session, session?.role === "teacher" ? "TeacherStudents" : "Students");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setOfflineActionMessage(null);
      if (!isOffline) {
        setIsLoading(true);
      }

      Promise.all([loadClasses(), loadStudents(), loadPresences(), loadTeachers(), loadAssignments()])
        .catch(() => null)
        .finally(() => {
          if (!cancelled) {
            setIsLoading(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [loadClasses, loadStudents, loadPresences, loadTeachers, loadAssignments, isOffline, resourceScopeKey]),
  );

  const handleBlockedNetworkAction = () => {
    setOfflineActionMessage(OFFLINE_COPY.actionBlocked);
  };

  const filteredClasses = filterClassesByQuery(
    visibleClasses.map((item) => ({
      ...item,
      classCode: item.classCode || item.publicId,
    })),
    searchQuery,
  );

  const listHeader = (
    <>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} testID={CLASSES_STUDENT_TEST_IDS.classesTitle} numberOfLines={2}>
            {CLASSES_STUDENT_COPY.classesTitle}
          </Text>
          <Text style={styles.subtitle} numberOfLines={3}>
            Gérez les classes et les élèves
          </Text>
        </View>
      </View>
      <ClassMutationControls onChanged={async () => { await Promise.all([loadClasses(), loadStudents()]); }} />

      <View style={blockNetworkActions ? styles.disabledControl : undefined} pointerEvents={blockNetworkActions ? "none" : "auto"}>
        <FormField
          label="Recherche"
          hideVisibleLabel
          type="search"
          leading={<Ionicons name="search-outline" size={22} color="#94A3B8" />}
          placeholder="Ex. 6e A ou CLS-6A"
          editable={!blockNetworkActions}
          value={searchQuery}
          onChangeText={setSearchQuery}
          testID={USABILITY_TEST_IDS.classesSearch}
          accessibilityLabel="Rechercher une classe par nom ou code"
        />
      </View>

      {offlineActionMessage ? (
        <View style={styles.offlineActionBanner} testID={OFFLINE_TEST_IDS.actionMessage}>
          <Text style={styles.offlineActionText}>{offlineActionMessage}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.summaryCard, blockNetworkActions && styles.disabledControl]}
        disabled={blockNetworkActions}
        testID={CLASSES_LOADING_TEST_IDS.summaryCard}
        accessibilityRole="button"
        accessibilityLabel="Voir tous les élèves"
        accessibilityState={{ disabled: isLoading }}
        onPress={() =>
          blockNetworkActions
            ? handleBlockedNetworkAction()
            : canOpenStudents && navigation.navigate("Students", { className: "Toutes les classes" })
        }
      >
        <View>
          <Text style={styles.summaryValue}>{showLoading ? "—" : metricLabelFromSnapshot(classesSnapshot, () => String(visibleClasses.length))}</Text>
          <Text style={styles.summaryLabel}>Classes actives</Text>
        </View>

        <View style={styles.summaryDivider} />

        <View>
          <Text style={styles.summaryValue}>{showLoading ? "—" : metricLabelFromSnapshot(studentsSnapshot, () => String(totalStudents))}</Text>
          <Text style={styles.summaryLabel}>Élèves inscrits</Text>
        </View>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Liste des classes</Text>

      {showLoading ? (
        <View testID={CLASSES_LOADING_TEST_IDS.loadingSkeleton}>
          <View
            style={styles.loadingRow}
            testID={CLASSES_LOADING_TEST_IDS.loadingIndicator}
            accessibilityRole="progressbar"
            accessibilityLabel={CLASSES_LOADING_COPY.loadingLabel}
          >
            <ActivityIndicator size="small" color="#2563EB" />
            <Text style={styles.loadingText}>{CLASSES_LOADING_COPY.loadingLabel}</Text>
          </View>

          {Array.from({ length: CLASSES_SKELETON_CARD_COUNT }, (_, index) => (
            <View
              key={`skeleton-${index}`}
              style={styles.skeletonCard}
              testID={classesSkeletonCardTestId(index)}
            >
              <View style={styles.skeletonIcon} />
              <View style={styles.skeletonContent}>
                <View style={styles.skeletonLineWide} />
                <View style={styles.skeletonLineMedium} />
                <View style={styles.skeletonLineShort} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.screen} testID={CLASSES_STUDENT_TEST_IDS.classesScreen}>
      <FlatList
        data={showLoading ? [] : filteredClasses}
        keyExtractor={(item) => String(item.id ?? item.name)}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={scrollContentStyle}
        testID={CLASSES_LOADING_TEST_IDS.classesList}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          showLoading ? null : searchQuery.trim() ? (
            <Text style={styles.emptySearch} testID={USABILITY_TEST_IDS.classesEmptySearch}>
              Aucune classe ne correspond à cette recherche.
            </Text>
          ) : (
            <Text style={styles.emptySearch}>Aucune classe à afficher.</Text>
          )
        }
        renderItem={({ item }) => {
          const classStudents = visibleStudents.filter((student) => classNameMatches(student.className, item.name));
          const teacher = teachersData.find((teacherItem) => teacherItem.id === item.teacherId);
          const presenceRateLabel = metricLabelFromSnapshot(
            presencesSnapshot,
            (rows) => `${getPresenceStats(rows, classStudents.map((student) => student.id)).rate}%`,
            "0%",
          );

          return (
            <View style={styles.classCard}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.classMain}
                testID={CLASS_CARD_TEST_ID(item.name)}
                accessibilityRole="button"
                accessibilityLabel={`Ouvrir la classe ${item.name}`}
                onPress={() =>
                  canOpenStudents && navigation.navigate("Students", {
                    className: item.name,
                  })
                }
              >
              <View style={styles.classIconBox}>
                <Ionicons name="grid-outline" size={26} color="#2563EB" />
              </View>

              <View style={styles.classContent}>
                <View style={styles.classTopRow}>
                  <Text style={styles.className} numberOfLines={3}>
                    {item.name}
                  </Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Présence {presenceRateLabel}</Text>
                  </View>
                </View>

                <Text style={styles.classInfo}>
                  {isMetricReady(studentsSnapshot)
                    ? `${classStudents.length} élèves`
                    : metricLabelFromSnapshot(studentsSnapshot, () => String(classStudents.length))}
                </Text>
                {item.classCode ? (
                  <Text style={styles.classInfo} numberOfLines={2}>
                    Code : {item.classCode}
                  </Text>
                ) : null}
                <Text style={styles.classTeacher}>
                  Professeur principal : {teacher?.name ?? "Non assigné"}
                </Text>
              </View>

              <Ionicons
                name="chevron-forward-outline"
                size={20}
                color="#CBD5E1"
              />
              </TouchableOpacity>
              <ClassMutationControls
                row={item}
                onChanged={async () => { await Promise.all([loadClasses(), loadStudents()]); }}
              />
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },

  scrollContent: {
    paddingTop: 52,
    paddingHorizontal: 20,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },

  headerText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },

  title: {
    fontSize: 34,
    fontWeight: "900",
    color: "#0F172A",
    letterSpacing: -0.8,
  },

  subtitle: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: "600",
    color: "#64748B",
  },
  emptySearch: {
    color: "#64748B",
    fontWeight: "700",
    paddingVertical: 24,
  },

  disabledControl: {
    opacity: 0.45,
  },

  offlineActionBanner: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },

  offlineActionText: {
    color: "#B91C1C",
    fontWeight: "700",
    fontSize: 13,
  },

  searchBox: {
    height: 56,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },

  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    fontWeight: "600",
    color: "#0F172A",
  },

  summaryCard: {
    backgroundColor: "#0F172A",
    borderRadius: 28,
    padding: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
  },

  summaryValue: {
    fontSize: 30,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  summaryLabel: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "700",
    color: "#CBD5E1",
  },

  summaryDivider: {
    width: 1,
    height: 46,
    backgroundColor: "rgba(255,255,255,0.18)",
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 14,
  },

  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    paddingHorizontal: 4,
  },

  loadingText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#2563EB",
  },

  skeletonCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 26,
    padding: 16,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
  },

  skeletonIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: "#E2E8F0",
    marginRight: 14,
  },

  skeletonContent: {
    flex: 1,
    gap: 8,
  },

  skeletonLineWide: {
    height: 14,
    borderRadius: 8,
    backgroundColor: "#E2E8F0",
    width: "72%",
  },

  skeletonLineMedium: {
    height: 12,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    width: "48%",
  },

  skeletonLineShort: {
    height: 12,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    width: "62%",
  },

  classCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 26,
    padding: 16,
    marginBottom: 14,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  classMain: {
    flexDirection: "row",
    alignItems: "center",
  },

  classIconBox: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },

  classContent: {
    flex: 1,
  },

  classTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  className: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
    fontSize: 18,
    fontWeight: "900",
    color: "#0F172A",
  },

  badge: {
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },

  badgeText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#16A34A",
  },

  classInfo: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: "800",
    color: "#2563EB",
  },

  classTeacher: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
});
