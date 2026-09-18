import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import ExpandableFinanceCard from "../components/ExpandableFinanceCard";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { canReadFeeGrids } from "../domain/security/permissions";
import { formatFinanceAmount, formatFinanceDate } from "../lib/financeCurrency";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  getFeeGrid,
  listFeeGrids,
  type FinanceFeeGrid,
  type FinanceFeeGridItem,
} from "../services/api";

type LoadStatus = "idle" | "loading" | "success" | "empty" | "unauthenticated" | "forbidden" | "offline" | "error";

function classifyFailure(error: unknown): { status: LoadStatus; message: string } {
  const statusCode =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (statusCode === 401) {
    return { status: "unauthenticated", message: "Session expirée. Reconnectez-vous pour consulter les grilles." };
  }
  if (statusCode === 403) {
    return { status: "forbidden", message: "Accès refusé. Le droit de lecture Finance est requis." };
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  const offline =
    statusCode === 0 ||
    normalized.includes("hors ligne") ||
    normalized.includes("network") ||
    normalized.includes("connexion") ||
    normalized.includes("serveur injoignable");
  return offline
    ? { status: "offline", message: "Connexion requise pour consulter les grilles de frais." }
    : { status: "error", message: message.trim() || "Impossible de charger les grilles de frais." };
}

export default function FeeGridsScreen() {
  const { session } = useAuth();
  const { activeSchoolCode } = useAdminData();
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const canRead = canReadFeeGrids(session);
  const requestedSchool = String(activeSchoolCode || session?.school?.code || session?.user?.schoolCode || "")
    .trim()
    .toUpperCase();
  const [status, setStatus] = useState<LoadStatus>(canRead ? "idle" : "forbidden");
  const [errorMessage, setErrorMessage] = useState("");
  const [grids, setGrids] = useState<FinanceFeeGrid[]>([]);
  const [details, setDetails] = useState<Record<string, FinanceFeeGridItem[]>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [loadingDetail, setLoadingDetail] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    if (!canRead) {
      setStatus("forbidden");
      setErrorMessage("Accès refusé. Le droit de lecture Finance est requis.");
      setGrids([]);
      return;
    }
    setStatus("loading");
    setErrorMessage("");
    try {
      const rows = await listFeeGrids();
      const scoped = requestedSchool
        ? rows.filter((row) => !row.schoolCode || String(row.schoolCode).toUpperCase() === requestedSchool)
        : rows;
      setGrids(scoped);
      setStatus(scoped.length ? "success" : "empty");
    } catch (error) {
      const failure = classifyFailure(error);
      setGrids([]);
      setStatus(failure.status);
      setErrorMessage(failure.message);
    }
  }, [canRead, requestedSchool]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const loadDetail = async (gridId: string, expanded: boolean) => {
    if (!expanded || details[gridId] || loadingDetail[gridId]) return;
    setLoadingDetail((current) => ({ ...current, [gridId]: true }));
    try {
      const detail = await getFeeGrid(gridId);
      setDetails((current) => ({ ...current, [gridId]: detail.items }));
      setDetailErrors((current) => {
        const next = { ...current };
        delete next[gridId];
        return next;
      });
    } catch (error) {
      const failure = classifyFailure(error);
      setDetailErrors((current) => ({ ...current, [gridId]: failure.message }));
    } finally {
      setLoadingDetail((current) => ({ ...current, [gridId]: false }));
    }
  };

  const stateMessage =
    status === "unauthenticated" || status === "forbidden" || status === "offline" || status === "error"
      ? errorMessage
      : null;
  const loading = status === "idle" || status === "loading";

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: scrollContentPaddingBottom }]}
      data={status === "success" ? grids : []}
      keyExtractor={(row) => row.id}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>Grilles de frais</Text>
          <Text style={styles.subtitle}>Consultation des grilles de l’établissement</Text>
          <Text style={styles.hint}>La configuration des grilles se fait depuis Somafrik Web.</Text>

          {loading ? (
            <View style={styles.stateCard} accessibilityRole="progressbar" accessibilityLabel="Chargement des grilles">
              <ActivityIndicator color="#2563EB" />
              <Text style={styles.stateText}>Chargement des grilles…</Text>
            </View>
          ) : null}

          {stateMessage ? (
            <View style={styles.errorCard} accessibilityRole="alert">
              <Text style={styles.errorText}>{stateMessage}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Réessayer de charger les grilles"
                style={styles.retryButton}
                onPress={() => void refresh()}
              >
                <Text style={styles.retryText}>Réessayer</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {status === "empty" ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateText}>Aucune grille de frais pour cet établissement.</Text>
            </View>
          ) : null}

          {status === "success" ? <Text style={styles.sectionTitle}>Grilles</Text> : null}
        </>
      }
      renderItem={({ item }) => {
        const items = details[item.id] ?? [];
        return (
          <ExpandableFinanceCard
            title={item.className || "Classe non renseignée"}
            subtitle={[item.academicYear, item.periodName].filter(Boolean).join(" · ") || "Période non renseignée"}
            badge={item.status || "—"}
            testID={`fee-grid-${item.id}`}
            onExpandedChange={(expanded) => {
              void loadDetail(item.id, expanded);
            }}
          >
            <View style={styles.detailGrid}>
              <Text style={styles.detailLabel}>Classe</Text>
              <Text style={styles.detailValue}>{item.className || "—"}</Text>
              <Text style={styles.detailLabel}>Année académique</Text>
              <Text style={styles.detailValue}>{item.academicYear || "—"}</Text>
              <Text style={styles.detailLabel}>Période</Text>
              <Text style={styles.detailValue}>{item.periodName || "—"}</Text>
              <Text style={styles.detailLabel}>Devise</Text>
              <Text style={styles.detailValue}>{item.currency || "Devise non renseignée"}</Text>
              <Text style={styles.detailLabel}>Statut</Text>
              <Text style={styles.detailValue}>{item.status || "—"}</Text>
            </View>
            {loadingDetail[item.id] ? (
              <Text style={styles.stateText}>Chargement des lignes…</Text>
            ) : null}
            {detailErrors[item.id] ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {detailErrors[item.id]}
              </Text>
            ) : null}
            {items.map((line) => (
              <View key={line.id} style={styles.lineCard}>
                <Text style={styles.lineTitle}>{line.label || line.feeType || "Ligne de frais"}</Text>
                <Text style={styles.lineMeta}>
                  {[line.feeType, line.mandatory ? "Obligatoire" : "Facultatif"].filter(Boolean).join(" · ")}
                </Text>
                <Text style={styles.lineAmount}>
                  {formatFinanceAmount(line.amount, line.currency || item.currency)}
                </Text>
                <Text style={styles.lineMeta}>Échéance : {formatFinanceDate(line.dueDate)}</Text>
              </View>
            ))}
          </ExpandableFinanceCard>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  content: { padding: 16 },
  title: { fontSize: 28, fontWeight: "900", color: "#0F172A" },
  subtitle: { color: "#64748B", fontSize: 15, fontWeight: "600", marginTop: 4 },
  hint: { color: "#64748B", fontSize: 13, fontWeight: "600", marginTop: 8, marginBottom: 18 },
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
  sectionTitle: { color: "#0F172A", fontSize: 20, fontWeight: "900", marginBottom: 2 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 8, marginBottom: 12 },
  detailLabel: { width: "43%", color: "#64748B", fontSize: 13, fontWeight: "600" },
  detailValue: { width: "57%", color: "#0F172A", fontSize: 13, fontWeight: "800", textAlign: "right" },
  lineCard: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    backgroundColor: "#F8FAFC",
  },
  lineTitle: { color: "#0F172A", fontWeight: "800" },
  lineMeta: { color: "#64748B", fontWeight: "700", marginTop: 4, fontSize: 13 },
  lineAmount: { color: "#0F172A", fontWeight: "900", marginTop: 6 },
});
