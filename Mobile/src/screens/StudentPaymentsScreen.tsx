import { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, ScrollView, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import StudentSwitcher from "../components/StudentSwitcher";
import QueryStateView from "../components/QueryStateView";
import PaymentReceiptCard from "../components/PaymentReceiptCard";
import PaymentMutationControls from "../components/PaymentMutationControls";
import PaymentCancelControls from "../components/PaymentCancelControls";
import { useAdminData } from "../context/AdminDataContext";
import { DATA_TRUTH_COPY, DATA_TRUTH_TEST_IDS, paymentPaidAt } from "../lib/dataTruth";
import { getPaymentCashKpi } from "../lib/paymentCashKpi";
import { getPaymentRateKpi } from "../lib/paymentRateKpi";
import { paymentStudentsFromOptions, type PaymentStudent } from "../lib/paymentEnrollment";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { getFinanceCatalog, getPaymentStudentOptions } from "../services/api";
import { formatFinanceAmount, resolveFinanceCurrency } from "../lib/financeCurrency";
import {
  STUDENT_PAYMENTS_KPI_DENSITY as KPI,
  STUDENT_SUB_SCREENS_COPY,
  STUDENT_SUB_SCREENS_TEST_IDS,
} from "../lib/studentSubScreensSpec";
import { studentSubScreenStyles as styles } from "../lib/studentSubScreenLayout";

type Props = NativeStackScreenProps<RootStackParamList, "StudentPayments">;

export default function StudentPaymentsScreen({ route, navigation }: Partial<Props>) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const listContentStyle = [styles.listContent, { paddingBottom: scrollContentPaddingBottom }];
  const { selectedStudentId } = useAuth();
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
  const [catalogCurrency, setCatalogCurrency] = useState("");
  const studentId = route?.params?.studentId ?? selectedStudentId;
  const pickerStudents: PaymentStudent[] = paymentStudents;
  const student = studentId ? pickerStudents.find((item) => item.id === studentId) : undefined;

  const refreshFinance = useCallback(async () => {
    await Promise.all([
      loadPayments(),
      loadStudentFees(),
      getPaymentStudentOptions()
        .then((rows) => setPaymentStudents(paymentStudentsFromOptions(rows)))
        .catch(() => setPaymentStudents([])),
      getFinanceCatalog()
        .then((catalog) => {
          setPaymentMethods(
            (catalog.paymentMethods ?? []).filter((row) => row.active).map((row) => row.label),
          );
          setCatalogCurrency(resolveFinanceCurrency(catalog.currency));
        })
        .catch(() => setPaymentMethods([])),
    ]);
  }, [loadPayments, loadStudentFees]);

  useFocusEffect(
    useCallback(() => {
      void refreshFinance();
    }, [refreshFinance]),
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
  const studentFees = studentFeesData.filter(
    (fee) => normalizeId(fee.studentId) === normalizeId(studentId),
  );
  const paymentRateKpi = getPaymentRateKpi(studentFees);
  const cashKpi = getPaymentCashKpi(paiementsEleve);
  const feesReady =
    studentFeesSnapshot.status === "success" || studentFeesSnapshot.status === "empty";
  const paymentsReady = paymentsSnapshot.status === "success" || paymentsSnapshot.status === "empty";
  const expectedLabel =
    feesReady && paymentRateKpi.expectedAmount > 0
      ? formatFinanceAmount(paymentRateKpi.expectedAmount, catalogCurrency)
      : "—";
  const imputedLabel =
    feesReady && paymentRateKpi.expectedAmount > 0
      ? formatFinanceAmount(paymentRateKpi.collectedAmount, catalogCurrency)
      : "—";
  const remaining = Math.max(0, paymentRateKpi.expectedAmount - paymentRateKpi.collectedAmount);
  const remainingLabel =
    feesReady && paymentRateKpi.expectedAmount > 0
      ? formatFinanceAmount(remaining, catalogCurrency)
      : "—";
  const collectedLabel = paymentsReady ? formatFinanceAmount(cashKpi.collectedAmount, catalogCurrency) : "—";
  const unallocatedLabel = paymentsReady ? formatFinanceAmount(cashKpi.unallocatedAmount, catalogCurrency) : "—";
  const showQueryState = paymentsSnapshot.status !== "success" || sortedPayments.length === 0;

  const financeHeader = (
    <>
      <StudentSwitcher />
      <Text style={[styles.title, localStyles.title]} testID={STUDENT_SUB_SCREENS_TEST_IDS.paymentsTitle}>
        {STUDENT_SUB_SCREENS_COPY.paymentsTitle}
      </Text>
      <Text
        style={[
          styles.subtitle,
          student?.className ? localStyles.subtitleWithClass : localStyles.subtitleSolo,
        ]}
      >
        {student?.name ?? "Élève"}
      </Text>
      {student?.className ? (
        <Text style={localStyles.classLabel}>Classe : {student.className}</Text>
      ) : null}
      <PaymentMutationControls
        students={pickerStudents}
        studentFees={studentFeesData}
        paymentMethods={paymentMethods}
        currency={catalogCurrency}
        initialStudentId={studentId ? String(studentId) : ""}
        onChanged={() => refreshFinance()}
      />

      {feesReady ? (
        <>
          <View
            style={localStyles.heroCard}
            testID={STUDENT_SUB_SCREENS_TEST_IDS.paymentsKpiHero}
            accessibilityRole="summary"
            accessibilityLabel={`Frais scolaires attendus ${expectedLabel}`}
          >
            <Text style={localStyles.heroLabel}>Montant attendu</Text>
            <Text style={localStyles.heroValue} selectable>
              {expectedLabel}
            </Text>
          </View>

          <View style={localStyles.kpiGrid} testID={STUDENT_SUB_SCREENS_TEST_IDS.paymentsKpiGrid}>
            <View style={localStyles.kpiRow}>
              <KpiMiniCard label="Imputé" value={imputedLabel} valueColor="#16A34A" />
              <KpiMiniCard
                label="Reste à payer"
                value={remainingLabel}
                valueColor="#EA580C"
                backgroundColor="#FFF7ED"
              />
            </View>
            <View style={localStyles.kpiRow}>
              <KpiMiniCard label="Encaissé" value={collectedLabel} valueColor="#16A34A" />
              <KpiMiniCard
                label="Non imputé"
                value={unallocatedLabel}
                valueColor="#1D4ED8"
                backgroundColor="#EFF6FF"
              />
            </View>
          </View>
        </>
      ) : null}

      <Text
        style={localStyles.historyTitle}
        testID={STUDENT_SUB_SCREENS_TEST_IDS.paymentsHistoryTitle}
      >
        {STUDENT_SUB_SCREENS_COPY.paymentsSectionTitle}
      </Text>
    </>
  );

  return (
    <View style={styles.container} testID={STUDENT_SUB_SCREENS_TEST_IDS.paymentsScreen}>
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.backButton}
        testID={STUDENT_SUB_SCREENS_TEST_IDS.subScreenBackButton}
        onPress={() => navigation?.goBack()}
        accessibilityRole="button"
        accessibilityLabel="Retour"
      >
        <Ionicons name="arrow-back" size={24} color="#0F172A" />
      </TouchableOpacity>

      {showQueryState ? (
        <ScrollView
          style={localStyles.flex}
          contentContainerStyle={listContentStyle}
          keyboardShouldPersistTaps="handled"
        >
          {financeHeader}
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
            onRetry={() => void refreshFinance()}
          />
        </ScrollView>
      ) : (
        <FlatList
          style={localStyles.flex}
          data={sortedPayments}
          keyExtractor={(item) => item.id}
          testID={STUDENT_SUB_SCREENS_TEST_IDS.paymentsList}
          contentContainerStyle={listContentStyle}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={financeHeader}
          renderItem={({ item }) => (
            <>
              <PaymentReceiptCard payment={item} studentName={student?.name} currency={catalogCurrency} showItems />
              <PaymentCancelControls payment={item} onChanged={() => refreshFinance()} />
            </>
          )}
        />
      )}
    </View>
  );
}

