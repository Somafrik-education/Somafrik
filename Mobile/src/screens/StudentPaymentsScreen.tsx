import { useCallback, useMemo } from "react";
import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import StudentSwitcher from "../components/StudentSwitcher";
import QueryStateView from "../components/QueryStateView";
import PaymentReceiptCard from "../components/PaymentReceiptCard";
import { getPaymentStats } from "../domain/metrics/schoolMetrics";
import { useAdminData } from "../context/AdminDataContext";
import { DATA_TRUTH_COPY, DATA_TRUTH_TEST_IDS, paymentPaidAt } from "../lib/dataTruth";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  STUDENT_SUB_SCREENS_COPY,
  STUDENT_SUB_SCREENS_TEST_IDS,
} from "../lib/studentSubScreensSpec";
import { studentSubScreenStyles as styles } from "../lib/studentSubScreenLayout";

type Props = NativeStackScreenProps<RootStackParamList, "StudentPayments">;

export default function StudentPaymentsScreen({ route, navigation }: Partial<Props>) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const listContentStyle = [styles.listContent, { paddingBottom: scrollContentPaddingBottom }];
  const { selectedStudentId } = useAuth();
  const { paymentsData, paymentsSnapshot, loadPayments, studentsData } = useAdminData();
  const studentId = route?.params?.studentId ?? selectedStudentId;
  const student = studentId ? studentsData.find((item) => item.id === studentId) : undefined;

  useFocusEffect(
    useCallback(() => {
      void loadPayments();
    }, [loadPayments]),
  );

  const paiementsEleve = useMemo(
    () =>
      paymentsSnapshot.status === "success"
        ? paymentsData.filter((paiement) => normalizeId(paiement.studentId) === normalizeId(studentId))
        : [],
    [paymentsData, paymentsSnapshot.status, studentId],
  );
  const sortedPayments = [...paiementsEleve].sort(
    (left, right) => parsePaymentDate(paymentPaidAt(right) || right.date) - parsePaymentDate(paymentPaidAt(left) || left.date),
  );
  const paymentStats = getPaymentStats(paiementsEleve);
  const expectedTuition = paymentStats.paidAmount + paymentStats.pendingAmount;
  const showQueryState = paymentsSnapshot.status !== "success" || sortedPayments.length === 0;

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

      {paymentsSnapshot.status === "success" ? (
        <>
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
        </>
      ) : null}

      <Text style={styles.sectionTitle}>{STUDENT_SUB_SCREENS_COPY.paymentsSectionTitle}</Text>

      {showQueryState ? (
        <QueryStateView
          snapshot={
            paymentsSnapshot.status === "success" && sortedPayments.length === 0
              ? { status: "empty", data: [] }
              : paymentsSnapshot
          }
          emptyMessage={DATA_TRUTH_COPY.emptyPayments}
          errorMessage={DATA_TRUTH_COPY.errorPayments}
          offlineMessage={DATA_TRUTH_COPY.offlinePayments}
          emptyTestId={DATA_TRUTH_TEST_IDS.paymentsEmpty}
          errorTestId={DATA_TRUTH_TEST_IDS.paymentsError}
          onRetry={() => void loadPayments()}
        />
      ) : (
        <FlatList
          data={sortedPayments}
          keyExtractor={(item) => item.id}
          testID={STUDENT_SUB_SCREENS_TEST_IDS.paymentsList}
          contentContainerStyle={listContentStyle}
          renderItem={({ item }) => (
            <PaymentReceiptCard payment={item} studentName={student?.name} showItems />
          )}
        />
      )}
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
};
