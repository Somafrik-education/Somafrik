import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import StudentSwitcher from "../components/StudentSwitcher";
import { getPaymentStats } from "../domain/metrics/schoolMetrics";
import { useAdminData } from "../context/AdminDataContext";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  PAYMENT_ROW_TEST_ID,
  STUDENT_SUB_SCREENS_COPY,
  STUDENT_SUB_SCREENS_TEST_IDS,
} from "../lib/studentSubScreensSpec";
import { studentSubScreenStyles as styles } from "../lib/studentSubScreenLayout";

type Props = NativeStackScreenProps<RootStackParamList, "StudentPayments">;

export default function StudentPaymentsScreen({ route, navigation }: Partial<Props>) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const listContentStyle = [styles.listContent, { paddingBottom: scrollContentPaddingBottom }];
  const { selectedStudentId } = useAuth();
  const { paymentsData, studentsData } = useAdminData();
  const studentId = route?.params?.studentId ?? selectedStudentId;
  const student = studentId ? studentsData.find((item) => item.id === studentId) : undefined;

  const paiementsEleve = paymentsData.filter(
    (paiement) => normalizeId(paiement.studentId) === normalizeId(studentId),
  );
  const sortedPayments = [...paiementsEleve].sort(
    (left, right) => parsePaymentDate(right.date) - parsePaymentDate(left.date),
  );
  const paymentStats = getPaymentStats(paiementsEleve);
  const expectedTuition = paymentStats.paidAmount + paymentStats.pendingAmount;

  return (
    <View style={styles.container} testID={STUDENT_SUB_SCREENS_TEST_IDS.paymentsScreen}>
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.backButton}
        testID={STUDENT_SUB_SCREENS_TEST_IDS.subScreenBackButton}
        onPress={() => navigation?.goBack()}
      >
        <Ionicons name="arrow-back" size={24} color="#0F172A" />
      </TouchableOpacity>

      <StudentSwitcher />
      <Text style={styles.title} testID={STUDENT_SUB_SCREENS_TEST_IDS.paymentsTitle}>
        {STUDENT_SUB_SCREENS_COPY.paymentsTitle}
      </Text>
      <Text style={styles.subtitle}>{student?.name ?? "Élève"}</Text>
      {student?.className ? (
        <Text style={localStyles.classLabel}>Classe : {student.className}</Text>
      ) : null}

      <View style={[styles.summaryCard, { backgroundColor: "#2563EB" }]}>
        <Text style={[styles.summaryLabel, { color: "#DBEAFE" }]}>Frais scolaires attendus</Text>
        <Text style={[styles.summaryValue, { color: "#FFFFFF" }]}>
          {expectedTuition.toLocaleString()} FC
        </Text>
      </View>

      <View style={localStyles.balanceRow}>
        <View style={localStyles.balanceCard}>
          <Text style={localStyles.balanceLabel}>Payé</Text>
          <Text style={localStyles.balanceValue}>{paymentStats.paidAmount.toLocaleString()} FC</Text>
        </View>
        <View style={[localStyles.balanceCard, localStyles.pendingCard]}>
          <Text style={localStyles.balanceLabel}>Reste à payer</Text>
          <Text style={[localStyles.balanceValue, localStyles.pendingValue]}>
            {paymentStats.pendingAmount.toLocaleString()} FC
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>{STUDENT_SUB_SCREENS_COPY.paymentsSectionTitle}</Text>

      <FlatList
        data={sortedPayments}
        keyExtractor={(item) => item.id}
        testID={STUDENT_SUB_SCREENS_TEST_IDS.paymentsList}
        contentContainerStyle={listContentStyle}
        ListEmptyComponent={
          <Text style={styles.empty} testID={STUDENT_SUB_SCREENS_TEST_IDS.paymentsEmpty}>
            {STUDENT_SUB_SCREENS_COPY.paymentsEmpty}
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card} testID={PAYMENT_ROW_TEST_ID(item.id)}>
            <View style={localStyles.cardContent}>
              <Text style={styles.cardTitle}>{item.amount.toLocaleString()} FC</Text>
              <Text style={styles.cardMeta}>Référence : {item.publicId ?? item.id}</Text>
              <Text style={styles.cardMeta}>Date : {item.date}</Text>
              <Text style={styles.cardMeta}>Mode : {item.method ?? "Non renseigné"}</Text>
            </View>
            <Text style={[styles.badge, item.status === "PAYE" ? localStyles.success : localStyles.warning]}>
              {item.status === "PAYE" ? "Payé" : "En attente"}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

function normalizeId(value?: string | null) {
  return String(value ?? "").trim().toUpperCase();
}

function parsePaymentDate(value?: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) {
    return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])).getTime();
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

const localStyles = {
  classLabel: {
    marginTop: 4,
    marginBottom: 20,
    color: "#2563EB",
    fontWeight: "800" as const,
  },
  balanceRow: {
    flexDirection: "row" as const,
    gap: 12,
    marginBottom: 18,
  },
  balanceCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
  },
  pendingCard: { backgroundColor: "#FFF7ED" },
  balanceLabel: { color: "#64748B", fontWeight: "800" as const },
  balanceValue: {
    marginTop: 6,
    color: "#16A34A",
    fontWeight: "900" as const,
    fontSize: 18,
  },
  pendingValue: { color: "#EA580C" },
  cardContent: { flex: 1, minWidth: 0 },
  success: { backgroundColor: "#DCFCE7", color: "#166534" },
  warning: { backgroundColor: "#FEF3C7", color: "#92400E" },
};
