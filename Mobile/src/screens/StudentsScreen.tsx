import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SectionList,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { getPresenceStats, normalizePresenceStatus } from "../domain/metrics/schoolMetrics";
import { canReadRoute } from "../domain/security/permissions";
import {
  filterStudentsByClassName,
} from "../lib/establishment";
import StudentsScopeAlert from "../components/StudentsScopeAlert";
import ExpandableEntityCard from "../components/ExpandableEntityCard";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  CLASSES_STUDENT_COPY,
  CLASSES_STUDENT_TEST_IDS,
  STUDENT_OPEN_FICHE_TEST_ID,
  STUDENT_ROW_TEST_ID,
} from "../lib/classesStudentJourneySpec";
import { isMetricReady, metricLabelFromSnapshot } from "../lib/dataTruth";
import { formatPaymentRateKpi } from "../lib/paymentRateKpi";
import { shouldBlockUnsupportedMutations } from "../offline/l1/readModel";
import { OFFLINE_COPY } from "../lib/offlineModeSpec";
import { studentDisplayName } from "../lib/studentDisplayName";
import { displayStatusName } from "../lib/format";
import { SCOLARITE_COPY } from "../lib/schoolingTruth";
import { nextExclusiveExpandedKey } from "../lib/expandableEntity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import StudentMutationControls from "../components/StudentMutationControls";
import FormField from "../components/FormField";
import type { PresenceItem, Student } from "../data/catalog";

type StudentRow = Student;

type StudentSection = {
  title: string;
  data: StudentRow[];
};

