import {

  View,

  Text,

  StyleSheet,

  ScrollView,

  SectionList,

  TouchableOpacity,

  TextInput,

} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { useCallback, useMemo, useState } from "react";

import { useAuth } from "../context/AuthContext";

import { useAdminData } from "../context/AdminDataContext";

import { getPaymentStats, getPresenceStats, normalizePresenceStatus } from "../domain/metrics/schoolMetrics";

import { canReadRoute } from "../domain/security/permissions";

import {

  filterStudentsByClassName,

  scopedStudentsForSession,

} from "../lib/establishment";

import { useFloatingTabBarLayout } from "../lib/screenLayout";

import {

  CLASSES_STUDENT_COPY,

  CLASSES_STUDENT_TEST_IDS,

  STUDENT_ROW_TEST_ID,

} from "../lib/classesStudentJourneySpec";

import type { PresenceItem } from "../data/catalog";



type StudentRow = ReturnType<typeof scopedStudentsForSession>[number];



type StudentSection = {

  title: string;

  data: StudentRow[];

};



export default function StudentsScreen({ route, navigation }: any) {

  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();

  const scrollContentStyle = [styles.scrollContent, { paddingBottom: scrollContentPaddingBottom }];

  const { session } = useAuth();

  const { studentsData, paymentsData, presencesData, teachersData, assignmentsData, classesData } = useAdminData();

  const className = route?.params?.className ?? "Toutes les classes";

  const [query, setQuery] = useState("");

  const teacherScopeState = { teachers: teachersData, assignments: assignmentsData, classes: classesData };

  const availableStudents = scopedStudentsForSession(session, studentsData, teacherScopeState);



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

  const paymentStats = useMemo(

    () => getPaymentStats(paymentsData, classStudentIds),

    [paymentsData, classStudentIds],

  );



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



  // PR1 consolidation : création élève uniquement via Classes → Inscrire (web/API PG).
  const canManageStudents = false;
  const canCreateStudent = false;

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

        <TouchableOpacity

          activeOpacity={0.85}

          style={styles.studentRow}

          testID={STUDENT_ROW_TEST_ID(student.id)}

          onPress={() => openStudentDetail(student.id)}

        >

          <Text style={styles.rowIndex}>{index + 1}</Text>



          <View style={styles.studentContent}>

            <Text style={styles.studentName} numberOfLines={1} ellipsizeMode="tail">

              {[student.firstName, student.name].filter(Boolean).join(" ").trim() || student.name}

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

      );

    },

    [className, openStudentDetail, presenceByStudentId],

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

              {filteredStudents.length} élèves inscrits

            </Text>

          </View>



          {canManageStudents && (

            <TouchableOpacity

              activeOpacity={0.85}

              style={styles.addButton}

              testID={CLASSES_STUDENT_TEST_IDS.studentsAddButton}

              onPress={() =>

                navigation.navigate("AdminCrud", {

                  entity: "students",

                  ...(className !== "Toutes les classes" ? { className } : {}),

                })

              }

            >

              <Ionicons name="add" size={26} color="#FFFFFF" />

            </TouchableOpacity>

          )}

        </View>



        <View style={styles.searchBox}>

          <Ionicons name="search-outline" size={22} color="#94A3B8" />

          <TextInput

            placeholder="Rechercher un élève"

            placeholderTextColor="#94A3B8"

            value={query}

            onChangeText={setQuery}

            style={styles.searchInput}

          />

        </View>



        <View style={styles.summaryCard}>

          <View>

            <Text style={styles.summaryValue}>{filteredStudents.length}</Text>

            <Text style={styles.summaryLabel}>Élèves</Text>

          </View>



          <View style={styles.summaryDivider} />



          <View>

            <Text style={styles.summaryValue}>{presenceStats.rate}%</Text>

            <Text style={styles.summaryLabel}>Présence</Text>

          </View>



          <View style={styles.summaryDivider} />



          <View>

            <Text style={styles.summaryValue}>{paymentStats.rate}%</Text>

            <Text style={styles.summaryLabel}>Paiements</Text>

          </View>

        </View>



        <Text style={styles.sectionTitle} testID={CLASSES_STUDENT_TEST_IDS.studentsSectionTitle}>

          {CLASSES_STUDENT_COPY.studentsSectionTitle}

        </Text>

      </>

    ),

    [

      canManageStudents,

      className,

      filteredStudents.length,

      navigation,

      paymentStats.rate,

      presenceStats.rate,

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

        {isClassEmpty && canManageStudents ? (

          <TouchableOpacity

            activeOpacity={0.85}

            style={styles.emptyActionButton}

            testID={CLASSES_STUDENT_TEST_IDS.studentsAddButton}

            onPress={() =>

              navigation.navigate("AdminCrud", {

                entity: "students",

                ...(className !== "Toutes les classes" ? { className } : {}),

              })

            }

          >

            <Text style={styles.emptyActionText}>{CLASSES_STUDENT_COPY.addStudentAction}</Text>

          </TouchableOpacity>

        ) : null}

      </View>

    ),

    [canManageStudents, className, emptyMessage, isClassEmpty, navigation],

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

    minHeight: 46,

    paddingHorizontal: 10,

    paddingVertical: 7,

    borderTopWidth: 1,

    borderTopColor: "#F1F5F9",

    flexDirection: "row",

    alignItems: "center",

    backgroundColor: "#FFFFFF",

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


