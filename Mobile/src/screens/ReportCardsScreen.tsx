import { useCallback, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import ExpandableEntityCard from "../components/ExpandableEntityCard";
import QueryStateView from "../components/QueryStateView";
import { downloadReportCardPdf } from "../services/api";
import {
  bulletinPeriod,
  DATA_TRUTH_COPY,
  DATA_TRUTH_TEST_IDS,
  isPublishedBulletin,
} from "../lib/dataTruth";
import {
  filterRowsByStudentScope,
  resolveMobileStudentScope,
} from "../lib/canonicalStudentIdentity";
import { nextExclusiveExpandedKey } from "../lib/expandableEntity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

export default function ReportCardsScreen() {
  const stackPaddingBottom = useStackScreenBottomPadding();
  const contentStyle = [styles.content, { paddingBottom: stackPaddingBottom }];
  const { session, selectedStudentId } = useAuth();
  const { studentsData, reportCardsSnapshot, loadReportCards } = useAdminData();
  const [expandedReportCardId, setExpandedReportCardId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadReportCards();
    }, [loadReportCards]),
  );

  const studentScope = useMemo(
    () =>
      resolveMobileStudentScope({
        role: session?.role,
        selectedStudentId,
        children: session?.user.children,
        linkedStudent: session?.user.linkedStudent,
        user: session?.user,
      }),
    [session, selectedStudentId],
  );

  const rows = useMemo(() => {
    if (reportCardsSnapshot.status !== "success") return [];
    if (studentScope.unscoped) {
      const allowed = new Set(studentsData.map((student) => student.id).filter(Boolean));
      if (!allowed.size) return reportCardsSnapshot.data;
      return reportCardsSnapshot.data.filter((card) => allowed.has(card.studentId));
    }
    return filterRowsByStudentScope(reportCardsSnapshot.data, studentScope);
  }, [reportCardsSnapshot, studentScope, studentsData]);

  const openPdf = async (studentId: string, period: string) => {
    try {
      const localUri = await downloadReportCardPdf(studentId, period);
      const canOpen = await Linking.canOpenURL(localUri);

      if (!canOpen) {
        Alert.alert("Bulletin PDF", "Aucune application ne peut ouvrir ce PDF sur cet appareil.");
        return;
      }

      await Linking.openURL(localUri);
    } catch (error) {
      Alert.alert(
        "Bulletin PDF",
        error instanceof Error ? error.message : "Impossible d'ouvrir le bulletin PDF.",
      );
    }
  };

  const showQueryState =
    reportCardsSnapshot.status !== "success" || rows.length === 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={contentStyle}>
      <Text style={styles.title}>Bulletins</Text>
      <Text style={styles.subtitle}>
        {reportCardsSnapshot.status === "success"
          ? `${rows.length} bulletin(s) disponible(s)`
          : "Documents générés par l'établissement"}
      </Text>

      {showQueryState ? (
        <QueryStateView
          snapshot={
            reportCardsSnapshot.status === "success" && rows.length === 0
              ? { status: "empty", data: [] }
              : reportCardsSnapshot
          }
          emptyMessage={DATA_TRUTH_COPY.emptyBulletins}
          errorMessage={DATA_TRUTH_COPY.errorBulletins}
          offlineMessage={DATA_TRUTH_COPY.offlineBulletins}
          emptyTestId={DATA_TRUTH_TEST_IDS.bulletinsEmpty}
          errorTestId={DATA_TRUTH_TEST_IDS.bulletinsError}
          onRetry={() => void loadReportCards()}
        />
      ) : (
        <View testID={DATA_TRUTH_TEST_IDS.bulletinsList}>
          {rows.map((card) => {
            const student = studentsData.find((item) => item.id === card.studentId);
            const period = bulletinPeriod(card);
            const isPublished = isPublishedBulletin(card.status);
            const averageLabel =
              card.average == null || !Number.isFinite(Number(card.average))
                ? "—"
                : `${Number(card.average).toFixed(1)}/20`;
            const rankLabel =
              card.rank == null || !Number.isFinite(Number(card.rank)) ? "—" : `${card.rank}e`;

            return (
              <ExpandableEntityCard
                key={card.id}
                title={card.studentName || student?.name || "Élève"}
                subtitle={period || "Période non renseignée"}
                badge={card.status || "—"}
                badgeTone={!isPublished ? "warning" : "default"}
                expanded={expandedReportCardId === card.id}
                onExpandedChange={() =>
                  setExpandedReportCardId((current) => nextExclusiveExpandedKey(current, card.id))
                }
              >
                <View style={styles.metricsRow}>
                  <Metric label="Moyenne" value={averageLabel} />
                  <Metric label="Rang" value={rankLabel} />
                  <Metric label="Publié le" value={card.publishedAt || "À valider"} />
                </View>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.pdfButton, (!isPublished || !card.studentId || !period) && styles.pdfButtonDisabled]}
                  disabled={!isPublished || !card.studentId || !period}
                  onPress={() => openPdf(card.studentId, period)}
                >
                  <Ionicons name="document-text-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.pdfText}>Visionner le bulletin</Text>
                </TouchableOpacity>
              </ExpandableEntityCard>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  title: { color: "#0F172A", fontSize: 28, fontWeight: "900" },
  subtitle: { color: "#64748B", fontWeight: "800", marginTop: 4, marginBottom: 18 },
  metricsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  metric: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 14, padding: 10 },
  metricLabel: { color: "#64748B", fontSize: 11, fontWeight: "900" },
  metricValue: { color: "#0F172A", fontSize: 14, fontWeight: "900", marginTop: 4 },
  pdfButton: {
    borderRadius: 14,
    backgroundColor: "#2563EB",
    padding: 13,
    minHeight: MIN_TOUCH_TARGET_DP,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pdfButtonDisabled: { opacity: 0.45 },
  pdfText: { color: "#FFFFFF", fontWeight: "900" },
});
