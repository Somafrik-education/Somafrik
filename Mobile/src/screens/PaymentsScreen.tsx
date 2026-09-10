import { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import PaymentReceiptCard from "../components/PaymentReceiptCard";
import PaymentMutationControls from "../components/PaymentMutationControls";
import PaymentCancelControls from "../components/PaymentCancelControls";
import { useAdminData } from "../context/AdminDataContext";
import { useAuth } from "../context/AuthContext";
import { getPaymentStats } from "../domain/metrics/schoolMetrics";
import { hasSecurityPermission } from "../domain/security/permissions";
import { DATA_TRUTH_COPY, DATA_TRUTH_TEST_IDS } from "../lib/dataTruth";
import { getPaymentCashKpi } from "../lib/paymentCashKpi";
import { formatPaymentOverviewAmounts } from "../lib/paymentAmountBreakdown";
import { getPaymentRateKpi } from "../lib/paymentRateKpi";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { getFinanceCatalog, getPaymentStudentOptions } from "../services/api";
import { formatFinanceAmount, resolveFinanceCurrency } from "../lib/financeCurrency";
import { paymentStudentsFromOptions, type PaymentStudent } from "../lib/paymentEnrollment";
import { useUnpaidLedger } from "../hooks/useUnpaidLedger";
import { unpaidLedgerMetricValue, unpaidLedgerStateMessage } from "../lib/unpaidLedger";
import { financeSummaryColumns } from "../lib/financeListUx";

function moneyLabel(amount: number, ready: boolean, currency: string) {
  if (!ready) return "—";
  return formatFinanceAmount(amount, currency);
}

export default function PaymentsScreen({ navigation }: any) {
  const { session } = useAuth();
  const { width: viewportWidth } = useWindowDimensions();
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const {
    paymentsData,
    paymentsSnapshot,
    studentFeesData,
    studentFeesSnapshot,
    loadPayments,
    loadStudentFees,
    activeSchoolCode,
  } = useAdminData();
  const [paymentStudents, setPaymentStudents] = useState<PaymentStudent[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [catalogCurrency, setCatalogCurrency] = useState("");
  const paymentStats = getPaymentStats(paymentsData);
  const paymentRateKpi = getPaymentRateKpi(studentFeesData);
  const paymentAmountOverview = formatPaymentOverviewAmounts(studentFeesData);
  const cashKpi = getPaymentCashKpi(paymentsData);
  const canReadUnpaid = hasSecurityPermission(session, "Impayés", "READ");
  const requestedSchoolCode = activeSchoolCode || session?.school?.code || session?.user?.schoolCode;
  const { state: unpaidLedger } = useUnpaidLedger(canReadUnpaid, requestedSchoolCode);
  const unpaidStateMessage = unpaidLedgerStateMessage(unpaidLedger);
  const feesReady =
    studentFeesSnapshot.status === "success" || studentFeesSnapshot.status === "empty";
  const paymentsReady = paymentsSnapshot.status === "success" || paymentsSnapshot.status === "empty";

  const refreshFinance = useCallback(async () => {
    await Promise.all([
      loadPayments(),
      loadStudentFees(),
      getPaymentStudentOptions()
        .then((rows) => {
          setPaymentStudents(paymentStudentsFromOptions(rows));
        })
        .catch(() => {
          setPaymentStudents([]);
        }),
      getFinanceCatalog()
        .then((catalog) => {
          setPaymentMethods((catalog.paymentMethods ?? []).filter((row) => row.active).map((row) => row.label));
          setCatalogCurrency(resolveFinanceCurrency(catalog.currency));
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
  const expectedLabel = feesReady ? paymentAmountOverview.expectedLabel : "—";
  const remainingLabel = feesReady ? paymentAmountOverview.remainingLabel : "—";
  const rateLabel = feesReady ? paymentRateKpi.value : "—";
  const stackedSummary = financeSummaryColumns(viewportWidth) === 1;

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
          <Text style={styles.subtitle}>Vue d’ensemble</Text>
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
                currency={catalogCurrency}
                onChanged={() => refreshFinance()}
              />
              <View style={[styles.financeHero, stackedSummary && styles.financeHeroStacked]}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Montant attendu</Text>
                  <Text style={styles.summaryAmount} numberOfLines={3} adjustsFontSizeToFit>
                    {expectedLabel}
                  </Text>
                  <Text style={styles.summarySub}>Reste à payer : {remainingLabel}</Text>
                  <Text style={styles.summarySub}>{rateLabel}</Text>
                </View>

                <View style={styles.summaryCardSecondary}>
                  <Text style={styles.summaryLabelDark}>Montant encaissé</Text>
                  <Text style={styles.summaryAmountDark} numberOfLines={1} adjustsFontSizeToFit>
                    {moneyLabel(cashKpi.collectedAmount, paymentsReady, catalogCurrency)}
                  </Text>
                  <Text style={styles.summarySubDark}>
                    Imputé {moneyLabel(cashKpi.allocatedAmount, paymentsReady, catalogCurrency)} · Non imputé{" "}
                    {moneyLabel(cashKpi.unallocatedAmount, paymentsReady, catalogCurrency)}
                  </Text>
                </View>
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

                {canReadUnpaid ? (
                  <TouchableOpacity
                    style={styles.smallCard}
                    onPress={() => navigation.navigate("Unpaid")}
                    accessibilityRole="button"
                    accessibilityLabel={`Impayés : ${unpaidLedgerMetricValue(unpaidLedger)}`}
                  >
                    <Text style={styles.smallNumber}>{unpaidLedgerMetricValue(unpaidLedger)}</Text>
                    <Text style={styles.smallLabel}>Impayés</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {unpaidStateMessage ? (
                <Text style={styles.unpaidError} accessibilityRole="alert">
                  {unpaidStateMessage}
                </Text>
              ) : null}

              <Text style={styles.sectionTitle}>Paiements récents</Text>
            </View>
          )}
        </>
      }
      renderItem={({ item: payment }) => {
        const student = paymentStudents.find((row) => row.id === payment.studentId);
        return (
          <PaymentReceiptCard
            payment={payment}
            studentName={student?.name}
            currency={catalogCurrency}
            onPress={() => navigation.navigate("StudentPayments", { studentId: payment.studentId })}
            showItems={false}
            actions={<PaymentCancelControls payment={payment} onChanged={() => refreshFinance()} />}
          />
        );
      }}
      ListFooterComponent={null}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  content: { padding: 16 },
  title: { fontSize: 28, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", fontSize: 14, fontWeight: "600", marginTop: 3, marginBottom: 14 },
  financeHero: { flexDirection: "row", gap: 12, marginBottom: 12 },
  financeHeroStacked: { flexDirection: "column" },
  summaryCard: {
    flex: 1,
    backgroundColor: "#2563EB",
    borderRadius: 18,
    padding: 16,
    minHeight: 128,
  },
  summaryLabel: { color: "#DBEAFE", fontSize: 15 },
  summaryAmount: { color: "#FFFFFF", fontSize: 24, fontWeight: "800", marginTop: 8 },
  summaryAmountDark: { color: "#0F172A", fontSize: 24, fontWeight: "800", marginTop: 8 },
  summarySub: { color: "#E5E7EB", marginTop: 8 },
  summaryCardSecondary: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    minHeight: 128,
    borderWidth: 1,
    borderColor: "#D9E1EC",
  },
  summaryLabelDark: { color: "#64748B", fontSize: 15 },
  summarySubDark: { color: "#64748B", marginTop: 8 },
  row: { flexDirection: "row", gap: 10, marginBottom: 16 },
  smallCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    minHeight: 96,
    borderWidth: 1,
    borderColor: "#D9E1EC",
  },
  smallNumber: { fontSize: 24, fontWeight: "800", color: "#0F172A" },
  smallLabel: { color: "#64748B", fontWeight: "700", marginTop: 6 },
  unpaidError: { color: "#991B1B", fontSize: 13, fontWeight: "700", marginTop: -8, marginBottom: 18 },
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
