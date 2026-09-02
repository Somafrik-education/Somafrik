import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import TeacherMutationControls from "../components/TeacherMutationControls";
import AssignmentMutationControls from "../components/AssignmentMutationControls";
import { useAdminData } from "../context/AdminDataContext";
import {
  resolveTeacherClassesForRecord,
  resolveTeacherCoursesForRecord,
} from "../lib/establishment";
import { displayStatusName } from "../lib/format";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { NAVIGATION_TEST_IDS } from "../lib/mobileNavigationSpec";
import { getSubjects, type SchoolSubject } from "../services/api";

export default function TeachersScreen() {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const {
    assignmentsData,
    teachersSnapshot: snapshot,
    loadTeachers,
    loadAssignments,
    loadClasses,
    classesData,
    resourceScopeKey,
  } = useAdminData();
  const [subjects, setSubjects] = useState<SchoolSubject[]>([]);

  const load = useCallback(async () => {
    await Promise.all([loadTeachers(), loadAssignments(), loadClasses()]);
    const rows = await getSubjects().catch(() => [] as SchoolSubject[]);
    setSubjects(rows);
  }, [loadTeachers, loadAssignments, loadClasses]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, resourceScopeKey]),
  );

  const showQueryState = snapshot.status !== "success";
  const listHydrated = snapshot.status === "success" && snapshot.data.length > 0;

  return (
    <View style={styles.container} testID={NAVIGATION_TEST_IDS.teachersScreen}>
    <FlatList
      style={styles.list}
      contentContainerStyle={contentStyle}
      testID={listHydrated ? "teachers-list" : undefined}
      data={showQueryState ? [] : snapshot.data}
      keyExtractor={(teacher) => teacher.id}
      refreshControl={<RefreshControl refreshing={snapshot.status === "loading"} onRefresh={() => void load()} />}
      ListHeaderComponent={
        <>
          <Text style={styles.title} testID={NAVIGATION_TEST_IDS.teachersTitle}>
            Enseignants
          </Text>
          <Text style={styles.subtitle}>Équipe pédagogique chargée depuis PostgreSQL</Text>
          <TeacherMutationControls onChanged={() => load()} />
          <AssignmentMutationControls
            teachers={snapshot.status === "success" ? snapshot.data : []}
            classes={classesData}
            subjects={subjects}
            onChanged={() => load()}
          />
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
          ) : null}
        </>
      }
      renderItem={({ item: teacher }) => {
        const teacherClasses = resolveTeacherClassesForRecord(teacher, assignmentsData);
        const teacherCourses = resolveTeacherCoursesForRecord(teacher, assignmentsData);
        return (
          <View style={styles.card}>
            <View style={styles.iconBox}>
              <Ionicons name="school-outline" size={24} color="#2563EB" />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.name} numberOfLines={3}>{teacher.name || teacher.teacherCode}</Text>
              <Text style={styles.code}>{teacher.teacherCode || teacher.publicId}</Text>
              <Text style={styles.meta} numberOfLines={3}>{teacherCourses.join(", ") || teacher.mainSubject || "Cours non renseignés"}</Text>
              <Text style={styles.meta} numberOfLines={3}>Classes : {teacherClasses.join(", ") || "Non assignées"}</Text>
              {teacher.status ? <Text style={styles.meta}>Statut : {displayStatusName(teacher.status)}</Text> : null}
              {teacher.phone ? <Text style={styles.phone}>{teacher.phone}</Text> : null}
              <TeacherMutationControls row={teacher} onChanged={() => load()} />
            </View>
          </View>
        );
      }}
      ListFooterComponent={
        <Text style={styles.lifecycleHint}>
          L’attribution et le retrait des droits de la matrice RBAC restent disponibles uniquement sur le Web. L’identité enseignant se crée via Utilisateurs, puis par attribution du rôle Enseignant.
        </Text>
      }
    />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  list: { flex: 1 },
  content: { padding: 20 },
  title: { fontSize: 32, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 6, marginBottom: 20, color: "#64748B", fontWeight: "700" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "flex-start",
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
  cardContent: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, fontWeight: "900", color: "#0F172A" },
  code: { marginTop: 3, color: "#2563EB", fontWeight: "800" },
  meta: { marginTop: 4, color: "#64748B", fontWeight: "600" },
  phone: { color: "#2563EB", fontWeight: "800", marginTop: 4 },
  lifecycleHint: { color: "#64748B", fontWeight: "700", lineHeight: 20, marginTop: 8 },
});
