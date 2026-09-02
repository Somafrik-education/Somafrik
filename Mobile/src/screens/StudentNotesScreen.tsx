import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import StudentSwitcher from "../components/StudentSwitcher";
import { useAdminData } from "../context/AdminDataContext";
import QueryStateView from "../components/QueryStateView";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  NOTE_ROW_TEST_ID,
  STUDENT_SUB_SCREENS_COPY,
  STUDENT_SUB_SCREENS_TEST_IDS,
} from "../lib/studentSubScreensSpec";
import { studentSubScreenStyles as styles } from "../lib/studentSubScreenLayout";
import { DATA_TRUTH_TEST_IDS } from "../lib/dataTruth";
import {
  canonicalWeightedAverage,
  EVALUATIONS_V2_COPY,
  EVALUATIONS_V2_TEST_IDS,
  notesForStudent,
} from "../lib/evaluationsV2";

type Props = NativeStackScreenProps<RootStackParamList, "StudentNotes">;

export default function StudentNotesScreen({ route, navigation }: Partial<Props>) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const listContentStyle = [styles.listContent, { paddingBottom: scrollContentPaddingBottom }];
  const { selectedStudentId } = useAuth();
  const { studentsData, notesSnapshot, loadNotes } = useAdminData();
  const studentId = route?.params?.studentId ?? selectedStudentId;
  const student = studentId ? studentsData.find((item) => item.id === studentId) : undefined;

  useFocusEffect(
    useCallback(() => {
      void loadNotes();
    }, [loadNotes]),
  );

  const studentNotes = studentId ? notesForStudent(notesSnapshot.data, studentId) : [];
  const average = canonicalWeightedAverage(studentNotes);

  return (
    <View style={styles.container} testID={STUDENT_SUB_SCREENS_TEST_IDS.notesScreen}>
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.backButton}
        testID={STUDENT_SUB_SCREENS_TEST_IDS.subScreenBackButton}
        onPress={() => navigation?.goBack()}
      >
        <Ionicons name="arrow-back" size={24} color="#0F172A" />
      </TouchableOpacity>

      <StudentSwitcher />
      <Text style={styles.title} testID={STUDENT_SUB_SCREENS_TEST_IDS.notesTitle}>
        {STUDENT_SUB_SCREENS_COPY.notesTitle}
      </Text>
      <Text style={styles.subtitle}>{student?.name ?? "Élève"}</Text>

      <View style={[styles.summaryCard, { backgroundColor: "#2563EB" }]}>
        <Text style={[styles.summaryLabel, { color: "#DBEAFE" }]}>Moyenne générale</Text>
        <Text
          style={[styles.summaryValue, { color: "#FFFFFF" }]}
          testID={EVALUATIONS_V2_TEST_IDS.average}
        >
          {average.available ? `${average.average?.toFixed(1)}/20` : EVALUATIONS_V2_COPY.averageUnavailable}
        </Text>
        <Text style={[styles.summaryMeta, { color: "#DBEAFE" }]}>
          {average.available ? `Coef. ${average.totalCoefficients}` : "Notes publiées uniquement"}
        </Text>
      </View>

      {notesSnapshot.status !== "success" ? (
        <QueryStateView
          snapshot={notesSnapshot}
          emptyMessage={STUDENT_SUB_SCREENS_COPY.notesEmpty}
          errorMessage={EVALUATIONS_V2_COPY.errorNotes}
          offlineMessage={EVALUATIONS_V2_COPY.offlineNotes}
          emptyTestId={DATA_TRUTH_TEST_IDS.notesEmpty}
          errorTestId={DATA_TRUTH_TEST_IDS.notesError}
          onRetry={() => void loadNotes()}
        />
      ) : (
        <FlatList
          data={studentNotes}
          keyExtractor={(item) => item.id || `${item.evaluationId}-${item.studentId}`}
          testID={STUDENT_SUB_SCREENS_TEST_IDS.notesList}
          contentContainerStyle={listContentStyle}
          ListEmptyComponent={
            <Text style={styles.empty} testID={STUDENT_SUB_SCREENS_TEST_IDS.notesEmpty}>
              {STUDENT_SUB_SCREENS_COPY.notesEmpty}
            </Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.card}
              testID={NOTE_ROW_TEST_ID(item.id)}
              onPress={() => studentId && navigation?.navigate("StudentDetail", { studentId })}
            >
              <View>
                <Text style={styles.cardTitle}>{item.evaluationTitle || item.subject || "Évaluation"}</Text>
                <Text style={styles.cardMeta}>
                  {item.period ?? "Période"} • {item.status} • /{item.scale}
                </Text>
              </View>
              <Text style={localStyles.grade}>
                {item.value != null ? `${item.value}/${item.scale}` : item.status}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const localStyles = {
  grade: {
    fontSize: 22,
    fontWeight: "900" as const,
    color: "#16A34A",
  },
};
