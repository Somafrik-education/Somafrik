import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { reportCards } from "../data/catalog";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { downloadReportCardPdf } from "../services/api";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

export default function ReportCardsScreen() {
  const stackPaddingBottom = useStackScreenBottomPadding();
  const contentStyle = [styles.content, { paddingBottom: stackPaddingBottom }];
  const { session, selectedStudentId } = useAuth();
  const { studentsData } = useAdminData();
  const visibleStudentIds =
    session?.role === "parent_student"
      ? session.user.children?.map((child) => child.id) ?? []
      : session?.role === "student" && selectedStudentId
        ? [selectedStudentId]
        : studentsData.map((student) => student.id);
  const rows = reportCards.filter((card) => visibleStudentIds.includes(card.studentId));

  const openPdf = async (studentId: string, period: string) => {
    try {
      // S2.1 — fetch Authorization: Bearer puis ouverture locale (plus de JWT en query).
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
        error instanceof Error ? error.message : "Impossible d'ouvrir le bulletin PDF."
      );
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={contentStyle}>
      <Text style={styles.title}>Bulletins</Text>
      <Text style={styles.subtitle}>{rows.length} bulletin(s) disponible(s)</Text>

      {rows.map((card) => {
        const student = studentsData.find((item) => item.id === card.studentId);
        const isPublished = card.status === "Publié";

        return (
          <View key={card.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.student}>{student?.name ?? "Élève"}</Text>
                <Text style={styles.term}>{card.term}</Text>
              </View>
              <Text style={[styles.status, !isPublished && styles.statusDraft]}>{card.status}</Text>
            </View>

            <View style={styles.metricsRow}>
              <Metric label="Moyenne" value={`${card.average}/20`} />
              <Metric label="Rang" value={`${card.rank}e`} />
              <Metric label="Publié le" value={card.publishedAt || "À valider"} />
            </View>

            <Text style={styles.comment}>{card.teacherComment}</Text>
            <Text style={styles.comment}>{card.principalComment}</Text>

            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.pdfButton, !isPublished && styles.pdfButtonDisabled]}
              disabled={!isPublished}
              onPress={() => openPdf(card.studentId, card.term)}
            >
              <Ionicons name="document-text-outline" size={18} color="#FFFFFF" />
              <Text style={styles.pdfText}>Visionner le bulletin</Text>
            </TouchableOpacity>
          </View>
        );
      })}
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
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  student: { color: "#0F172A", fontSize: 17, fontWeight: "900" },
  term: { color: "#64748B", fontSize: 13, fontWeight: "800", marginTop: 4 },
  status: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    color: "#0F766E",
    backgroundColor: "#ECFDF5",
    fontSize: 12,
    fontWeight: "900",
  },
  statusDraft: { color: "#B45309", backgroundColor: "#FFFBEB" },
  metricsRow: { flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 12 },
  metric: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 14, padding: 10 },
  metricLabel: { color: "#64748B", fontSize: 11, fontWeight: "900" },
  metricValue: { color: "#0F172A", fontSize: 14, fontWeight: "900", marginTop: 4 },
  comment: { color: "#475569", fontSize: 13, fontWeight: "700", marginTop: 6 },
  pdfButton: {
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pdfButtonDisabled: { opacity: 0.45 },
  pdfText: { color: "#FFFFFF", fontWeight: "900" },
});
