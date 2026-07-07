import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { getPaymentStats, getPresenceStats, normalizePresenceStatus } from "../domain/metrics/schoolMetrics";
import { canMutateEntity, canReadRoute } from "../domain/security/permissions";
import {
  filterStudentsByClassName,
  scopedStudentsForSession,
} from "../lib/establishment";
import { useFloatingTabBarLayout } from "../lib/screenLayout";

export default function StudentsScreen({ route, navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const scrollContentStyle = [styles.scrollContent, { paddingBottom: scrollContentPaddingBottom }];
  const { session } = useAuth();
  const { studentsData, paymentsData, presencesData, teachersData, assignmentsData, classesData } = useAdminData();
  const className = route?.params?.className ?? "Toutes les classes";
  const [query, setQuery] = useState("");
  const teacherScopeState = { teachers: teachersData, assignments: assignmentsData, classes: classesData };
  const availableStudents = scopedStudentsForSession(session, studentsData, teacherScopeState);

  const classStudents =
    className === "Toutes les classes"
      ? availableStudents
      : filterStudentsByClassName(availableStudents, className);

  const filteredStudents = classStudents.filter((student) => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return true;
    }

    return (
      student.name.toLowerCase().includes(normalizedQuery) ||
      student.matricule.toLowerCase().includes(normalizedQuery)
    );
  });

  const classStudentIds = classStudents.map((student) => student.id);
  const presenceStats = getPresenceStats(presencesData, classStudentIds);
  const paymentStats = getPaymentStats(paymentsData, classStudentIds);
  const canCreateStudent = canMutateEntity(session, "students", "CREATE");
  const canOpenStudentDetail = canReadRoute(session, "StudentDetail");
  const classGroups = filteredStudents.reduce<Record<string, typeof filteredStudents>>(
    (groups, student) => {
      const key = student.className;
      return {
        ...groups,
        [key]: [...(groups[key] ?? []), student],
      };
    },
    {}
  );
  const groupedClassNames = Object.keys(classGroups).sort();

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={scrollContentStyle}
      >
        <View style={styles.header}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color="#0F172A" />
          </TouchableOpacity>

          <View style={styles.headerTextBox}>
            <Text style={styles.title}>{className}</Text>
            <Text style={styles.subtitle}>
              {filteredStudents.length} élèves inscrits
            </Text>
          </View>

          {canCreateStudent && (
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.addButton}
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

        <Text style={styles.sectionTitle}>Liste des élèves</Text>

        {groupedClassNames.map((groupName) => (
          <View key={groupName} style={styles.classSection}>
            <View style={styles.classSectionHeader}>
              <Text style={styles.classSectionTitle}>{groupName}</Text>
              <Text style={styles.classSectionCount}>
                {classGroups[groupName].length} élève(s)
              </Text>
            </View>

            {classGroups[groupName].map((student, index) => {
              const lastPresence = [...presencesData]
                .reverse()
                .find((presence) => presence.studentId === student.id);
              const lastStatus = normalizePresenceStatus(lastPresence);
              const isPresent = lastStatus === "Présent" || lastStatus === "Retard";
              const status = lastStatus === "Retard" ? "R" : lastStatus === "Justifié" ? "J" : isPresent ? "P" : "A";

              return (
                <TouchableOpacity
                  key={student.id}
                  activeOpacity={0.85}
                  style={styles.studentRow}
                  onPress={() =>
                    canOpenStudentDetail && navigation.navigate("StudentDetail", {
                      studentId: student.id,
                    })
                  }
                >
                  <Text style={styles.rowIndex}>{index + 1}</Text>

                  <View style={styles.studentContent}>
                    <Text style={styles.studentName} numberOfLines={1}>
                      {student.name}
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
            })}
          </View>
        ))}

        {filteredStudents.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={22} color="#94A3B8" />
            <Text style={styles.emptyText}>Aucun élève trouvé</Text>
          </View>
        )}
      </ScrollView>
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
    width: 40,
    height: 40,
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

  classSection: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    marginBottom: 14,
    overflow: "hidden",
  },

  classSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 12,
    paddingVertical: 9,
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

  studentRow: {
    minHeight: 46,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
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
    padding: 18,
    alignItems: "center",
  },

  emptyText: {
    marginTop: 8,
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800",
  },
});
