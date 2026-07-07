import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAdminData } from "../context/AdminDataContext";
import { useAuth } from "../context/AuthContext";
import { canMutateEntity } from "../domain/security/permissions";
import { entityCreateViaContactsOnly } from "../lib/contactProvisioning";
import {
  resolveTeacherClassesForRecord,
  resolveTeacherCoursesForRecord,
} from "../lib/establishment";
import { useFloatingTabBarLayout } from "../lib/screenLayout";

export default function TeachersScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const { session } = useAuth();
  const { teachersData, assignmentsData } = useAdminData();
  const canCreate =
    canMutateEntity(session, "teachers", "CREATE") && !entityCreateViaContactsOnly("teachers");
  const canUpdate = canMutateEntity(session, "teachers", "UPDATE");

  return (
    <ScrollView style={styles.container} contentContainerStyle={contentStyle}>
      <Text style={styles.title}>Enseignants</Text>
      <Text style={styles.subtitle}>Équipe pédagogique active</Text>

      {canCreate && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.addButton}
          onPress={() => navigation.navigate("AdminCrud", { entity: "teachers" })}
        >
          <Ionicons name="person-add-outline" size={20} color="#FFFFFF" />
          <Text style={styles.addButtonText}>Ajouter un enseignant</Text>
        </TouchableOpacity>
      )}

      {teachersData.map((teacher) => {
        const teacherClasses = resolveTeacherClassesForRecord(teacher, assignmentsData);
        const teacherCourses = resolveTeacherCoursesForRecord(teacher, assignmentsData);

        return (
          <TouchableOpacity
            key={teacher.id}
            activeOpacity={0.85}
            style={styles.card}
            onPress={() => canUpdate && navigation.navigate("AdminCrud", { entity: "teachers" })}
          >
            <View style={styles.iconBox}>
              <Ionicons name="school-outline" size={24} color="#2563EB" />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.name}>{teacher.name}</Text>
              <Text style={styles.meta}>Sexe : {teacher.gender ?? "Non renseigné"}</Text>
              <Text style={styles.meta}>{teacherCourses.join(", ") || "Cours non renseignés"}</Text>
              <Text style={styles.meta}>Classes : {teacherClasses.join(", ") || "Non assignées"}</Text>
            </View>
            <Text style={styles.phone}>{teacher.phone}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: "900",
    color: "#0F172A",
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 20,
    color: "#64748B",
    fontWeight: "700",
  },
  addButton: {
    backgroundColor: "#2563EB",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    marginLeft: 8,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  iconBox: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardContent: {
    flex: 1,
  },
  name: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0F172A",
  },
  meta: {
    marginTop: 4,
    color: "#64748B",
    fontWeight: "600",
  },
  phone: {
    color: "#2563EB",
    fontWeight: "800",
    maxWidth: 110,
    textAlign: "right",
  },
});
