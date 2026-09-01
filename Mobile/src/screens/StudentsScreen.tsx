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

import { useFloatingTabBarLayout } from "../lib/screenLayout";

import {

  CLASSES_STUDENT_COPY,

  CLASSES_STUDENT_TEST_IDS,

  STUDENT_ROW_TEST_ID,

} from "../lib/classesStudentJourneySpec";

import { isMetricReady, metricLabelFromSnapshot } from "../lib/dataTruth";
import { formatPaymentRateKpi } from "../lib/paymentRateKpi";
import { shouldBlockUnsupportedMutations } from "../offline/l1/readModel";
import { OFFLINE_COPY } from "../lib/offlineModeSpec";

import { studentDisplayName } from "../lib/studentDisplayName";

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

    ({ item: student, index }: { item: StudentRow; index: number }) => {

      const lastPresence = presenceByStudentId.get(student.id);

      const lastStatus = normalizePresenceStatus(lastPresence);

      const isPresent = lastStatus === "Présent" || lastStatus === "Retard";

      const status =

        lastStatus === "Retard" ? "R" : lastStatus === "Justifié" ? "J" : isPresent ? "P" : "A";



      return (

        <View style={styles.studentRow}>

        <TouchableOpacity

          activeOpacity={0.85}

          style={styles.studentMain}

          testID={STUDENT_ROW_TEST_ID(student.id)}

          onPress={() => openStudentDetail(student.id)}

        >

          <Text style={styles.rowIndex}>{index + 1}</Text>



          <View style={styles.studentContent}>

            <Text style={styles.studentName} numberOfLines={1} ellipsizeMode="tail">

              {studentDisplayName(student)}

            </Text>

            <Text style={styles.studentInfo} numberOfLines={1}>

              {student.matricule} • {student.gender ?? "Sexe non renseigné"}

            </Text>

          </View>



          {className === "Toutes les classes" && (

            <Text style={styles.studentClass} numberOfLines={1}>

              {student.className}

            </Text>

          )}



          <View

            style={[

              styles.statusBadge,

              {

                backgroundColor: isPresent ? "#ECFDF5" : "#FEF2F2",

              },

            ]}

          >

            <Text

              style={[

                styles.statusText,

                {

                  color: isPresent ? "#16A34A" : "#DC2626",

                },

              ]}

            >

              {status}

            </Text>

          </View>

        </TouchableOpacity>
          <StudentMutationControls
            row={student}
            className={className}
            classes={classesData}
            networkRequired={mutationsBlocked}
            onChanged={() => loadStudents()}
          />
        </View>

      );

    },

    [className, classesData, loadStudents, mutationsBlocked, openStudentDetail, presenceByStudentId],

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

      renderStudentCreate,

      className,

      filteredStudents.length,

      navigation,

      paymentRateLabel,

      presenceRateLabel,

      studentsCountLabel,

      studentsProjection.error,

      studentsSubtitle,

      query,

    ],

  );



  const isClassEmpty = classStudents.length === 0 && className !== "Toutes les classes";

  const emptyMessage = isClassEmpty

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

          {isClassEmpty

            ? "Cette classe n'a pas encore d'élève inscrit."

            : "Essayez un autre nom ou matricule."}

        </Text>

      </View>

    ),

    [className, emptyMessage, isClassEmpty],

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

    minWidth: 44,

    minHeight: 44,

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



  addButton: {

    width: 42,

    height: 42,

    borderRadius: 15,

    backgroundColor: "#2563EB",

    alignItems: "center",

    justifyContent: "center",

  },



  searchBox: {

    height: 46,

    borderRadius: 16,

    backgroundColor: "#FFFFFF",

    paddingHorizontal: 12,

    flexDirection: "row",

    alignItems: "center",

    marginBottom: 12,

  },



  searchInput: {

    flex: 1,

    marginLeft: 10,

    fontSize: 13,

    fontWeight: "600",

    color: "#0F172A",

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

    backgroundColor: "#FFFFFF",

    borderBottomLeftRadius: 16,

    borderBottomRightRadius: 16,

    marginBottom: 14,

    overflow: "hidden",

  },



  studentRow: {

    minHeight: MIN_TOUCH_TARGET_DP,

    paddingLeft: 10,

    borderTopWidth: 1,

    borderTopColor: "#F1F5F9",

    flexDirection: "row",

    alignItems: "center",

    backgroundColor: "#FFFFFF",

  },



  studentMain: {

    flex: 1,

    minWidth: 0,

    minHeight: MIN_TOUCH_TARGET_DP,

    paddingVertical: 7,

    flexDirection: "row",

    alignItems: "center",

  },



  rowIndex: {

    width: 28,

    color: "#94A3B8",

    fontSize: 11,

    fontWeight: "900",

    textAlign: "center",

  },



  studentContent: {

    flex: 1,

    minWidth: 0,

  },



  studentName: {

    fontSize: 13,

    fontWeight: "900",

    color: "#0F172A",

  },



  studentInfo: {

    marginTop: 2,

    fontSize: 10,

    fontWeight: "700",

    color: "#64748B",

  },



  studentClass: {

    width: 58,

    marginHorizontal: 8,

    fontSize: 10,

    fontWeight: "800",

    color: "#2563EB",

    textAlign: "right",

  },



  statusBadge: {

    minWidth: 26,

    paddingHorizontal: 7,

    paddingVertical: 4,

    borderRadius: 999,

    alignItems: "center",

  },



  statusText: {

    fontSize: 10,

    fontWeight: "900",

  },



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



  emptyActionButton: {

    marginTop: 16,

    backgroundColor: "#2563EB",

    borderRadius: 14,

    paddingHorizontal: 18,

    paddingVertical: 12,

  },



  emptyActionText: {

    color: "#FFFFFF",

    fontSize: 14,

    fontWeight: "900",

  },



  emptyText: {

    marginTop: 8,

    color: "#64748B",

    fontSize: 12,

    fontWeight: "800",

  },

});


