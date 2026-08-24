import { useCallback } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import PaymentReceiptCard from "../components/PaymentReceiptCard";
import PaymentMutationControls from "../components/PaymentMutationControls";
import PaymentCancelControls from "../components/PaymentCancelControls";
import { useAdminData } from "../context/AdminDataContext";
import { getPaymentStats } from "../domain/metrics/schoolMetrics";
import { DATA_TRUTH_COPY, DATA_TRUTH_TEST_IDS } from "../lib/dataTruth";
import { useFloatingTabBarLayout } from "../lib/screenLayout";

export default function PaymentsScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const { paymentsData, paymentsSnapshot, loadPayments, loadStudents, studentsData } = useAdminData();
  const paymentStats = getPaymentStats(paymentsData);
  const paymentsReady =
    paymentsSnapshot.status === "success" || paymentsSnapshot.status === "empty";

  useFocusEffect(
    useCallback(() => {
      void Promise.all([loadPayments(), loadStudents()]);
    }, [loadPayments, loadStudents]),
  );

  const showQueryState = paymentsSnapshot.status !== "success";

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
              onRetry={() => void loadPayments()}
            />
          ) : (
            <View testID={DATA_TRUTH_TEST_IDS.paymentsList}>
              <PaymentMutationControls students={studentsData} onChanged={() => loadPayments()} />
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Frais de scolarité estimés</Text>
                <Text style={styles.summaryAmount}>
                  {(paymentStats.paidAmount + paymentStats.pendingAmount).toLocaleString("fr-FR")} FC
                </Text>
                <Text style={styles.summarySub}>Reste estimé : {paymentStats.pendingAmount.toLocaleString("fr-FR")} FC</Text>
              </View>

              <View style={styles.summaryCardSecondary}>
                <Text style={styles.summaryLabelDark}>Montant encaissé</Text>
                <Text style={styles.summaryAmountDark}>{paymentStats.paidAmount.toLocaleString("fr-FR")} FC</Text>
                <Text style={styles.summarySubDark}>
                  {paymentsReady ? `${paymentStats.rate}% des paiements réglés` : "Données non chargées"}
                </Text>
              </View>

              <View style={styles.row}>
                <View style={styles.smallCard}>
                  <Text style={styles.smallNumber}>{paymentStats.paid}</Text>
                  <Text style={styles.smallLabel}>Payés</Text>
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
            <PaymentCancelControls payment={payment} onChanged={() => loadPayments()} />
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
