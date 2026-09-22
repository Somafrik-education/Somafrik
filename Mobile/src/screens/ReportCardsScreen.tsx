import { useCallback, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import ExpandableEntityCard from "../components/ExpandableEntityCard";
import { ReportCardWorkflowCards } from "../components/ReportCardWorkflowCards";
import QueryStateView from "../components/QueryStateView";
import StudentSwitcher from "../components/StudentSwitcher";
import { ReportCardSnapshotView } from "../components/bulletin/ReportCardSnapshotView";
import { downloadReportCardPdf } from "../services/api";
import {
  DATA_TRUTH_COPY,
  DATA_TRUTH_TEST_IDS,
  isPublishedBulletin,
  snapshotFromFailure,
  snapshotFromSuccess,
  type ResourceSnapshot,
} from "../lib/dataTruth";
import {
  getReportCardPublicationSnapshot,
  listReportCardPublications,
  type ReportCardPublicationRow,
} from "../lib/reportCardPublicationApi";
import { listPublishedVersionHistory, type PublishedVersionRow } from "../lib/reportCardHistoryApi";
import { listReportCardRequests, type ReportCardWorkflowRequest } from "../lib/reportCardWorkflowApi";
import {
  SNAPSHOT_SLOT_PERCENTAGE,
  SNAPSHOT_SLOT_RANK,
  exposedSlot,
  studentDisplayName,
  studentPeriodLabel,
  type RenderingTemplate,
  type SnapshotPayload,
  type SnapshotStudent,
} from "../lib/reportCardSnapshotDisplay";
import {
  filterRowsByStudentScope,
  resolveMobileStudentScope,
} from "../lib/canonicalStudentIdentity";
import { nextExclusiveExpandedKey } from "../lib/expandableEntity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import { ApiClientError } from "../services/httpClient";

type PublishedBulletinCard = {
  id: string;
  reportCardId: string;
  version: number;
  studentId: string;
  studentName: string;
  period: string;
  status: string;
  publishedAt: string;
  percentageLabel: string;
  rankLabel: string;
  payload: SnapshotPayload;
  template?: RenderingTemplate | null;
  student: SnapshotStudent;
  versionHistory: PublishedVersionRow[];
};

function bulletinErrorSnapshot(
  error: unknown,
  previous: PublishedBulletinCard[] = [],
): ResourceSnapshot<PublishedBulletinCard> {
  const status = error instanceof ApiClientError ? error.status : undefined;
  if (status === 403) {
    return { status: "error", data: previous, errorMessage: DATA_TRUTH_COPY.forbiddenBulletins };
  }
  if (status === 404) {
    return { status: "error", data: previous, errorMessage: DATA_TRUTH_COPY.notFoundBulletins };
  }
  if (status != null && status >= 500) {
    return { status: "error", data: previous, errorMessage: DATA_TRUTH_COPY.serverErrorBulletins };
  }
  return snapshotFromFailure(error, previous);
}

function cardsFromPublication(
  row: ReportCardPublicationRow,
  payload: SnapshotPayload | null,
  template?: RenderingTemplate | null,
  versionHistory: PublishedVersionRow[] = [],
): PublishedBulletinCard[] {
  if (!payload) return [];
  const version = Number(row.published_snapshot_version || payload.published_snapshot_version || 0);
  return (payload.students || []).map((student) => {
    const studentId = String(student.student_id || "");
    return {
      id: `${row.report_card_id}:${version}:${studentId}`,
      reportCardId: String(row.report_card_id),
      version,
      studentId,
      studentName: studentDisplayName(student),
      period: studentPeriodLabel(student),
      status: "PUBLISHED",
      publishedAt: String(payload.published_at || ""),
      percentageLabel: exposedSlot(student, SNAPSHOT_SLOT_PERCENTAGE) || "—",
      rankLabel: exposedSlot(student, SNAPSHOT_SLOT_RANK) || "—",
      payload,
      template,
      student,
      versionHistory,
    };
  });
}

export default function ReportCardsScreen() {
  const stackPaddingBottom = useStackScreenBottomPadding();
  const contentStyle = [styles.content, { paddingBottom: stackPaddingBottom }];
  const { session, selectedStudentId } = useAuth();
  const { studentsData } = useAdminData();
  const [expandedReportCardId, setExpandedReportCardId] = useState<string | null>(null);
  const [reportCardsSnapshot, setReportCardsSnapshot] = useState<ResourceSnapshot<PublishedBulletinCard>>({
    status: "idle",
    data: [],
  });
  const [workflowRows, setWorkflowRows] = useState<ReportCardWorkflowRequest[]>([]);
  const [workflowStatus, setWorkflowStatus] = useState<"idle" | "loading" | "success" | "empty" | "forbidden" | "error">(
    "idle",
  );
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null);

  const loadReportCards = useCallback(async () => {
    setReportCardsSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const publications = await listReportCardPublications();
      const cards: PublishedBulletinCard[] = [];
      for (const row of publications) {
        const snap = await getReportCardPublicationSnapshot(row.report_card_id, row.published_snapshot_version);
        const versionHistory = await listPublishedVersionHistory(row.report_card_id);
        cards.push(
          ...cardsFromPublication(
            row,
            snap?.payload ?? null,
            snap?.template as RenderingTemplate | undefined,
            versionHistory,
          ),
        );
      }
      setReportCardsSnapshot(snapshotFromSuccess(cards));
    } catch (error) {
      setReportCardsSnapshot((current) => bulletinErrorSnapshot(error, current.data));
    }
  }, []);

  const isBulletinStaff = useMemo(() => {
    const role = String(session?.role ?? "").toLowerCase();
    return role !== "parent_student" && role !== "student" && role !== "parent" && role !== "eleve";
  }, [session?.role]);

  const loadWorkflow = useCallback(async () => {
    if (!isBulletinStaff) {
      setWorkflowRows([]);
      setWorkflowStatus("idle");
      return;
    }
    setWorkflowStatus("loading");
    try {
      const requests = await listReportCardRequests();
      setWorkflowRows(requests);
      setWorkflowStatus(requests.length ? "success" : "empty");
      setWorkflowMessage("");
    } catch (error) {
      const statusCode = error instanceof ApiClientError ? error.status : undefined;
      if (statusCode === 401 || statusCode === 403) {
        setWorkflowRows([]);
        setWorkflowStatus("forbidden");
        setWorkflowMessage("Workflow non accessible avec les droits actuels.");
        return;
      }
      setWorkflowRows([]);
      setWorkflowStatus("error");
      setWorkflowMessage(error instanceof Error ? error.message : "Impossible de charger le workflow bulletin.");
    }
  }, [isBulletinStaff]);

  useFocusEffect(
    useCallback(() => {
      void loadReportCards();
      void loadWorkflow();
    }, [loadReportCards, loadWorkflow]),
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

  const openPdf = async (card: PublishedBulletinCard) => {
    try {
      const localUri = await downloadReportCardPdf(card.reportCardId, card.version);
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

  const isParentView = ["parent_student", "parent"].includes(String(session?.role ?? "").toLowerCase());

  return (
    <ScrollView style={styles.screen} contentContainerStyle={contentStyle}>
      {isParentView ? <StudentSwitcher /> : null}
      <Text style={styles.title}>Bulletins</Text>
      <Text style={styles.subtitle}>
        {reportCardsSnapshot.status === "success"
          ? `${rows.length} bulletin(s) disponible(s)`
          : "Documents publiés par l'établissement"}
      </Text>
      {isBulletinStaff ? (
        <View style={styles.workflowBlock}>
          <Text style={styles.workflowTitle}>État du workflow bulletin</Text>
          <Text style={styles.hint}>
            La configuration, l'approbation et la publication des bulletins se font depuis Somafrik Web.
          </Text>
          {workflowStatus === "loading" ? <Text style={styles.historyRow}>Chargement du workflow…</Text> : null}
          {workflowStatus === "empty" ? <Text style={styles.historyRow}>Aucun modèle en cours.</Text> : null}
          {workflowStatus === "forbidden" || workflowStatus === "error" ? (
            <Text style={styles.historyRow}>{workflowMessage}</Text>
          ) : null}
          <ReportCardWorkflowCards
            rows={workflowRows}
            expandedId={expandedWorkflowId}
            onExpandedIdChange={setExpandedWorkflowId}
          />
        </View>
      ) : null}

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
            const period = card.period;
            const isPublished = isPublishedBulletin(card.status);
            const averageLabel = card.percentageLabel;
            const rankLabel = card.rankLabel;

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
                  <Metric label="Publié le" value={card.publishedAt || "—"} />
                </View>
                <ReportCardSnapshotView payload={card.payload} template={card.template} studentId={card.studentId} />
                {card.versionHistory.length > 0 ? (
                  <View style={styles.historyBlock}>
                    <Text style={styles.historyTitle}>Historique des versions</Text>
                    {card.versionHistory.map((entry) => (
                      <Text
                        key={`${entry.report_card_id}:${entry.published_snapshot_version}`}
                        style={styles.historyRow}
                      >
                        v{entry.published_snapshot_version}{" "}
                        {entry.verification_status === "SUPERSEDED"
                          ? "SUPERSEDED"
                          : entry.verification_status === "REVOKED"
                            ? "REVOKED"
                            : entry.verification_status || "ACTIVE"}
                      </Text>
                    ))}
                  </View>
                ) : null}
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.pdfButton, !isPublished && styles.pdfButtonDisabled]}
                  disabled={!isPublished}
                  onPress={() => openPdf(card)}
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
  historyBlock: { marginBottom: 12, gap: 4 },
  historyTitle: { color: "#334155", fontSize: 12, fontWeight: "900" },
  historyRow: { color: "#475569", fontSize: 12, fontWeight: "700" },
  workflowBlock: { marginBottom: 18, gap: 8 },
  workflowTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  hint: { color: "#64748B", fontSize: 13, fontWeight: "700", marginBottom: 8 },
});
