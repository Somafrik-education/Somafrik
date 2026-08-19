import { useCallback } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import { useAdminData } from "../context/AdminDataContext";
import { useCanonicalResource } from "../hooks/useCanonicalResource";
import {
  getCanonicalTeachers,
  type CanonicalTeacher,
} from "../services/domainHydrationApi";
import {
  resolveTeacherClassesForRecord,
  resolveTeacherCoursesForRecord,
} from "../lib/establishment";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { NAVIGATION_TEST_IDS } from "../lib/mobileNavigationSpec";

export default function TeachersScreen() {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const { assignmentsData } = useAdminData();
  const { snapshot, load } = useCanonicalResource<CanonicalTeacher>(getCanonicalTeachers);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const showQueryState = snapshot.status !== "success";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={contentStyle}
      testID={NAVIGATION_TEST_IDS.teachersScreen}
    >
      <Text style={styles.title} testID={NAVIGATION_TEST_IDS.teachersTitle}>
        Enseignants
      </Text>
      <Text style={styles.subtitle}>Équipe pédagogique chargée depuis PostgreSQL</Text>

      {showQueryState ? (
        <QueryStateView
          snapshot={snapshot}
          emptyMessage="Aucun enseignant."
          errorMessage="Impossible de charger les enseignants."
          offlineMessage="Réseau indisponible. Les enseignants n'ont pas pu être chargés."
          emptyTestId="teachers-empty"
          errorTestId="teachers-error"
          onRetry={() => void load()}
          loadingLabel="Chargement des enseignants…"
        />
      ) : (
        snapshot.data.map((teacher) => {
          const teacherClasses = resolveTeacherClassesForRecord(teacher, assignmentsData);
          const teacherCourses = resolveTeacherCoursesForRecord(teacher, assignmentsData);
          return (
            <View key={teacher.id} style={styles.card}>
              <View style={styles.iconBox}>
                <Ionicons name="school-outline" size={24} color="#2563EB" />
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.name}>{teacher.name || teacher.teacherCode}</Text>
                <Text style={styles.code}>{teacher.teacherCode || teacher.publicId}</Text>
                <Text style={styles.meta}>{teacherCourses.join(", ") || teacher.mainSubject || "Cours non renseignés"}</Text>
                <Text style={styles.meta}>Classes : {teacherClasses.join(", ") || "Non assignées"}</Text>
                {teacher.status ? <Text style={styles.meta}>Statut : {teacher.status}</Text> : null}
              </View>
              <Text style={styles.phone}>{teacher.phone}</Text>
            </View>
          );
        })
      )}

      <Text style={styles.lifecycleHint}>
        La création d'une identité Enseignant se fait depuis Comptes utilisateurs. Les actions non branchées ne sont pas simulées sur Mobile.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  title: { fontSize: 32, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 6, marginBottom: 20, color: "#64748B", fontWeight: "700" },
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
  cardContent: { flex: 1 },
  name: { fontSize: 17, fontWeight: "900", color: "#0F172A" },
  code: { marginTop: 3, color: "#2563EB", fontWeight: "800" },
  meta: { marginTop: 4, color: "#64748B", fontWeight: "600" },
  phone: { color: "#2563EB", fontWeight: "800", maxWidth: 110, textAlign: "right" },
  lifecycleHint: { color: "#64748B", fontWeight: "700", lineHeight: 20, marginTop: 8 },
});
