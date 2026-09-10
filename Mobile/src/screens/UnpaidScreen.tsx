import { FlatList, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import QueryStateView from "../components/QueryStateView";
import { useUnpaidLedger } from "../hooks/useUnpaidLedger";
import { DATA_TRUTH_COPY, DATA_TRUTH_TEST_IDS } from "../lib/dataTruth";
import { formatFinanceAmount } from "../lib/financeCurrency";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { hasSecurityPermission } from "../domain/security/permissions";
import { unpaidClassLabel, unpaidStatusLabel, type UnpaidStudentRow } from "../lib/unpaidLedger";

function amountLabel(row: UnpaidStudentRow) {
  if (row.currency) return formatFinanceAmount(row.amountDue, row.currency);
  return new Intl.NumberFormat("fr-FR").format(row.amountDue);
}

export default function UnpaidScreen() {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { session } = useAuth();
  const canReadUnpaid = hasSecurityPermission(session, "Impayés", "READ");
  const { snapshot, gate, reload, rows } = useUnpaidLedger(canReadUnpaid);
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];

  if (!canReadUnpaid || gate === "forbidden") {
    return (
      <View style={styles.container}>
        <View style={contentStyle}>
          <Text style={styles.title} accessibilityRole="header" accessibilityLabel="Impayés">
            Impayés
          </Text>
          <View style={styles.box} accessibilityRole="alert" accessibilityLabel="Accès refusé aux impayés">
            <Text style={styles.alertText}>
              Accès refusé — vous n'êtes pas autorisé à consulter les impayés.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (gate === "unauthenticated") {
    return (
      <View style={styles.container}>
        <View style={contentStyle}>
          <Text style={styles.title} accessibilityRole="header" accessibilityLabel="Impayés">
            Impayés
          </Text>
          <View style={styles.box} accessibilityRole="alert" accessibilityLabel="Session expirée">
            <Text style={styles.alertText}>Session expirée. Reconnectez-vous pour voir les impayés.</Text>
          </View>
        </View>
      </View>
    );
  }

  const showQueryState = snapshot.status !== "success";

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={contentStyle}
      data={showQueryState ? [] : rows}
      keyExtractor={(row) => row.studentId}
      ListHeaderComponent={
        <>
          <Text style={styles.title} accessibilityRole="header" accessibilityLabel="Impayés">
            Impayés
          </Text>
          <Text style={styles.subtitle}>Obligations scolaires restant dues</Text>
          {showQueryState ? (
            <QueryStateView
              snapshot={snapshot}
              emptyMessage={DATA_TRUTH_COPY.emptyUnpaid}
              errorMessage={snapshot.errorMessage || DATA_TRUTH_COPY.errorUnpaid}
              offlineMessage={DATA_TRUTH_COPY.offlineUnpaid}
              emptyTestId={DATA_TRUTH_TEST_IDS.unpaidEmpty}
              errorTestId={DATA_TRUTH_TEST_IDS.unpaidError}
              onRetry={() => void reload()}
              loadingLabel="Chargement…"
            />
          ) : (
            <Text style={styles.count} testID={DATA_TRUTH_TEST_IDS.unpaidList}>
              {rows.length} élève{rows.length > 1 ? "s" : ""}
            </Text>
          )}
        </>
      }
      renderItem={({ item: row }) => {
        const className = unpaidClassLabel(row.className);
        const status = unpaidStatusLabel(row);
        const due = amountLabel(row);
        return (
          <View
            style={styles.card}
            accessibilityRole="summary"
            accessibilityLabel={`${row.studentName}, ${className}, ${due}, ${status}`}
          >
            <View style={styles.cardTop}>
              <Text style={styles.studentName} numberOfLines={1}>
                {row.studentName}
              </Text>
              <Text style={styles.amount}>{due}</Text>
            </View>
            <View style={styles.cardMeta}>
              <Text style={styles.meta} numberOfLines={1}>
                {className}
              </Text>
              <Text style={styles.status}>{status}</Text>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: "800", color: "#111827" },
  subtitle: { fontSize: 15, fontWeight: "600", color: "#64748B", marginBottom: 8 },
  count: { fontSize: 14, fontWeight: "700", color: "#475569", marginBottom: 4 },
  box: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  alertText: { color: "#991B1B", fontWeight: "700", fontSize: 15, lineHeight: 22 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    minHeight: MIN_TOUCH_TARGET_DP,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "center" },
  studentName: { flex: 1, fontSize: 16, fontWeight: "800", color: "#0F172A" },
  amount: { fontSize: 16, fontWeight: "800", color: "#DC2626" },
  cardMeta: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 8 },
  meta: { flex: 1, fontSize: 14, fontWeight: "600", color: "#64748B" },
  status: { fontSize: 13, fontWeight: "700", color: "#B45309" },
});
