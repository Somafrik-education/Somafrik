import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  DATA_TRUTH_TEST_IDS,
  isPaidStatus,
  paymentItemCount,
  paymentItems,
  paymentItemsDetail,
  paymentMethodLabel,
  paymentPaidAt,
  paymentReference,
  paymentStatusLabel,
  paymentTotal,
  type CanonicalPayment,
} from "../lib/dataTruth";

type Props = {
  payment: CanonicalPayment;
  studentName?: string;
  onPress?: () => void;
  showItems?: boolean;
};

export default function PaymentReceiptCard({ payment, studentName, onPress, showItems = true }: Props) {
  const reference = paymentReference(payment);
  const total = paymentTotal(payment);
  const items = paymentItems(payment);
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      style={styles.card}
      {...(onPress ? { activeOpacity: 0.85, onPress } : {})}
      testID={`${DATA_TRUTH_TEST_IDS.paymentsReceipt}-${reference || payment.id}`}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.reference}>{reference || payment.id}</Text>
          <Text style={styles.student}>{studentName || payment.studentName || "Élève"}</Text>
          <Text style={styles.meta}>{paymentItemsDetail(payment)}</Text>
        </View>
        <Text style={[styles.badge, !isPaidStatus(payment.status) && styles.badgePending]}>
          {paymentStatusLabel(payment.status)}
        </Text>
      </View>

      <Text style={styles.total}>{total.toLocaleString()} FC</Text>
      <Text style={styles.meta}>
        {paymentMethodLabel(payment)}
        {paymentPaidAt(payment) ? ` • ${paymentPaidAt(payment)}` : ""}
      </Text>
      <Text style={styles.count}>{paymentItemCount(payment)} libellé(s)</Text>

      {showItems ? (
        <View style={styles.items}>
          {items.map((item, index) => (
            <View key={item.id || `${reference}-${index}`} style={styles.itemRow}>
              <Text style={styles.itemLabel}>{item.feeLabel || item.feeType || "Libellé"}</Text>
              <Text style={styles.itemAmount}>{Number(item.amount || 0).toLocaleString()} FC</Text>
            </View>
          ))}
          <View style={[styles.itemRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalLabel}>{total.toLocaleString()} FC</Text>
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
  total: { color: "#0F172A", fontSize: 22, fontWeight: "900", marginTop: 10 },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    color: "#0F766E",
    backgroundColor: "#ECFDF5",
    fontSize: 12,
    fontWeight: "900",
    overflow: "hidden",
  },
  badgePending: { color: "#B45309", backgroundColor: "#FFFBEB" },
  items: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingTop: 12,
    gap: 8,
  },
  itemRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  itemLabel: { color: "#334155", fontWeight: "700", flex: 1 },
  itemAmount: { color: "#0F172A", fontWeight: "800" },
  totalRow: { marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#E2E8F0" },
  totalLabel: { color: "#0F172A", fontWeight: "900" },
});
