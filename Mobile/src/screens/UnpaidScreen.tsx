import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { hasSecurityPermission } from "../domain/security/permissions";
import { useUnpaidLedger } from "../hooks/useUnpaidLedger";
import { formatFinanceAmount } from "../lib/financeCurrency";
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
              <View>
                <Text style={styles.summaryValue}>{state.studentCount}</Text>
                <Text style={styles.summaryLabel}>Élève(s)</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryAmountBox}>
                <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
                  {formatFinanceAmount(state.totalAmountDue, state.currency)}
                </Text>
                <Text style={styles.summaryLabel}>Reste dû</Text>
              </View>
            </View>
          ) : null}

          {state.status === "success" ? <Text style={styles.sectionTitle}>Élèves concernés</Text> : null}
        </>
      }
      renderItem={({ item }) => (
        <View style={styles.rowCard}>
          <View style={styles.rowTop}>
            <View style={styles.rowIdentity}>
              <Text style={styles.studentName}>{item.studentName}</Text>
              <Text style={styles.meta}>{item.className || "Classe non renseignée"}</Text>
            </View>
            <Text style={styles.amount}>{formatFinanceAmount(item.amountDue, item.currency || state.currency)}</Text>
          </View>
          <Text style={styles.meta}>
            {item.periodLabel || "Période non renseignée"}
            {item.daysLate > 0 ? ` · ${item.daysLate} jour(s) de retard` : ""}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 30, fontWeight: "900", color: "#0F172A" },
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
    minHeight: 128,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 22,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  summaryValue: { color: "#0F172A", fontSize: 25, fontWeight: "900" },
  summaryLabel: { color: "#64748B", fontSize: 13, fontWeight: "700", marginTop: 5 },
  summaryDivider: { width: 1, alignSelf: "stretch", backgroundColor: "#E2E8F0", marginHorizontal: 20 },
  summaryAmountBox: { flex: 1 },
  sectionTitle: { color: "#0F172A", fontSize: 20, fontWeight: "900", marginBottom: 2 },
  rowCard: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 18, gap: 10, marginBottom: 12 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  rowIdentity: { flex: 1 },
  studentName: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  meta: { color: "#64748B", fontSize: 14, fontWeight: "600", marginTop: 4 },
  amount: { color: "#DC2626", fontSize: 16, fontWeight: "900", maxWidth: "42%", textAlign: "right" },
});
