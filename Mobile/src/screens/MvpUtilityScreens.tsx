import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { getPaymentStats, getPresenceStats } from "../domain/metrics/schoolMetrics";
import { canReadRoute } from "../domain/security/permissions";
import { displayRoleName, displayStatusName } from "../lib/format";
import {
  filterRowsByStudentScope,
  resolveMobileStudentScope,
} from "../lib/canonicalStudentIdentity";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

function ScreenShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const stackPaddingBottom = useStackScreenBottomPadding();
  const contentStyle = [styles.content, { paddingBottom: stackPaddingBottom }];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={contentStyle}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {children}
    </ScrollView>
  );
}

function InfoCard({
  icon,
  title,
  value,
  detail,
  actionLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value?: string;
  detail: string;
  actionLabel?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconBox}>
          <Ionicons name={icon} size={20} color="#2563EB" />
        </View>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>{title}</Text>
          {value ? <Text style={styles.value}>{value}</Text> : null}
        </View>
      </View>
      <Text style={styles.detail}>{detail}</Text>
      {actionLabel && onPress ? (
        <TouchableOpacity style={styles.actionButton} onPress={onPress} activeOpacity={0.85}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function DocumentsScreen({ navigation }: any) {
  const { session, selectedStudentId } = useAuth();
  const { studentsData, announcementsData } = useAdminData();
  const canOpenReportCards = canReadRoute(session, "ReportCards");
  const canOpenStudentDetail = canReadRoute(session, "StudentDetail");
  const canOpenStudents = canReadRoute(session, "Students");
  const canOpenAnnouncements = canReadRoute(session, "Announcements");

  return (
    <ScreenShell
      title="Documents scolaires"
      subtitle="Centre MVP pour bulletins, attestations et pieces administratives."
    >
      <InfoCard
        icon="document-text-outline"
        title="Bulletins PDF"
        value="Disponible"
        detail="Les bulletins publies peuvent etre ouverts en PDF depuis l'application mobile."
        actionLabel={canOpenReportCards ? "Voir les bulletins" : undefined}
        onPress={canOpenReportCards ? () => navigation.navigate("ReportCards") : undefined}
      />
      <InfoCard
        icon="people-outline"
        title="Dossiers eleves"
        value={`${studentsData.length} dossier(s)`}
        detail="Les informations eleves, presences, notes et paiements sont consolidees par dossier."
        actionLabel={
          session?.role === "student" || session?.role === "parent_student"
            ? canOpenStudentDetail ? "Mon dossier" : undefined
            : canOpenStudents ? "Ouvrir les eleves" : undefined
        }
        onPress={
          session?.role === "student" || session?.role === "parent_student"
            ? canOpenStudentDetail
              ? () => navigation.navigate("StudentDetail", { studentId: selectedStudentId })
              : undefined
            : canOpenStudents
              ? () => navigation.navigate("Students", { className: "Toutes les classes" })
              : undefined
        }
      />
      <InfoCard
        icon="megaphone-outline"
        title="Annonces archivees"
        value={`${announcementsData.length} annonce(s)`}
        detail="Les communications publiees restent consultables dans l'espace annonces."
        actionLabel={canOpenAnnouncements ? "Ouvrir les annonces" : undefined}
        onPress={canOpenAnnouncements ? () => navigation.navigate("Announcements") : undefined}
      />
    </ScreenShell>
  );
}

export function ReportsScreen() {
  const { studentsData, teachersData, classesData, paymentsData, presencesData, messagesData } = useAdminData();
  const paymentStats = getPaymentStats(paymentsData, studentsData.map((student) => student.id));
  const presenceStats = getPresenceStats(presencesData, studentsData.map((student) => student.id));

  return (
    <ScreenShell title="Rapports MVP" subtitle="Synthese operationnelle mobile et tablette.">
      <View style={styles.grid}>
        <Metric label="Eleves" value={studentsData.length} />
        <Metric label="Enseignants" value={teachersData.length} />
        <Metric label="Classes" value={classesData.length} />
        <Metric label="Presence" value={`${presenceStats.rate}%`} />
        <Metric label="Paiements" value={paymentStats.paidAmount.toLocaleString("fr-FR")} />
        <Metric label="Messages" value={messagesData.length} />
      </View>
      <InfoCard
        icon="analytics-outline"
        title="Exports"
        value="MVP"
        detail="Les indicateurs principaux sont disponibles ici. Les exports Excel/PDF avances restent classes P2."
      />
    </ScreenShell>
  );
}

export function AuditScreen() {
  const { usersData, messagesData, presencesData } = useAdminData();
  const recentUsers = usersData.slice(0, 4);

  return (
    <ScreenShell title="Audit et connexions" subtitle="Journal MVP des actions sensibles disponibles cote mobile.">
      <InfoCard
        icon="shield-checkmark-outline"
        title="Controle des acces"
        value={`${usersData.length} compte(s)`}
        detail="Les rôles, statuts et permissions sont gérés depuis la plateforme et synchronisés avec le mobile."
      />
      <InfoCard
        icon="calendar-outline"
        title="Presences tracees"
        value={`${presencesData.length} ligne(s)`}
        detail="Les modifications d'appel portent les informations de statut, date et eleve concerne."
      />
      <InfoCard
        icon="chatbubbles-outline"
        title="Messages"
        value={`${messagesData.length} message(s)`}
        detail="Les messages conservent statut, priorite, direction et historique quand disponible."
      />
      {recentUsers.map((user) => (
        <View key={user.id} style={styles.auditRow}>
          <Text style={styles.auditTitle}>{user.firstName} {user.lastName}</Text>
          <Text style={styles.auditMeta}>{displayRoleName(user.role)} - {displayStatusName(user.status)} - {user.identifier}</Text>
        </View>
      ))}
    </ScreenShell>
  );
}

export function MobilePaymentScreen({ navigation }: any) {
  const { session, selectedStudentId } = useAuth();
  const { paymentsData, studentsData } = useAdminData();
  const canOpenStudentPayments = canReadRoute(session, "StudentPayments");
  const studentScope = resolveMobileStudentScope({
    role: session?.role,
    selectedStudentId,
    children: session?.user.children,
  });
  const scopedPayments = filterRowsByStudentScope(paymentsData, studentScope);
  const paymentStats = getPaymentStats(
    scopedPayments,
    studentScope.unscoped ? undefined : studentScope.studentIds,
  );

  return (
    <ScreenShell title="Paiement mobile" subtitle="Suivi MVP des paiements et recus.">
      <InfoCard
        icon="wallet-outline"
        title="Total paye"
        value={paymentStats.paidAmount.toLocaleString("fr-FR")}
        detail="Les paiements valides sont visibles dans l'historique et le dossier eleve."
        actionLabel={canOpenStudentPayments ? "Voir les frais" : undefined}
        onPress={
          canOpenStudentPayments
            ? () => navigation.navigate("StudentPayments", { studentId: selectedStudentId })
            : undefined
        }
      />
      <InfoCard
        icon="receipt-outline"
        title="Recus"
        value={`${scopedPayments.length} paiement(s)`}
        detail="Le paiement externe Mobile Money/carte reste une integration P2 ; le MVP affiche deja le suivi et l'historique."
      />
      <InfoCard
        icon="people-outline"
        title="Eleves lies"
        value={`${studentScope.unscoped ? studentsData.length : studentScope.studentIds.length} eleve(s)`}
        detail="Le parent voit les paiements de ses enfants ; l'administration voit le suivi global."
      />
    </ScreenShell>
  );
}

export function OfflineModeScreen() {
  const { syncStatus, studentsData, presencesData, announcementsData } = useAdminData();

  return (
    <ScreenShell title="Mode hors ligne" subtitle="Etat MVP de consultation locale et synchronisation.">
      <InfoCard
        icon="sync-outline"
        title="Synchronisation"
        value={labelForSync(syncStatus)}
        detail="Les donnees chargees restent disponibles dans l'application pendant la session. Les actions CRUD admin sont resynchronisees avec le backend quand il repond."
      />
      <InfoCard
        icon="people-outline"
        title="Donnees consultables"
        value={`${studentsData.length} eleve(s)`}
        detail={`${presencesData.length} presence(s) et ${announcementsData.length} annonce(s) sont disponibles dans le contexte mobile.`}
      />
    </ScreenShell>
  );
}

export function SynchronizationScreen() {
  const { syncStatus, studentsData, usersData, schoolsData } = useAdminData();

  return (
    <ScreenShell title="Synchronisation" subtitle="État des données mobile, plateforme et backend.">
      <InfoCard
        icon="cloud-done-outline"
        title="Etat actuel"
        value={labelForSync(syncStatus)}
        detail="Les actions mobile et plateforme utilisent le backend centralisé pour garder les données cohérentes."
      />
      <View style={styles.grid}>
        <Metric label="Ecoles" value={schoolsData.length} />
        <Metric label="Utilisateurs" value={usersData.length} />
        <Metric label="Eleves" value={studentsData.length} />
      </View>
    </ScreenShell>
  );
}

export function SupportScreen() {
  const { session } = useAuth();

  return (
    <ScreenShell title="Support" subtitle="Point de contact MVP pour assistance et suivi.">
      <InfoCard
        icon="help-circle-outline"
        title="Compte"
        value={session?.user.name ?? "Utilisateur"}
        detail="Contactez l'administration de l'etablissement pour les corrections de compte, de paiement ou de dossier."
      />
      <InfoCard
        icon="business-outline"
        title="Perimetre"
        value={session?.school?.name ?? "Somafrik"}
        detail="Les demandes support seront journalisees dans le centre d'assistance lors de l'evolution P1."
      />
    </ScreenShell>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function labelForSync(status: "idle" | "syncing" | "synced" | "offline") {
  if (status === "syncing") return "Synchronisation...";
  if (status === "synced") return "Synchronise";
  if (status === "offline") return "Hors ligne";
  return "Pret";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FB" },
  content: { padding: 20 },
  title: { fontSize: 28, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 8, marginBottom: 18, color: "#64748B", fontWeight: "700", lineHeight: 21 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: "900", color: "#0F172A" },
  value: { marginTop: 3, color: "#2563EB", fontWeight: "900" },
  detail: { color: "#475569", lineHeight: 20, fontWeight: "600" },
  actionButton: {
    marginTop: 14,
    backgroundColor: "#2563EB",
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: "center",
  },
  actionText: { color: "#FFFFFF", fontWeight: "900" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  metric: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  metricValue: { fontSize: 20, fontWeight: "900", color: "#0F172A" },
  metricLabel: { marginTop: 4, color: "#64748B", fontWeight: "800" },
  auditRow: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  auditTitle: { color: "#0F172A", fontWeight: "900" },
  auditMeta: { marginTop: 4, color: "#64748B", fontWeight: "700" },
});
