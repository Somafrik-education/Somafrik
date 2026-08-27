import { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import PaymentReceiptCard from "../components/PaymentReceiptCard";
import PaymentMutationControls from "../components/PaymentMutationControls";
import PaymentCancelControls from "../components/PaymentCancelControls";
import { useAdminData } from "../context/AdminDataContext";
import { getPaymentStats } from "../domain/metrics/schoolMetrics";
import { DATA_TRUTH_COPY, DATA_TRUTH_TEST_IDS } from "../lib/dataTruth";
import { getPaymentCashKpi } from "../lib/paymentCashKpi";
import { getPaymentRateKpi } from "../lib/paymentRateKpi";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { getFinanceCatalog, getPaymentStudentOptions } from "../services/api";
import type { PaymentStudent } from "../lib/paymentEnrollment";

function moneyLabel(amount: number, ready: boolean) {
  return ready ? `${amount.toLocaleString("fr-FR")} FC` : "—";
}

export default function PaymentsScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const {
    paymentsData,
    paymentsSnapshot,
    studentFeesData,
    studentFeesSnapshot,
    loadPayments,
    loadStudentFees,
  } = useAdminData();
  const [paymentStudents, setPaymentStudents] = useState<PaymentStudent[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const paymentStats = getPaymentStats(paymentsData);
  const paymentRateKpi = getPaymentRateKpi(studentFeesData);
  const cashKpi = getPaymentCashKpi(paymentsData);
  const feesReady =
    studentFeesSnapshot.status === "success" || studentFeesSnapshot.status === "empty";
  const paymentsReady = paymentsSnapshot.status === "success" || paymentsSnapshot.status === "empty";

  const refreshFinance = useCallback(async () => {
    await Promise.all([
      loadPayments(),
      loadStudentFees(),
      getPaymentStudentOptions()
        .then((rows) => {
          setPaymentStudents(
            rows.map((row) => ({
              id: row.studentId,
              name: `${row.firstName} ${row.lastName}`.trim(),
              classId: row.classId,
              classCode: row.classCode,
              className: row.className,
              enrollments: (row.classes ?? []).map((klass) => ({
                status: "active",
                classId: klass.classId,
                classCode: klass.classCode,
                className: klass.className,
              })),
            })),
          );
        })
        .catch(() => {
          setPaymentStudents([]);
        }),
      getFinanceCatalog()
        .then((catalog) => {
          setPaymentMethods((catalog.paymentMethods ?? []).filter((row) => row.active).map((row) => row.label));
        })
        .catch(() => {
          setPaymentMethods([]);
        }),
    ]);
  }, [loadPayments, loadStudentFees]);

  useFocusEffect(
    useCallback(() => {
      void refreshFinance();
    }, [refreshFinance]),
  );

  const showQueryState = paymentsSnapshot.status !== "success";
  const expectedLabel =
    feesReady && paymentRateKpi.expectedAmount > 0
      ? `${paymentRateKpi.expectedAmount.toLocaleString("fr-FR")} FC`
      : "—";
  const remaining = Math.max(0, paymentRateKpi.expectedAmount - paymentRateKpi.collectedAmount);
  const remainingLabel =
    feesReady && paymentRateKpi.expectedAmount > 0
      ? `${remaining.toLocaleString("fr-FR")} FC`
      : "—";
  const rateLabel = feesReady ? paymentRateKpi.value : "—";

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={contentStyle}
      data={showQueryState ? [] : paymentsData}
      keyExtractor={(payment) => String(payment.id)}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          <Text style={styles.title}>Paiements</Text>
          {showQueryState ? (
            <QueryStateView
              snapshot={paymentsSnapshot}
              emptyMessage={DATA_TRUTH_COPY.emptyPayments}
              errorMessage={DATA_TRUTH_COPY.errorPayments}
              offlineMessage={DATA_TRUTH_COPY.offlinePayments}
              emptyTestId={DATA_TRUTH_TEST_IDS.paymentsEmpty}
              errorTestId={DATA_TRUTH_TEST_IDS.paymentsError}
              onRetry={() => void refreshFinance()}
            />
          ) : (
            <View testID={DATA_TRUTH_TEST_IDS.paymentsList}>
              <PaymentMutationControls
                students={paymentStudents}
                studentFees={studentFeesData}
                paymentMethods={paymentMethods}
                onChanged={() => refreshFinance()}
              />
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Frais de scolarité estimés</Text>
                <Text style={styles.summaryAmount}>{expectedLabel}</Text>
                <Text style={styles.summarySub}>Reste estimé : {remainingLabel}</Text>
                <Text style={styles.summarySub}>{rateLabel}</Text>
              </View>

              <View style={styles.summaryCardSecondary}>
                <Text style={styles.summaryLabelDark}>Encaissé</Text>
                <Text style={styles.summaryAmountDark}>{moneyLabel(cashKpi.collectedAmount, paymentsReady)}</Text>
                <Text style={styles.summarySubDark}>
                  Imputé {moneyLabel(cashKpi.allocatedAmount, paymentsReady)} · Non imputé{" "}
                  {moneyLabel(cashKpi.unallocatedAmount, paymentsReady)}
                </Text>
              </View>

              <View style={styles.row}>
                <View style={styles.smallCard}>
                  <Text style={styles.smallNumber}>{paymentStats.paid}</Text>
                  <Text style={styles.smallLabel}>Payés</Text>
                </View>

                <View style={styles.smallCard}>
                  <Text style={styles.smallNumber}>{paymentStats.unallocated}</Text>
                  <Text style={styles.smallLabel}>Non imputés</Text>
                </View>

                <View style={styles.smallCard}>
                  <Text style={styles.smallNumber}>{paymentStats.pending}</Text>
                  <Text style={styles.smallLabel}>Impayés</Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>Reçus récents</Text>
            </View>
          )}
        </>
      }
      renderItem={({ item: payment }) => {
        const student = studentsData.find((row) => row.id === payment.studentId);
        return (
          <>
            <PaymentReceiptCard
              payment={payment}
              studentName={student?.name}
              onPress={() => navigation.navigate("StudentPayments", { studentId: payment.studentId })}
              showItems={false}
            />
            <PaymentCancelControls payment={payment} onChanged={() => refreshFinance()} />
          </>
        );
      }}
      ListFooterComponent={null}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  content: { padding: 20 },
  title: { fontSize: 28, fontWeight: "800", color: "#111827", marginBottom: 20 },
  summaryCard: {
    backgroundColor: "#2563EB",
    borderRadius: 24,
    padding: 24,
    marginBottom: 18,
  },
  summaryLabel: { color: "#DBEAFE", fontSize: 15 },
  summaryAmount: { color: "#FFFFFF", fontSize: 32, fontWeight: "800", marginTop: 8 },
  summaryAmountDark: { color: "#0F172A", fontSize: 32, fontWeight: "800", marginTop: 8 },
  summarySub: { color: "#E5E7EB", marginTop: 8 },
  summaryCardSecondary: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 24,
    marginBottom: 18,
  },
  summaryLabelDark: { color: "#64748B", fontSize: 15 },
  summarySubDark: { color: "#64748B", marginTop: 8 },
  row: { flexDirection: "row", gap: 12, marginBottom: 18 },
  smallCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
  },
  smallNumber: { fontSize: 28, fontWeight: "800", color: "#0F172A" },
  smallLabel: { color: "#64748B", fontWeight: "700", marginTop: 6 },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: "#0F172A", marginBottom: 12 },
  button: {
    marginTop: 8,
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  buttonText: { color: "#FFFFFF", fontWeight: "800" },
});
