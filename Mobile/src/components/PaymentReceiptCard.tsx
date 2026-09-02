import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import StatusBadge from "./StatusBadge";
import {
  DATA_TRUTH_TEST_IDS,
  paymentItemCount,
  paymentItems,
  paymentItemsDetail,
  paymentMethodLabel,
  paymentPaidAt,
  paymentReference,
  paymentTotal,
  type CanonicalPayment,
} from "../lib/dataTruth";
import { formatFinanceAmount, formatFinanceDate } from "../lib/financeCurrency";
import { financePaymentStatusLabel } from "../lib/financeObligationStatus";

type Props = {
  payment: CanonicalPayment;
  studentName?: string;
  onPress?: () => void;
  showItems?: boolean;
  currency?: string;
};

export default function PaymentReceiptCard({
  payment,
  studentName,
  onPress,
  showItems = true,
  currency = "",
}: Props) {
  const reference = paymentReference(payment);
  const total = paymentTotal(payment);
  const items = paymentItems(payment);
  const money = (amount: number) => formatFinanceAmount(amount, currency || payment.currency);
  const Wrapper = onPress ? TouchableOpacity : View;
  const statusLabel = financePaymentStatusLabel(payment.status);

  return (
    <Wrapper
      style={styles.card}
      {...(onPress ? { activeOpacity: 0.85, onPress } : {})}
      testID={`${DATA_TRUTH_TEST_IDS.paymentsReceipt}-${reference || payment.id}`}
      accessibilityRole={onPress ? "button" : "summary"}
      accessibilityLabel={`Reçu ${reference || payment.id}, ${statusLabel}, ${money(total)}`}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.reference} selectable>
            {reference || payment.id}
          </Text>
          <Text style={styles.student} numberOfLines={3}>
            {studentName || payment.studentName || "Élève"}
          </Text>
          <Text style={styles.meta}>{paymentItemsDetail(payment)}</Text>
        </View>
        <StatusBadge status={statusLabel} />
      </View>

      <Text style={styles.total} selectable>
        {money(total)}
      </Text>
      <Text style={styles.meta}>
        {paymentMethodLabel(payment)}
        {paymentPaidAt(payment) ? ` • ${formatFinanceDate(paymentPaidAt(payment))}` : ""}
      </Text>
      <Text style={styles.count}>{paymentItemCount(payment)} libellé(s)</Text>
      {Number(payment.unallocatedAmount ?? 0) > 0 ? (
        <Text style={styles.unallocated}>
          Non imputé : {money(Number(payment.unallocatedAmount))}
        </Text>
      ) : null}

      {showItems ? (
        <View style={styles.items}>
          {items.map((item, index) => (
            <View key={item.id || `${reference}-${index}`} style={styles.itemRow}>
              <Text style={styles.itemLabel}>{item.feeLabel || item.feeType || "Libellé"}</Text>
              <Text style={styles.itemAmount} selectable>
                {money(Number(item.amount || 0))}
              </Text>
            </View>
          ))}
          <View style={[styles.itemRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalLabel} selectable>
              {money(total)}
            </Text>
          </View>
        </View>
      ) : null}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "flex-start" },
  headerText: { flex: 1, minWidth: 0 },
  reference: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  student: { color: "#334155", fontSize: 15, fontWeight: "800", marginTop: 4 },
  meta: { color: "#64748B", fontSize: 13, fontWeight: "700", marginTop: 4 },
  count: { color: "#64748B", fontSize: 12, fontWeight: "800", marginTop: 2 },
  unallocated: { color: "#1D4ED8", fontSize: 13, fontWeight: "800", marginTop: 6 },
  total: { color: "#0F172A", fontSize: 22, fontWeight: "900", marginTop: 10 },
  items: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingTop: 12,
    gap: 8,
  },
  itemRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  itemLabel: { color: "#334155", fontWeight: "700", flex: 1, flexShrink: 1 },
  itemAmount: { color: "#0F172A", fontWeight: "800", flexShrink: 0 },
  totalRow: { marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#E2E8F0" },
  totalLabel: { color: "#0F172A", fontWeight: "900" },
});
