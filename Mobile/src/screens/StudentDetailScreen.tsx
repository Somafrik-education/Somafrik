import {
  ScrollView,
  Text,
  StyleSheet,
  View,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import StudentSwitcher from "../components/StudentSwitcher";
import { canReadRoute } from "../domain/security/permissions";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  CLASSES_STUDENT_TEST_IDS,
} from "../lib/classesStudentJourneySpec";
import { STUDENT_SUB_SCREENS_TEST_IDS } from "../lib/studentSubScreensSpec";
import { metricLabelFromSnapshot } from "../lib/dataTruth";
import { studentDisplayName } from "../lib/studentDisplayName";
import { normalizePresenceStatus } from "../domain/metrics/schoolMetrics";

type Props = NativeStackScreenProps<
  RootStackParamList,
  "StudentDetail"
>;

export default function StudentDetailScreen({
  route,
  navigation,
}: Partial<Props>) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const containerStyle = [styles.container, { paddingBottom: scrollContentPaddingBottom }];
  const { session, selectedStudentId } = useAuth();
  const { studentsData, notesData, presencesData, paymentsData, loadStudents, loadPresences, loadNotes, loadPayments, studentsSnapshot, notesSnapshot, presencesSnapshot, paymentsSnapshot, resourceScopeKey } = useAdminData();
  const studentId = route?.params?.studentId ?? selectedStudentId;
  const canSeeNotes = canReadRoute(session, "StudentNotes");
  const canSeePresences = canReadRoute(session, "StudentPresences");
  const canSeePayments = canReadRoute(session, "StudentPayments");

  useFocusEffect(
    useCallback(() => {
      void loadStudents();
      void loadPresences();
      void loadNotes();
      void loadPayments();
    }, [loadStudents, loadPresences, loadNotes, loadPayments, resourceScopeKey]),
  );

  const student = studentId ? studentsData.find((item) => item.id === studentId) : undefined;

  if (!student) {
    return (
      <View style={styles.container} testID={CLASSES_STUDENT_TEST_IDS.studentDetailScreen}>
        <Text>
          {studentsSnapshot.status === "idle" || studentsSnapshot.status === "loading"
            ? "Chargement…"
            : studentsSnapshot.status === "error" || studentsSnapshot.status === "offline"
              ? "Indisponible"
              : "Élève introuvable"}
        </Text>
      </View>
    );
  }

  const studentNotes = notesData.filter((item) => item.studentId === student.id);
  const studentPresences = presencesData.filter((item) => item.studentId === student.id);
  const presentCount = studentPresences.filter(
    (item) => {
      const status = normalizePresenceStatus(item);
      return status === "Présent" || status === "Retard";
    },
  ).length;
  const studentPayments = paymentsData.filter((item) => item.studentId === student.id);
  const notesValue = metricLabelFromSnapshot(notesSnapshot, () => String(studentNotes.length));
  const presencesValue = metricLabelFromSnapshot(presencesSnapshot, () => String(presentCount));
  const paymentsDetail = metricLabelFromSnapshot(paymentsSnapshot, () => `${studentPayments.length} opération(s)`);
  const displayName = studentDisplayName(student);

  const openSubScreen = (screen: "StudentNotes" | "StudentPresences" | "StudentPayments") => {
    navigation?.navigate(screen, { studentId: student.id });
  };

  return (
    <ScrollView
      contentContainerStyle={containerStyle}
      testID={CLASSES_STUDENT_TEST_IDS.studentDetailScreen}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.backButton}
        testID={CLASSES_STUDENT_TEST_IDS.studentDetailBackButton}
        onPress={() => navigation?.goBack()}
        accessibilityRole="button"
        accessibilityLabel={`Retour depuis la fiche de ${displayName}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="arrow-back" size={24} color="#0F172A" />
      </TouchableOpacity>

      <StudentSwitcher />

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{displayName.charAt(0)}</Text>
        </View>

        <View style={styles.profileInfo}>
          <Text style={styles.title} testID={CLASSES_STUDENT_TEST_IDS.studentDetailName}>
            {displayName}
          </Text>
          <Text style={styles.info}>Matricule : {student.matricule}</Text>
          <Text style={styles.info}>Sexe : {String(student.gender ?? "").trim() || "Non renseigné"}</Text>
          <Text style={styles.info} testID={CLASSES_STUDENT_TEST_IDS.studentDetailClass}>
            Classe : {student.className}
          </Text>
          <Text style={styles.info}>Établissement : {student.schoolCode}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        {canSeeNotes && (
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.statCard}
            testID="student-detail-notes-stat"
            onPress={() => openSubScreen("StudentNotes")}
          >
            <Text style={styles.statValue}>
              {notesValue}
            </Text>
            <Text style={styles.statLabel}>Notes</Text>
          </TouchableOpacity>
        )}

        {canSeePresences && (
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.statCard}
            testID="student-detail-presences-stat"
            onPress={() => openSubScreen("StudentPresences")}
          >
            <Text style={styles.statValue}>
              {presencesValue}
            </Text>
            <Text style={styles.statLabel}>Présences</Text>
          </TouchableOpacity>
        )}
      </View>

      {canSeeNotes && (
        <StudentAction
          icon="book-outline"
          label="Notes"
          detail="Bulletins et évaluations"
          testID={STUDENT_SUB_SCREENS_TEST_IDS.openNotesButton}
          onPress={() => openSubScreen("StudentNotes")}
        />
      )}

      {canSeePresences && (
        <StudentAction
          icon="calendar-outline"
          label="Présences"
          detail="Suivi des absences"
          testID={STUDENT_SUB_SCREENS_TEST_IDS.openPresencesButton}
          onPress={() => openSubScreen("StudentPresences")}
        />
      )}

      {canSeePayments && (
        <StudentAction
          icon="card-outline"
          label="Paiements"
          detail={paymentsDetail}
          testID={STUDENT_SUB_SCREENS_TEST_IDS.openPaymentsButton}
          onPress={() => openSubScreen("StudentPayments")}
        />
      )}
    </ScrollView>
  );
}

type StudentActionProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  testID?: string;
  onPress: () => void;
};

function StudentAction({ icon, label, detail, testID, onPress }: StudentActionProps) {
  return (
    <TouchableOpacity
      style={styles.menuButton}
      onPress={onPress}
      activeOpacity={0.85}
      testID={testID}
    >
      <View style={styles.menuIcon}>
        <Ionicons name={icon} size={22} color="#2563EB" />
      </View>
      <View style={styles.menuContent}>
        <Text style={styles.menuText}>{label}</Text>
        <Text style={styles.menuDetail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward-outline" size={20} color="#CBD5E1" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: "#F8FAFC",
  },
  backButton: {
    minWidth: 44,
    minHeight: 44,
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  profileCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  avatarText: {
    fontSize: 26,
    fontWeight: "900",
    color: "#2563EB",
  },
  profileInfo: {
    flex: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    marginBottom: 10,
    color: "#0F172A",
  },
  info: {
    fontSize: 14,
    marginBottom: 5,
    color: "#64748B",
    fontWeight: "700",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  statCard: {
    width: "48%",
    backgroundColor: "#0F172A",
    borderRadius: 20,
    padding: 18,
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
  },
  statLabel: {
    color: "#CBD5E1",
    marginTop: 4,
    fontWeight: "700",
  },
  menuButton: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 20,
    marginTop: 15,
    flexDirection: "row",
    alignItems: "center",
  },
  menuIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  menuContent: {
    flex: 1,
  },
  menuText: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0F172A",
  },
  menuDetail: {
    marginTop: 3,
    color: "#64748B",
    fontWeight: "600",
  },
});
