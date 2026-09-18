import { useCallback, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import ExpandableEntityCard from "../components/ExpandableEntityCard";
import QueryStateView from "../components/QueryStateView";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { classGradesStats } from "../lib/classGradesStats";
import { resolveTeacherAssignmentsForSession } from "../lib/establishment";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { hasSecurityPermission } from "../domain/security/permissions";

function formatAverage(value: number) {
  return `${value.toFixed(1).replace(".", ",")}/20`;
}

export default function ClassGradesStatsScreen() {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { session } = useAuth();
  const {
    studentsData,
    notesSnapshot,
    assignmentsData,
    assignmentsSnapshot,
    teachersData,
    loadNotes,
    loadAssignments,
    loadTeachers,
    loadStudents,
  } = useAdminData();
  const [className, setClassName] = useState("");
  const [period, setPeriod] = useState("");

  const canRead = hasSecurityPermission(session, "Notes", "READ");
  const isTeacher = String(session?.role ?? "").toLowerCase().includes("enseign");

  const scopedAssignments = useMemo(
    () =>
      resolveTeacherAssignmentsForSession(session, {
        assignments: assignmentsData,
        teachers: teachersData,
        assignmentsSource: assignmentsSnapshot.source,
      }),
    [assignmentsData, assignmentsSnapshot.source, session, teachersData],
  );

  const allowedClassNames = useMemo(() => {
    if (!isTeacher) return null;
    return [...new Set(scopedAssignments.map((row) => String(row.className ?? "").trim()).filter(Boolean))];
  }, [isTeacher, scopedAssignments]);

  const classOptions = useMemo(() => {
    const fromStudents = [...new Set(studentsData.map((row) => String(row.className ?? "").trim()).filter(Boolean))];
    const options = allowedClassNames ? fromStudents.filter((name) => allowedClassNames.includes(name)) : fromStudents;
    return options.sort((a, b) => a.localeCompare(b, "fr"));
  }, [allowedClassNames, studentsData]);

  const periodOptions = useMemo(
    () =>
      [...new Set((notesSnapshot.data ?? []).map((note) => String(note.period ?? "").trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, "fr"),
      ),
    [notesSnapshot.data],
  );

  useFocusEffect(
    useCallback(() => {
      void loadNotes();
      void loadStudents();
      void loadAssignments();
      void loadTeachers();
    }, [loadAssignments, loadNotes, loadStudents, loadTeachers]),
  );

  const activeClass = className || classOptions[0] || "";
  const stats = useMemo(
    () =>
      classGradesStats({
        students: studentsData,
        notes: notesSnapshot.data ?? [],
        className: activeClass,
        period,
        allowedClassNames,
      }),
    [activeClass, allowedClassNames, notesSnapshot.data, period, studentsData],
  );

  if (!canRead) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Statistiques de classe</Text>
        <Text style={styles.error}>Accès refusé. Notes:READ est requis.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: scrollContentPaddingBottom, gap: 10 }}
      data={stats.empty ? [] : stats.ranking}
      keyExtractor={(row) => row.studentId}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>Statistiques de classe</Text>
          <Text style={styles.subtitle}>Moyennes, classement et élèves en difficulté</Text>
          <View style={styles.chips}>
            {classOptions.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, activeClass === option && styles.chipActive]}
                onPress={() => setClassName(option)}
              >
                <Text style={[styles.chipText, activeClass === option && styles.chipTextActive]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.chips}>
            <TouchableOpacity style={[styles.chip, !period && styles.chipActive]} onPress={() => setPeriod("")}>
              <Text style={[styles.chipText, !period && styles.chipTextActive]}>Toutes les périodes</Text>
            </TouchableOpacity>
            {periodOptions.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, period === option && styles.chipActive]}
                onPress={() => setPeriod(option)}
              >
                <Text style={[styles.chipText, period === option && styles.chipTextActive]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {notesSnapshot.status !== "success" ? (
            <QueryStateView
              snapshot={notesSnapshot}
              emptyMessage="Aucune note pour cette période."
              errorMessage="Impossible de charger les notes."
              offlineMessage="Connexion requise pour les statistiques de classe."
              emptyTestId="class-grades-empty"
              errorTestId="class-grades-error"
              onRetry={() => void loadNotes()}
            />
          ) : null}
          {notesSnapshot.status === "success" && stats.empty ? (
            <View style={styles.emptyCard}>
              <Text style={styles.empty}>Aucune note pour cette période.</Text>
            </View>
          ) : null}
          {notesSnapshot.status === "success" && !stats.empty ? (
            <View style={styles.kpiGrid}>
              <Kpi label="Moyenne de classe" value={formatAverage(stats.classAverage)} />
              <Kpi label="Meilleure moyenne" value={formatAverage(stats.bestAverage)} />
              <Kpi label="Plus faible" value={formatAverage(stats.lowestAverage)} />
              <Kpi label="Taux de réussite" value={`${stats.successRate} %`} />
            </View>
          ) : null}
          {stats.atRisk.length ? (
            <Text style={styles.section}>Élèves en difficulté ({stats.atRisk.length})</Text>
          ) : null}
          {stats.atRisk.map((row) => (
            <Text key={`risk-${row.studentId}`} style={styles.risk}>
              {row.name} · {formatAverage(row.average)}
            </Text>
          ))}
          {!stats.empty ? <Text style={styles.section}>Classement</Text> : null}
        </>
      }
      renderItem={({ item }) => (
        <ExpandableEntityCard title={item.name} subtitle={item.rankLabel} badge={formatAverage(item.average)}>
          <Text style={styles.detail}>Rang : {item.rankLabel}</Text>
          <Text style={styles.detail}>Moyenne : {formatAverage(item.average)}</Text>
        </ExpandableEntityCard>
      )}
    />
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 28, fontWeight: "900", color: "#0F172A" },
  subtitle: { color: "#64748B", fontWeight: "700" },
  error: { color: "#991B1B", fontWeight: "800", marginTop: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, backgroundColor: "#E2E8F0", paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: "#2563EB" },
  chipText: { color: "#334155", fontWeight: "800", fontSize: 13 },
  chipTextActive: { color: "#FFFFFF" },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpi: { width: "48%", backgroundColor: "#FFFFFF", borderRadius: 16, padding: 12 },
  kpiLabel: { color: "#64748B", fontWeight: "800", fontSize: 12 },
  kpiValue: { color: "#0F172A", fontWeight: "900", fontSize: 18, marginTop: 4 },
  section: { color: "#0F172A", fontWeight: "900", fontSize: 18, marginTop: 8 },
  risk: { color: "#991B1B", fontWeight: "700" },
  detail: { color: "#334155", fontWeight: "700", marginBottom: 4 },
  emptyCard: { backgroundColor: "#FFFBEB", borderRadius: 16, padding: 16 },
  empty: { color: "#92400E", fontWeight: "800", textAlign: "center" },
});
