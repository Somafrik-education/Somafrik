import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import StudentSwitcher from "../components/StudentSwitcher";
import { GradeBookService } from "../domain/academics/GradeBookService";
import { useAdminData } from "../context/AdminDataContext";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  NOTE_ROW_TEST_ID,
  STUDENT_SUB_SCREENS_COPY,
  STUDENT_SUB_SCREENS_TEST_IDS,
} from "../lib/studentSubScreensSpec";
import { studentSubScreenStyles as styles } from "../lib/studentSubScreenLayout";

type Props = NativeStackScreenProps<RootStackParamList, "StudentNotes">;

export default function StudentNotesScreen({ route, navigation }: Partial<Props>) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const listContentStyle = [styles.listContent, { paddingBottom: scrollContentPaddingBottom }];
  const { selectedStudentId } = useAuth();
  const { studentsData, notesData, coursesData } = useAdminData();
  const studentId = route?.params?.studentId ?? selectedStudentId;
  const student = studentId ? studentsData.find((item) => item.id === studentId) : undefined;
  const gradeBook = new GradeBookService(studentsData, notesData, coursesData);
  const studentNotes = notesData.filter((note) => note.studentId === studentId);
  const report = studentId ? gradeBook.generateReport(studentId, "Trimestre 1", "Publié") : undefined;

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

      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.summaryCard, { backgroundColor: "#2563EB" }]}
        onPress={() => studentId && navigation?.navigate("StudentDetail", { studentId })}
      >
        <Text style={[styles.summaryLabel, { color: "#DBEAFE" }]}>Moyenne générale</Text>
        <Text style={[styles.summaryValue, { color: "#FFFFFF" }]}>
          {(report?.average ?? 0).toFixed(1)}/20
        </Text>
        <Text style={[styles.summaryMeta, { color: "#DBEAFE" }]}>
          {report?.rankLabel ?? "-"} • {report?.appreciation ?? "Aucune appréciation"}
        </Text>
      </TouchableOpacity>

      <View style={localStyles.reportRow}>
        <View style={localStyles.reportPill}>
          <Text style={localStyles.reportValue}>{(report?.totalPoints ?? 0).toFixed(1)}</Text>
          <Text style={localStyles.reportLabel}>Points</Text>
        </View>
        <View style={localStyles.reportPill}>
          <Text style={localStyles.reportValue}>{report?.totalCoefficients ?? 0}</Text>
          <Text style={localStyles.reportLabel}>Coefficients</Text>
        </View>
        <View style={localStyles.reportPill}>
          <Text style={localStyles.reportValue}>{report?.status ?? "Brouillon"}</Text>
          <Text style={localStyles.reportLabel}>Bulletin</Text>
        </View>
      </View>

      <FlatList
        data={studentNotes}
        keyExtractor={(item) => item.id}
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
              <Text style={styles.cardTitle}>{item.subject}</Text>
              <Text style={styles.cardMeta}>
                Période {item.period ?? "Non renseignée"} • Coef. {item.coefficient} • {item.date}
              </Text>
            </View>
            <Text style={localStyles.grade}>{item.value}/20</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const localStyles = {
  reportRow: {
    flexDirection: "row" as const,
    gap: 8,
    marginBottom: 16,
  },
  reportPill: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
  },
  reportValue: {
    color: "#0F172A",
    fontWeight: "900" as const,
    fontSize: 16,
  },
  reportLabel: {
    color: "#64748B",
    fontWeight: "800" as const,
    fontSize: 11,
    marginTop: 4,
  },
  grade: {
    fontSize: 22,
    fontWeight: "900" as const,
    color: "#16A34A",
  },
};
