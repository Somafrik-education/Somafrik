import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import StudentSwitcher from "../components/StudentSwitcher";
import QueryStateView from "../components/QueryStateView";
import { getPresenceStats, normalizePresenceStatus } from "../domain/metrics/schoolMetrics";
import { useAdminData } from "../context/AdminDataContext";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  PRESENCE_ROW_TEST_ID,
  STUDENT_SUB_SCREENS_COPY,
  STUDENT_SUB_SCREENS_TEST_IDS,
} from "../lib/studentSubScreensSpec";
import { DATA_TRUTH_COPY, DATA_TRUTH_TEST_IDS, metricLabelFromSnapshot } from "../lib/dataTruth";
import {
  countLinkedParentChildren,
  parentChildNameFromSession,
  parentHomeIdentityName,
  parentPresenceSummary,
} from "../lib/parentLinkedMetrics";
import { studentSubScreenStyles as styles } from "../lib/studentSubScreenLayout";
import { findStudentByIdentity, resolveParentSafeStudentId, sessionStudentAliasKeys } from "../lib/canonicalStudentIdentity";
import { useParentStudentRouteSelection } from "../lib/useParentStudentRouteSelection";

type Props = NativeStackScreenProps<RootStackParamList, "StudentPresences">;

export default function StudentPresencesScreen({ route, navigation }: Partial<Props>) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const listContentStyle = [styles.listContent, { paddingBottom: scrollContentPaddingBottom }];
  const { session, selectedStudentId } = useAuth();
  useParentStudentRouteSelection(route?.params?.studentId);
  const { studentsData, presencesData, loadPresences, loadStudents, presencesSnapshot, resourceScopeKey } = useAdminData();
  const studentId = resolveParentSafeStudentId({
    role: session?.role,
    routeStudentId: route?.params?.studentId,
    selectedStudentId,
    user: session?.user,
  });
  const studentAliasKeys = sessionStudentAliasKeys({
    role: session?.role,
    selectedStudentId: studentId,
    user: session?.user,
  });
  const student = findStudentByIdentity(studentsData, studentAliasKeys);

  useFocusEffect(
    useCallback(() => {
      void loadStudents();
      void loadPresences();
    }, [loadStudents, loadPresences, resourceScopeKey]),
  );

  const presencesEleve = presencesData.filter((presence) =>
    studentAliasKeys.includes(String(presence.studentId ?? "")),
  );
  const presenceStats = getPresenceStats(presencesEleve);
  const isParent = session?.role === "parent_student";
  const parentLinkedCount = isParent ? countLinkedParentChildren(session?.user) : 1;
  const parentPresence = parentPresenceSummary({
    linkedCount: parentLinkedCount,
    ready: presencesSnapshot.status === "success" || presencesSnapshot.status === "empty",
    attended: presenceStats.attended,
    total: presenceStats.total,
    justified: presenceStats.justified,
    rate: presenceStats.rate,
  });
  const presenceRateLabel = isParent
    ? parentPresence.rate
    : metricLabelFromSnapshot(presencesSnapshot, () => `${presenceStats.rate}%`, "0%");
  const presenceMetaLabel = isParent
    ? parentPresence.meta
    : metricLabelFromSnapshot(
        presencesSnapshot,
        () => `${presenceStats.attended}/${presenceStats.total} présent(s), ${presenceStats.justified} justifié(s)`,
        "0/0 présent(s), 0 justifié(s)",
      );
  const presenceTitle = isParent
    ? parentHomeIdentityName({
        childName: parentChildNameFromSession({
          user: session?.user,
          aliasKeys: studentAliasKeys,
          rosterName: student?.name,
        }),
        linkedCount: parentLinkedCount,
      })
    : student?.name ?? "Élève";

  return (
    <View style={styles.container} testID={STUDENT_SUB_SCREENS_TEST_IDS.presencesScreen}>
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.backButton}
        testID={STUDENT_SUB_SCREENS_TEST_IDS.subScreenBackButton}
        onPress={() => navigation?.goBack()}
      >
        <Ionicons name="arrow-back" size={24} color="#0F172A" />
      </TouchableOpacity>

      <StudentSwitcher />
      <Text style={styles.title} testID={STUDENT_SUB_SCREENS_TEST_IDS.presencesTitle}>
        {STUDENT_SUB_SCREENS_COPY.presencesTitle}
      </Text>
      <Text style={styles.subtitle}>{presenceTitle}</Text>

      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.summaryCard, { backgroundColor: "#0F172A" }]}
        onPress={() => studentId && navigation?.navigate("StudentDetail", { studentId })}
      >
        <Text style={[styles.summaryLabel, { color: "#CBD5E1" }]}>Taux de présence</Text>
        <Text style={[styles.summaryValue, { color: "#FFFFFF" }]}>{presenceRateLabel}</Text>
        <Text style={[styles.summaryMeta, { color: "#CBD5E1" }]}>
          {presenceMetaLabel}
        </Text>
      </TouchableOpacity>

      {presencesSnapshot.status !== "success" ? (
        <QueryStateView
          snapshot={presencesSnapshot}
          emptyMessage={DATA_TRUTH_COPY.emptyPresences}
          errorMessage={DATA_TRUTH_COPY.errorPresences}
          offlineMessage={DATA_TRUTH_COPY.offlinePresences}
          emptyTestId={DATA_TRUTH_TEST_IDS.presencesEmpty}
          errorTestId={DATA_TRUTH_TEST_IDS.presencesError}
          onRetry={() => void loadPresences()}
        />
      ) : (
        <FlatList
          data={presencesEleve}
          keyExtractor={(item) => item.id}
          testID={STUDENT_SUB_SCREENS_TEST_IDS.presencesList}
          contentContainerStyle={listContentStyle}
          renderItem={({ item }) => {
            const status = normalizePresenceStatus(item);
            return (
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.card}
                testID={PRESENCE_ROW_TEST_ID(item.id)}
                onPress={() => studentId && navigation?.navigate("StudentDetail", { studentId })}
              >
                <Text style={styles.cardTitle}>{item.date}</Text>
                <Text style={[styles.badge, getPresenceStyle(status)]}>{status}</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

function getPresenceStyle(status: string) {
  if (status === "Présent") return localStyles.success;
  if (status === "Retard") return localStyles.warning;
  if (status === "Justifié") return localStyles.info;
  return localStyles.danger;
}

const localStyles = {
  success: { backgroundColor: "#DCFCE7", color: "#166534" },
  warning: { backgroundColor: "#FEF3C7", color: "#92400E" },
  info: { backgroundColor: "#DBEAFE", color: "#1D4ED8" },
  danger: { backgroundColor: "#FEE2E2", color: "#991B1B" },
};
