import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getPresenceRate } from "../data/catalog";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { canMutateEntity, canReadRoute } from "../domain/security/permissions";
import {
  classNameMatches,
  scopedClassesForSession,
  scopedStudentsForSession,
} from "../lib/establishment";
import { useFloatingTabBarLayout } from "../lib/screenLayout";

export default function ClassesScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const scrollContentStyle = [styles.scrollContent, { paddingBottom: scrollContentPaddingBottom }];
  const { session } = useAuth();
  const { classesData, studentsData, teachersData, assignmentsData } = useAdminData();
  const teacherScopeState = { teachers: teachersData, assignments: assignmentsData, classes: classesData };
  const visibleStudents = scopedStudentsForSession(session, studentsData, teacherScopeState);
  const visibleClasses = scopedClassesForSession(session, classesData, studentsData, teacherScopeState);
  const totalStudents = visibleStudents.length;
  const canCreateClass = canMutateEntity(session, "classes", "CREATE");
  const canOpenStudents = canReadRoute(session, session?.role === "teacher" ? "TeacherStudents" : "Students");

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={scrollContentStyle}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Classes</Text>
            <Text style={styles.subtitle}>Gérez les classes et les élèves</Text>
          </View>

          {canCreateClass && (
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.addButton}
              onPress={() => navigation.navigate("AdminCrud", { entity: "classes" })}
            >
              <Ionicons name="add" size={26} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={22} color="#94A3B8" />
          <TextInput
            placeholder="Rechercher une classe"
            placeholderTextColor="#94A3B8"
            style={styles.searchInput}
          />
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.summaryCard}
          onPress={() => canOpenStudents && navigation.navigate("Students", { className: "Toutes les classes" })}
        >
          <View>
            <Text style={styles.summaryValue}>{visibleClasses.length}</Text>
            <Text style={styles.summaryLabel}>Classes actives</Text>
          </View>

          <View style={styles.summaryDivider} />

          <View>
            <Text style={styles.summaryValue}>{totalStudents}</Text>
            <Text style={styles.summaryLabel}>Élèves inscrits</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Liste des classes</Text>

        {visibleClasses.map((item) => {
          const classStudents = visibleStudents.filter((student) => classNameMatches(student.className, item.name));
          const teacher = teachersData.find((teacherItem) => teacherItem.id === item.teacherId);
          const presenceRate = getPresenceRate(classStudents.map((student) => student.id));

          return (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.85}
              style={styles.classCard}
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
                  <Text style={styles.className}>{item.name}</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{presenceRate}%</Text>
                  </View>
                </View>

                <Text style={styles.classInfo}>{classStudents.length} élèves</Text>
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
          );
        })}
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
    paddingTop: 52,
    paddingHorizontal: 20,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
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

  addButton: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2563EB",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
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

  classCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 26,
    padding: 16,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
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