function KpiMiniCard({
  label,
  value,
  valueColor,
  backgroundColor = "#FFFFFF",
}: {
  label: string;
  value: string;
  valueColor: string;
  backgroundColor?: string;
}) {
  return (
    <View
      style={[localStyles.kpiCard, { backgroundColor }]}
      accessibilityRole="text"
      accessibilityLabel={`${label} ${value}`}
    >
      <Text style={localStyles.kpiLabel}>{label}</Text>
      <Text style={[localStyles.kpiValue, { color: valueColor }]} selectable>
        {value}
      </Text>
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
  flex: { flex: 1 },
  title: { fontSize: 24 },
  subtitleWithClass: { marginBottom: 2 },
  subtitleSolo: { marginBottom: 8 },
  classLabel: {
    marginTop: 0,
    marginBottom: 10,
    color: "#2563EB",
    fontWeight: "800" as const,
  },
  heroCard: {
    backgroundColor: "#2563EB",
    borderRadius: 14,
    paddingVertical: KPI.heroPaddingVertical,
    paddingHorizontal: KPI.heroPaddingHorizontal,
    marginBottom: KPI.heroMarginBottom,
  },
  heroLabel: {
    color: "#DBEAFE",
    fontSize: KPI.heroLabelFontSize,
    fontWeight: "700" as const,
  },
  heroValue: {
    color: "#FFFFFF",
    fontSize: KPI.heroValueFontSize,
    fontWeight: "900" as const,
    marginTop: KPI.heroValueMarginTop,
  },
  kpiGrid: {
    gap: KPI.kpiGap,
    marginBottom: KPI.kpiBlockMarginBottom,
  },
  kpiRow: {
    flexDirection: "row" as const,
    gap: KPI.kpiGap,
  },
  kpiCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    paddingVertical: KPI.kpiPaddingVertical,
    paddingHorizontal: KPI.kpiPaddingHorizontal,
  },
  kpiLabel: {
    color: "#64748B",
    fontSize: KPI.kpiLabelFontSize,
    fontWeight: "800" as const,
  },
  kpiValue: {
    marginTop: KPI.kpiValueMarginTop,
    fontWeight: "900" as const,
    fontSize: KPI.kpiValueFontSize,
    flexShrink: 1,
  },
  historyTitle: {
    fontSize: 18,
    fontWeight: "900" as const,
    color: "#0F172A",
    marginTop: 2,
    marginBottom: 8,
  },
};
