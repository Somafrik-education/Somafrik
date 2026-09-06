import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import StudentSwitcher from "../components/StudentSwitcher";
import { getPresenceStats, normalizePresenceStatus } from "../domain/metrics/schoolMetrics";
import { useAdminData } from "../context/AdminDataContext";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  PRESENCE_ROW_TEST_ID,
  STUDENT_SUB_SCREENS_COPY,
  STUDENT_SUB_SCREENS_TEST_IDS,
} from "../lib/studentSubScreensSpec";
import { metricLabelFromSnapshot } from "../lib/dataTruth";
import { studentSubScreenStyles as styles } from "../lib/studentSubScreenLayout";
import { findStudentByIdentity, sessionStudentAliasKeys } from "../lib/canonicalStudentIdentity";

type Props = NativeStackScreenProps<RootStackParamList, "StudentPresences">;

export default function StudentPresencesScreen({ route, navigation }: Partial<Props>) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const listContentStyle = [styles.listContent, { paddingBottom: scrollContentPaddingBottom }];
  const { session, selectedStudentId } = useAuth();
  const { studentsData, presencesData, loadPresences, loadStudents, presencesSnapshot, resourceScopeKey } = useAdminData();
  const studentId = route?.params?.studentId ?? selectedStudentId;
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
  const presenceRateLabel = metricLabelFromSnapshot(presencesSnapshot, () => `${presenceStats.rate}%`, "0%");
  const presenceMetaLabel = metricLabelFromSnapshot(
    presencesSnapshot,
    () => `${presenceStats.attended}/${presenceStats.total} présent(s), ${presenceStats.justified} justifié(s)`,
    "0/0 présent(s), 0 justifié(s)",
  );

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
      <Text style={styles.subtitle}>{student?.name ?? "Élève"}</Text>

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

      <FlatList
        data={presencesEleve}
        keyExtractor={(item) => item.id}
        testID={STUDENT_SUB_SCREENS_TEST_IDS.presencesList}
        contentContainerStyle={listContentStyle}
        ListEmptyComponent={
          <Text style={styles.empty} testID={STUDENT_SUB_SCREENS_TEST_IDS.presencesEmpty}>
            {STUDENT_SUB_SCREENS_COPY.presencesEmpty}
          </Text>
        }
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
