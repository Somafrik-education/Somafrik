import { useCallback } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import PaymentReceiptCard from "../components/PaymentReceiptCard";
import { useAdminData } from "../context/AdminDataContext";
import { getPaymentStats } from "../domain/metrics/schoolMetrics";
import { useAuth } from "../context/AuthContext";
import { canMutateEntity, canReadEntity } from "../domain/security/permissions";
import { DATA_TRUTH_COPY, DATA_TRUTH_TEST_IDS } from "../lib/dataTruth";
import { useFloatingTabBarLayout } from "../lib/screenLayout";

export default function PaymentsScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const { session } = useAuth();
  const { paymentsData, paymentsSnapshot, loadPayments, studentsData } = useAdminData();
  const paymentStats = getPaymentStats(paymentsData);
  const canCreate = canMutateEntity(session, "payments", "CREATE");
  const canUpdate = canMutateEntity(session, "payments", "UPDATE");
  const canReadPayments = canReadEntity(session, "payments");
  const canOpenPaymentAdmin = canReadPayments || canCreate || canUpdate;
  const paymentsReady =
    paymentsSnapshot.status === "success" || paymentsSnapshot.status === "empty";

  useFocusEffect(
    useCallback(() => {
      void loadPayments();
    }, [loadPayments]),
  );

  const showQueryState = paymentsSnapshot.status !== "success";

  return (
    <ScrollView style={styles.container} contentContainerStyle={contentStyle}>
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
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.summaryCard}
            onPress={() => canOpenPaymentAdmin && navigation.navigate("AdminCrud", { entity: "payments" })}
          >
            <Text style={styles.summaryLabel}>Frais de scolarité estimés</Text>
            <Text style={styles.summaryAmount}>
              {(paymentStats.paidAmount + paymentStats.pendingAmount).toLocaleString()} FC
            </Text>
            <Text style={styles.summarySub}>Reste estimé : {paymentStats.pendingAmount.toLocaleString()} FC</Text>
          </TouchableOpacity>

          <View style={styles.summaryCardSecondary}>
            <Text style={styles.summaryLabelDark}>Montant encaissé</Text>
            <Text style={styles.summaryAmountDark}>{paymentStats.paidAmount.toLocaleString()} FC</Text>
            <Text style={styles.summarySubDark}>
              {paymentsReady ? `${paymentStats.rate}% des paiements réglés` : "Données non chargées"}
            </Text>
          </View>

          <View style={styles.row}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.smallCard}
              onPress={() => canOpenPaymentAdmin && navigation.navigate("AdminCrud", { entity: "payments", filter: "paid" })}
            >
              <Text style={styles.smallNumber}>{paymentStats.paid}</Text>
              <Text style={styles.smallLabel}>Payés</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.smallCard}
              onPress={() =>
                canOpenPaymentAdmin && navigation.navigate("AdminCrud", { entity: "payments", filter: "pending" })
              }
            >
              <Text style={styles.smallNumber}>{paymentStats.pending}</Text>
              <Text style={styles.smallLabel}>Impayés</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionTitle}>Reçus récents</Text>

          {paymentsData.map((payment) => {
            const student = studentsData.find((item) => item.id === payment.studentId);
            return (
              <PaymentReceiptCard
                key={payment.id}
                payment={payment}
                studentName={student?.name}
                onPress={() => navigation.navigate("StudentPayments", { studentId: payment.studentId })}
                showItems={false}
              />
            );
          })}
        </View>
      )}

      {canCreate && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.button}
          onPress={() =>
            Alert.alert("Saisie indisponible", DATA_TRUTH_COPY.writePaymentsWebOnly)
          }
        >
          <Text style={styles.buttonText}>Enregistrer un paiement</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
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
