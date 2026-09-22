import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import ExpandableEntityCard from "../components/ExpandableEntityCard";
import TeacherMutationControls from "../components/TeacherMutationControls";
import AssignmentMutationControls from "../components/AssignmentMutationControls";
import { useAdminData } from "../context/AdminDataContext";
import {
  resolveTeacherClassesForRecord,
  resolveTeacherCoursesForRecord,
} from "../lib/establishment";
import { nextExclusiveExpandedKey } from "../lib/expandableEntity";
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
  const [expandedTeacherId, setExpandedTeacherId] = useState<string | null>(null);

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
      extraData={expandedTeacherId}
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
        const statusLabel = teacher.status ? displayStatusName(teacher.status) : "";
        const statusKey = String(teacher.status ?? "").toLowerCase();
        const badgeTone =
          /archiv|inactif|inactive|disabled|desactiv|suspend/.test(statusKey) ? "warning" as const : "default" as const;
        return (
          <ExpandableEntityCard
            title={teacher.name || teacher.teacherCode}
            subtitle={String(teacher.teacherCode || teacher.publicId || "")}
            badge={statusLabel}
            badgeTone={badgeTone}
            testID={`teachers-row-${teacher.id}`}
            expanded={expandedTeacherId === teacher.id}
            onExpandedChange={() =>
              setExpandedTeacherId((current) => nextExclusiveExpandedKey(current, teacher.id))
            }
          >
            <Text style={styles.meta} numberOfLines={3}>
              {teacherCourses.join(", ") || teacher.mainSubject || "Cours non renseignés"}
            </Text>
            <Text style={styles.meta} numberOfLines={3}>
              Classes : {teacherClasses.join(", ") || "Non assignées"}
            </Text>
            {teacher.phone ? <Text style={styles.phone}>{teacher.phone}</Text> : null}
            <TeacherMutationControls row={teacher} onChanged={() => load()} />
          </ExpandableEntityCard>
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
  meta: { marginTop: 4, color: "#64748B", fontWeight: "600" },
  phone: { color: "#2563EB", fontWeight: "800", marginTop: 4 },
  lifecycleHint: { color: "#64748B", fontWeight: "700", lineHeight: 20, marginTop: 8 },
});
