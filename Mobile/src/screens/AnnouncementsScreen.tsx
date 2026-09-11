import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import AnnouncementMutationControls from "../components/AnnouncementMutationControls";
import CommunicationChrome from "../components/CommunicationChrome";
import QueryStateView from "../components/QueryStateView";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { canMutateEntity, canReadEntity, isSuperAdminSessionRole } from "../domain/security/permissions";
import { canArchiveAnnouncement } from "../lib/mobileCtaRbacAlignment";
import { filterCommunicationRows, excerptCommunication } from "../lib/communicationListFilter";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { downloadCommunicationAttachment, downloadPlatformAnnouncementAttachment } from "../services/api";
import {
  archiveCanonicalAnnouncement,
  markCanonicalAnnouncementRead,
  type CanonicalAnnouncement,
} from "../services/domainHydrationApi";

function formatDisplayDate(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function AnnouncementsScreen() {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const { session } = useAuth();
  const canRead = canReadEntity(session, "announcements");
  const canCreate = canMutateEntity(session, "announcements", "CREATE");
  const canArchive = canArchiveAnnouncement(session);
  const isSuperadmin = isSuperAdminSessionRole(session?.role) || isSuperAdminSessionRole(session?.user?.role);
  const { announcementsSnapshot: snapshot, loadAnnouncements: load, resourceScopeKey, activeSchoolCode } = useAdminData();
  const [archivingId, setArchivingId] = useState("");
  const [selected, setSelected] = useState<CanonicalAnnouncement | null>(null);
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (canRead) void load();
    }, [canRead, load, resourceScopeKey]),
  );

  const openAnnouncement = async (announcement: CanonicalAnnouncement) => {
    setSelected(announcement);
    if (!announcement.readAt) {
      const marked = await markCanonicalAnnouncementRead(
        announcement.id,
        activeSchoolCode,
        announcement.source,
      ).catch(() => null);
      if (marked) {
        setSelected(marked);
        await load();
      }
    }
  };

  const confirmArchive = (announcement: CanonicalAnnouncement) => {
    if (!canArchive || archivingId) return;
    Alert.alert("Archiver l'annonce", "L'annonce sera archivée côté serveur.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Archiver",
        style: "destructive",
        onPress: async () => {
          setArchivingId(announcement.id);
          try {
            await archiveCanonicalAnnouncement(announcement.id, activeSchoolCode, announcement.source);
            await load();
            setSelected(null);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Impossible d'archiver l'annonce.";
            Alert.alert("Archivage impossible", message);
          } finally {
            setArchivingId("");
          }
        },
      },
    ]);
  };

  const visible = useMemo(
    () =>
      filterCommunicationRows(
        (canRead && snapshot.status === "success" ? snapshot.data : []).map((row) => ({
          ...row,
          excerpt: excerptCommunication(String(row.message || "")),
          author: row.author || "",
          audience: row.audienceLabel || row.audience || "",
          unread: !row.readAt,
        })),
        query,
        unreadOnly,
      ),
    [canRead, snapshot, query, unreadOnly],
  );

  return (
    <>
      <FlatList
        style={styles.container}
        contentContainerStyle={contentStyle}
        data={visible}
        keyExtractor={(item) => item.id}
        refreshControl={
          canRead ? <RefreshControl refreshing={snapshot.status === "loading"} onRefresh={() => void load()} /> : undefined
        }
        ListHeaderComponent={
          <>
            <CommunicationChrome
              surface="announcements"
              title="Communication"
              searchPlaceholder="Rechercher"
              unreadLabel="Non lus"
              countLabel="Annonces"
              search={query}
              onSearch={setQuery}
              unreadOnly={unreadOnly}
              onUnreadOnly={setUnreadOnly}
            />
            {!canRead ? (
              <View style={styles.emptyState}>
                <Ionicons name="lock-closed-outline" size={24} color="#DC2626" />
                <Text style={styles.emptyText}>Accès refusé aux annonces.</Text>
              </View>
            ) : (
              <>
                {canCreate ? <AnnouncementMutationControls onChanged={() => load()} /> : null}
                {snapshot.status !== "success" ? (
                  <QueryStateView
                    snapshot={snapshot}
                    emptyMessage="Aucune annonce."
                    errorMessage="Impossible de charger les annonces."
                    offlineMessage="Réseau indisponible. Les annonces n'ont pas pu être chargées."
                    emptyTestId="announcements-empty"
                    errorTestId="announcements-error"
                    onRetry={() => void load()}
                    loadingLabel="Chargement des annonces…"
                  />
                ) : null}
              </>
            )}
          </>
        }
        renderItem={({ item: announcement }) => (
          <TouchableOpacity style={styles.card} onPress={() => void openAnnouncement(announcement)}>
            <View style={styles.cardContent}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle} numberOfLines={1}>{announcement.title}</Text>
                {!announcement.readAt ? (
                  <Text style={styles.unread}>Non lu</Text>
                ) : (
                  <Text style={styles.read}>Lu</Text>
                )}
              </View>
              {announcement.excerpt ? <Text style={styles.excerpt} numberOfLines={1}>{announcement.excerpt}</Text> : null}
              <Text style={styles.date} numberOfLines={1}>
                {announcement.author ? `${announcement.author} · ` : ""}
                {formatDisplayDate(announcement.publishedAt || announcement.createdAt || announcement.date)}
              </Text>
              {announcement.audience ? <Text style={styles.date} numberOfLines={1}>{announcement.audience}</Text> : null}
              {announcement.status ? <StatusBadge status={announcement.status} /> : null}
            </View>
            {canArchive && (announcement.source !== "platform" || isSuperadmin) && (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.smallDangerAction, archivingId === announcement.id && styles.disabled]}
                  onPress={() => confirmArchive(announcement)}
                  disabled={Boolean(archivingId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Archiver l'annonce ${announcement.title}`}
                  accessibilityState={{ disabled: Boolean(archivingId), busy: archivingId === announcement.id }}
                >
                  <Ionicons name="archive-outline" size={18} color="#DC2626" />
                  <Text style={styles.smallDangerText}>{archivingId === announcement.id ? "Archivage…" : "Archiver"}</Text>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        )}
      />
      <Modal visible={Boolean(selected)} animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modal}>
          <Text style={styles.title}>{selected?.title}</Text>
          <Text style={styles.date}>
            {selected?.author} · {formatDisplayDate(selected?.publishedAt || selected?.createdAt || selected?.date)}
          </Text>
          <Text style={styles.message}>{selected?.message}</Text>
          {(selected?.attachments ?? []).map((file) => (
            <TouchableOpacity
              key={file.id}
              onPress={() => {
                const download =
                  selected?.source === "platform"
                    ? downloadPlatformAnnouncementAttachment(file.id, file.fileName)
                    : downloadCommunicationAttachment(file.id, file.fileName, activeSchoolCode);
                void download
                  .then((uri) => Linking.openURL(uri))
                  .catch((error) => Alert.alert("Téléchargement impossible", error instanceof Error ? error.message : ""));
              }}
            >
              <Text style={styles.link}>{file.fileName}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.create} onPress={() => setSelected(null)}>
            <Text style={styles.createText}>Fermer</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 16 },
  title: { fontSize: 22, fontWeight: "800", color: "#0F172A" },
  subtitle: { marginTop: 4, marginBottom: 14, color: "#64748B" },
  emptyState: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyText: { color: "#DC2626", fontWeight: "700" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, borderWidth: 1, borderColor: "#E2E8F0" },
  cardContent: { flex: 1 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  cardTitle: { flex: 1, fontWeight: "700", color: "#0F172A" },
  excerpt: { marginTop: 2, color: "#64748B", fontSize: 12 },
  message: { marginTop: 6, color: "#334155" },
  date: { marginTop: 6, color: "#64748B", fontSize: 12 },
  unread: { color: "#7C3AED", fontWeight: "800", fontSize: 12 },
  read: { color: "#64748B", fontSize: 12 },
  actionRow: { marginTop: 10, flexDirection: "row", justifyContent: "flex-end" },
  smallDangerAction: { flexDirection: "row", alignItems: "center", gap: 6 },
  smallDangerText: { color: "#DC2626", fontWeight: "700" },
  disabled: { opacity: 0.5 },
  modal: { flex: 1, padding: 20, backgroundColor: "#FFFFFF", gap: 10 },
  link: { color: "#2563EB", fontWeight: "700" },
  create: { marginTop: 16, backgroundColor: "#2563EB", borderRadius: 14, alignItems: "center", padding: 14 },
  createText: { color: "#FFFFFF", fontWeight: "900" },
});