export default function StudentsScreen({ route, navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const scrollContentStyle = [styles.scrollContent, { paddingBottom: scrollContentPaddingBottom }];
  const { session, permissionsBootstrap } = useAuth();
  const { presencesData, classesData, loadStudents, loadPresences, loadPayments, loadStudentFees, loadTeachers, loadClasses, loadAssignments, studentsSnapshot, presencesSnapshot, studentFeesSnapshot, resourceScopeKey, establishmentStudents, studentsProjection } = useAdminData();
  const className = route?.params?.className ?? "Toutes les classes";
  const [query, setQuery] = useState("");
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const mutationsBlocked = shouldBlockUnsupportedMutations({
    source: studentsSnapshot.source,
    permissionsBootstrap,
  });

  useFocusEffect(
    useCallback(() => {
      void loadStudents();
      void loadPresences();
      void loadPayments();
      void loadStudentFees();
      void loadTeachers();
      void loadClasses();
      void loadAssignments();
    }, [loadStudents, loadPresences, loadPayments, loadStudentFees, loadTeachers, loadClasses, loadAssignments, resourceScopeKey]),
  );

  const availableStudents = establishmentStudents;

  const classStudents = useMemo(
    () =>
      className === "Toutes les classes"
        ? availableStudents
        : filterStudentsByClassName(availableStudents, className),
    [availableStudents, className],
  );

  const filteredStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return classStudents;

    return classStudents.filter(
      (student) =>
        student.name.toLowerCase().includes(normalizedQuery) ||
        student.matricule.toLowerCase().includes(normalizedQuery),
    );
  }, [classStudents, query]);

  const presenceByStudentId = useMemo(() => {
    const map = new Map<string, PresenceItem>();
    for (const presence of presencesData) {
      const existing = map.get(presence.studentId);
      if (!existing || String(presence.date) >= String(existing.date)) {
        map.set(presence.studentId, presence);
      }
    }
    return map;
  }, [presencesData]);

  const classStudentIds = useMemo(() => classStudents.map((student) => student.id), [classStudents]);
  const presenceStats = useMemo(
    () => getPresenceStats(presencesData, classStudentIds),
    [presencesData, classStudentIds],
  );
  const studentsCountLabel = metricLabelFromSnapshot(studentsSnapshot, () => String(filteredStudents.length));
  const presenceRateLabel = metricLabelFromSnapshot(presencesSnapshot, () => `${presenceStats.rate}%`, "0%");
  const paymentRateLabel = metricLabelFromSnapshot(
    studentFeesSnapshot,
    (rows) =>
      formatPaymentRateKpi(
        rows.filter((fee) => classStudentIds.includes(String(fee.studentId ?? ""))),
      ).value,
    "—",
  );
  const studentsSubtitle = isMetricReady(studentsSnapshot) ? `${filteredStudents.length} élèves inscrits` : studentsCountLabel;

  const sections = useMemo(() => {
    const groups = filteredStudents.reduce<Record<string, StudentRow[]>>((acc, student) => {
      const key = student.className;
      return {
        ...acc,
        [key]: [...(acc[key] ?? []), student],
      };
    }, {});

    return Object.keys(groups)
      .sort()
      .map((title) => ({
        title,
        data: groups[title],
      }));
  }, [filteredStudents]);

  const renderStudentCreate = () => (
    <StudentMutationControls
      className={className}
      classes={classesData}
      createTestId={CLASSES_STUDENT_TEST_IDS.studentsAddButton}
      networkRequired={mutationsBlocked}
      onChanged={() => loadStudents()}
    />
  );

  const canOpenStudentDetail = canReadRoute(session, "StudentDetail");

  const openStudentDetail = useCallback(
    (studentId: string) => {
      if (!canOpenStudentDetail) return;
      const parent = navigation.getParent?.();
      if (parent?.navigate) {
        parent.navigate("StudentDetail", { studentId });
        return;
      }
      navigation.navigate("StudentDetail", { studentId });
    },
    [canOpenStudentDetail, navigation],
  );

  const renderStudentRow = useCallback(
    ({ item: student }: { item: StudentRow; index: number }) => {
      const lastPresence = presenceByStudentId.get(student.id);
      const lastStatus = normalizePresenceStatus(lastPresence);
      const isPresent = lastStatus === "Présent" || lastStatus === "Retard";
      const status =
        lastStatus === "Retard" ? "R" : lastStatus === "Justifié" ? "J" : isPresent ? "P" : "A";
      const classSubtitle = className === "Toutes les classes" && student.className ? student.className : "";

      return (
        <ExpandableEntityCard
          title={studentDisplayName(student)}
          subtitle={classSubtitle}
          badge={status}
          badgeTone={isPresent ? "default" : "danger"}
          testID={STUDENT_ROW_TEST_ID(student.id)}
          expanded={expandedStudentId === student.id}
          onExpandedChange={() => setExpandedStudentId((current) => nextExclusiveExpandedKey(current, student.id))}
        >
          <Text style={styles.detailLine}>Matricule : {student.matricule}</Text>
          <Text style={styles.detailLine}>Sexe : {student.gender ?? "Sexe non renseigné"}</Text>
          {student.className ? (
            <Text style={styles.detailLine}>Classe : {student.className}</Text>
          ) : null}
          {student.status ? (
            <Text style={styles.detailLine}>Statut : {displayStatusName(student.status)}</Text>
          ) : null}
          <Text style={styles.detailLine}>Présence : {lastStatus || "Non renseignée"}</Text>
          {canOpenStudentDetail ? (
            <TouchableOpacity
              style={styles.openButton}
              testID={STUDENT_OPEN_FICHE_TEST_ID(student.id)}
              accessibilityRole="button"
              accessibilityLabel={SCOLARITE_COPY.openStudentFiche}
              onPress={() => openStudentDetail(student.id)}
            >
              <Text style={styles.openButtonText}>{SCOLARITE_COPY.openStudentFiche}</Text>
            </TouchableOpacity>
          ) : null}
          <StudentMutationControls
            row={student}
            className={className}
            classes={classesData}
            networkRequired={mutationsBlocked}
            onChanged={() => loadStudents()}
          />
        </ExpandableEntityCard>
      );
    },
    [canOpenStudentDetail, className, classesData, expandedStudentId, loadStudents, mutationsBlocked, openStudentDetail, presenceByStudentId],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: StudentSection }) => (
      <View style={styles.classSectionHeader}>
        <Text style={styles.classSectionTitle}>{section.title}</Text>
        <Text style={styles.classSectionCount}>{section.data.length} élève(s)</Text>
      </View>
    ),
    [],
  );

  const listHeader = useMemo(
    () => (
      <>
        <View style={styles.header}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.backButton}
            testID={CLASSES_STUDENT_TEST_IDS.studentsBackButton}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Retour aux classes"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={24} color="#0F172A" />
          </TouchableOpacity>

          <View style={styles.headerTextBox}>
            <Text style={styles.title} testID={CLASSES_STUDENT_TEST_IDS.studentsTitle}>
              {className}
            </Text>
            <Text style={styles.subtitle} testID={CLASSES_STUDENT_TEST_IDS.studentsCount}>
              {studentsSubtitle}
            </Text>
          </View>
        </View>
        {renderStudentCreate()}
        <StudentsScopeAlert />
        {mutationsBlocked ? (
          <Text style={{ color: "#B91C1C", fontWeight: "700", marginBottom: 12 }} testID="l1-offline-banner">
            {OFFLINE_COPY.l1ModeTitle}
            {studentsSnapshot.cachedAt
              ? ` — ${OFFLINE_COPY.l1LastSyncPrefix} : ${studentsSnapshot.cachedAt}`
              : ""}
          </Text>
        ) : null}

        <FormField
          label="Recherche"
          hideVisibleLabel
          type="search"
          leading={<Ionicons name="search-outline" size={22} color="#94A3B8" />}
          placeholder="Ex. Esther Okito"
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Rechercher un élève"
        />

        <View style={styles.summaryCard}>
          <View>
            <Text style={styles.summaryValue}>{studentsCountLabel}</Text>
            <Text style={styles.summaryLabel}>Élèves</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View>
            <Text style={styles.summaryValue}>{presenceRateLabel}</Text>
            <Text style={styles.summaryLabel}>Présence</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View>
            <Text style={styles.summaryValue}>{paymentRateLabel}</Text>
            <Text style={styles.summaryLabel}>Paiements</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle} testID={CLASSES_STUDENT_TEST_IDS.studentsSectionTitle}>
          {CLASSES_STUDENT_COPY.studentsSectionTitle}
        </Text>
      </>
    ),
    [
      className,
      filteredStudents.length,
      mutationsBlocked,
      navigation,
      paymentRateLabel,
      presenceRateLabel,
      query,
      studentsCountLabel,
      studentsProjection.error,
      studentsSnapshot.cachedAt,
      studentsSubtitle,
    ],
  );

  const isClassEmpty = classStudents.length === 0 && className !== "Toutes les classes";
  const isDirectoryEmpty = classStudents.length === 0 && className === "Toutes les classes" && !query.trim();
  const emptyMessage = isDirectoryEmpty
    ? "Aucun élève inscrit. Ouvrez une classe puis « Inscrire un élève »."
    : isClassEmpty
    ? CLASSES_STUDENT_COPY.studentsEmptyClass
    : CLASSES_STUDENT_COPY.studentsEmptySearch;

  const listEmptyComponent = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Ionicons
          name={isClassEmpty ? "people-outline" : "search-outline"}
          size={28}
          color="#94A3B8"
        />
        <Text style={styles.emptyTitle} testID={CLASSES_STUDENT_TEST_IDS.studentsEmpty}>
          {emptyMessage}
        </Text>
        <Text style={styles.emptyHint}>
          {isDirectoryEmpty
            ? SCOLARITE_COPY.enrollmentsHint
            : isClassEmpty
            ? "Cette classe n'a pas encore d'élève inscrit."
            : "Essayez un autre nom ou matricule."}
        </Text>
      </View>
    ),
    [emptyMessage, isClassEmpty, isDirectoryEmpty],
  );

  return (
    <View style={styles.screen} testID={CLASSES_STUDENT_TEST_IDS.studentsScreen}>
      {sections.length === 0 ? (
        <ScrollView
          contentContainerStyle={[scrollContentStyle, styles.emptyListContent]}
          testID={CLASSES_STUDENT_TEST_IDS.studentsList}
          showsVerticalScrollIndicator={false}
        >
          {listHeader}
          {listEmptyComponent}
        </ScrollView>
      ) : (
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderStudentRow}
        renderSectionHeader={renderSectionHeader}
        ListHeaderComponent={listHeader}
        contentContainerStyle={scrollContentStyle}
        testID={CLASSES_STUDENT_TEST_IDS.studentsList}
        initialNumToRender={14}
        maxToRenderPerBatch={10}
        windowSize={9}
        removeClippedSubviews
        stickySectionHeadersEnabled={false}
        SectionSeparatorComponent={() => null}
        renderSectionFooter={() => <View style={styles.sectionFooter} />}
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  scrollContent: {
    paddingTop: 42,
    paddingHorizontal: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  backButton: {
    minWidth: MIN_TOUCH_TARGET_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  headerTextBox: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: "#0F172A",
    letterSpacing: -0.7,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  summaryCard: {
    backgroundColor: "#0F172A",
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  summaryLabel: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: "700",
    color: "#CBD5E1",
  },
  summaryDivider: {
    width: 1,
    height: 34,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 10,
  },
  classSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  classSectionTitle: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "900",
  },
  classSectionCount: {
    color: "#2563EB",
    fontSize: 11,
    fontWeight: "900",
  },
  sectionFooter: {
    marginBottom: 8,
  },
  detailLine: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "700",
    color: "#334155",
  },
  openButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    marginTop: 10,
  },
  openButtonText: { color: "#1D4ED8", fontWeight: "800" },
  emptyState: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginTop: 8,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  emptyTitle: {
    marginTop: 10,
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyHint: {
    marginTop: 6,
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
});
