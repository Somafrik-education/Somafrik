import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import ExpandableFinanceCard from "../components/ExpandableFinanceCard";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { hasSecurityPermission } from "../domain/security/permissions";
import { useUnpaidLedger } from "../hooks/useUnpaidLedger";
import { formatFinanceAmount, formatFinanceDate } from "../lib/financeCurrency";
import { unpaidLedgerStateMessage } from "../lib/unpaidLedger";
import { useFloatingTabBarLayout } from "../lib/screenLayout";

export default function UnpaidScreen() {
  const { session } = useAuth();
  const { activeSchoolCode } = useAdminData();
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const canReadUnpaid = hasSecurityPermission(session, "Impayés", "READ");
  const requestedSchoolCode = activeSchoolCode || session?.school?.code || session?.user?.schoolCode;
  const { state, refresh } = useUnpaidLedger(canReadUnpaid, requestedSchoolCode);
  const stateMessage = unpaidLedgerStateMessage(state);
  const loading = state.status === "idle" || state.status === "loading";

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: scrollContentPaddingBottom }]}
      data={state.status === "success" ? state.rows : []}
      keyExtractor={(row) => row.studentId}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>Impayés</Text>
          <Text style={styles.subtitle}>Créances ouvertes de l’établissement</Text>

          {loading ? (
            <View style={styles.stateCard} accessibilityRole="progressbar" accessibilityLabel="Chargement des impayés">
              <ActivityIndicator color="#2563EB" />
              <Text style={styles.stateText}>Chargement des impayés…</Text>
            </View>
          ) : null}

          {stateMessage ? (
            <View style={styles.errorCard} accessibilityRole="alert">
              <Text style={styles.errorText}>{stateMessage}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Réessayer de charger les impayés"
                style={styles.retryButton}
                onPress={() => void refresh()}
              >
                <Text style={styles.retryText}>Réessayer</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {state.status === "empty" ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateText}>Aucun impayé pour cet établissement.</Text>
            </View>
          ) : null}

          {state.status === "success" ? (
            <View style={styles.summaryCard} accessibilityLabel={`${state.studentCount} élève(s) en impayé`}>
              <View style={styles.summaryStudents}>
                <Text style={styles.summaryValue}>{state.studentCount}</Text>
                <Text style={styles.summaryLabel}>Élève(s)</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryAmountBox}>
                {state.totalsByCurrency.map((total) => (
                  <Text key={total.currency || "unknown"} style={styles.summaryAmount} numberOfLines={1} adjustsFontSizeToFit>
                    {total.currency
                      ? formatFinanceAmount(total.amount, total.currency)
                      : `${new Intl.NumberFormat("fr-FR").format(total.amount)} · devise non renseignée`}
                  </Text>
                ))}
                <Text style={styles.summaryLabel}>Reste dû</Text>
              </View>
            </View>
          ) : null}

          {state.status === "success" ? <Text style={styles.sectionTitle}>Élèves concernés</Text> : null}
        </>
      }
      renderItem={({ item }) => (
        <ExpandableFinanceCard
          title={item.studentName}
          subtitle={item.className || "Classe non renseignée"}
          badge={formatFinanceAmount(item.amountDue, item.currency)}
          badgeTone="danger"
          testID={`unpaid-student-${item.studentId}`}
        >
          <View style={styles.detailGrid}>
            <Text style={styles.detailLabel}>Période</Text>
            <Text style={styles.detailValue}>{item.periodLabel || "Non renseignée"}</Text>
            <Text style={styles.detailLabel}>Retard</Text>
            <Text style={styles.detailValue}>{item.daysLate > 0 ? `${item.daysLate} jour(s)` : "Non échu"}</Text>
            <Text style={styles.detailLabel}>Montant attendu</Text>
            <Text style={styles.detailValue}>{formatFinanceAmount(item.amountExpected, item.currency)}</Text>
            <Text style={styles.detailLabel}>Montant alloué aux impayés ouverts</Text>
            <Text style={styles.detailValue}>{formatFinanceAmount(item.amountPaid, item.currency)}</Text>
            <Text style={styles.detailLabel}>Reste dû</Text>
            <Text style={styles.detailValue}>{formatFinanceAmount(item.amountDue, item.currency)}</Text>
            <Text style={styles.detailLabel}>Échéance</Text>
            <Text style={styles.detailValue}>{formatFinanceDate(item.dueDate)}</Text>
          </View>
        </ExpandableFinanceCard>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  content: { padding: 16 },
  title: { fontSize: 28, fontWeight: "900", color: "#0F172A" },
  subtitle: { color: "#64748B", fontSize: 15, fontWeight: "600", marginTop: 4, marginBottom: 18 },
  stateCard: {
    minHeight: 88,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 20,
    marginBottom: 16,
  },
  stateText: { color: "#64748B", fontSize: 15, fontWeight: "700", textAlign: "center" },
  errorCard: { borderRadius: 20, backgroundColor: "#FEF2F2", padding: 20, gap: 14, marginBottom: 16 },
  errorText: { color: "#991B1B", fontSize: 15, fontWeight: "800", lineHeight: 21 },
  retryButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  retryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
  summaryCard: {
    minHeight: 112,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  summaryStudents: { minWidth: 72 },
  summaryValue: { color: "#0F172A", fontSize: 24, fontWeight: "900" },
  summaryAmount: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginBottom: 3 },
  summaryLabel: { color: "#64748B", fontSize: 13, fontWeight: "700", marginTop: 5 },
  summaryDivider: { width: 1, alignSelf: "stretch", backgroundColor: "#E2E8F0", marginHorizontal: 16 },
  summaryAmountBox: { flex: 1 },
  sectionTitle: { color: "#0F172A", fontSize: 20, fontWeight: "900", marginBottom: 2 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 8 },
  detailLabel: { width: "43%", color: "#64748B", fontSize: 13, fontWeight: "600" },
  detailValue: { width: "57%", color: "#0F172A", fontSize: 13, fontWeight: "800", textAlign: "right" },
});
