import type { ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import ExpandableFinanceCard from "./ExpandableFinanceCard";
import StatusBadge from "./StatusBadge";
import {
  DATA_TRUTH_TEST_IDS,
  paymentItemCount,
  paymentItems,
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
  actions?: ReactNode;
};

export default function PaymentReceiptCard({
  payment,
  studentName,
  onPress,
  showItems = true,
  currency = "",
  actions,
}: Props) {
  const reference = paymentReference(payment);
  const total = paymentTotal(payment);
  const items = paymentItems(payment);
  const money = (amount: number) => formatFinanceAmount(amount, currency || payment.currency);
  const statusLabel = financePaymentStatusLabel(payment.status);
  const paidAt = paymentPaidAt(payment);
  const summaryMeta = [money(total), paymentMethodLabel(payment), paidAt ? formatFinanceDate(paidAt) : ""]
    .filter(Boolean)
    .join(" · ");
  const badgeTone = /annul/i.test(statusLabel) ? "danger" : /non imput|attente/i.test(statusLabel) ? "warning" : "default";

  return (
    <ExpandableFinanceCard
      title={studentName || payment.studentName || "Élève"}
      subtitle={summaryMeta}
      badge={statusLabel}
      badgeTone={badgeTone}
      badgeContent={<StatusBadge status={statusLabel} />}
      testID={`${DATA_TRUTH_TEST_IDS.paymentsReceipt}-${reference || payment.id}`}
    >
      <View style={styles.detailGrid}>
        <Text style={styles.detailLabel}>Référence</Text>
        <Text style={styles.detailValue} selectable>{reference || payment.id}</Text>
        <Text style={styles.detailLabel}>Moyen</Text>
        <Text style={styles.detailValue}>{paymentMethodLabel(payment)}</Text>
        <Text style={styles.detailLabel}>Libellés</Text>
        <Text style={styles.detailValue}>{paymentItemCount(payment)}</Text>
        <Text style={styles.detailLabel}>Non imputé</Text>
        <Text style={styles.detailValue}>{money(Number(payment.unallocatedAmount ?? 0))}</Text>
      </View>

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
      {onPress ? (
        <TouchableOpacity style={styles.openButton} onPress={onPress} accessibilityRole="button">
          <Text style={styles.openButtonText}>Ouvrir le dossier</Text>
        </TouchableOpacity>
      ) : null}
      {actions}
    </ExpandableFinanceCard>
  );
}

const styles = StyleSheet.create({
  detailGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 8, marginBottom: 12 },
  detailLabel: { width: "38%", color: "#64748B", fontSize: 13, fontWeight: "600" },
  detailValue: { width: "62%", color: "#0F172A", fontSize: 13, fontWeight: "800", textAlign: "right" },
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
  openButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    marginTop: 10,
  },
  openButtonText: { color: "#1D4ED8", fontWeight: "800" },
});
