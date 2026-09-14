import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRoute, type RouteProp } from "@react-navigation/native";
import AnnouncementMutationControls from "../components/AnnouncementMutationControls";
import CommunicationChrome from "../components/CommunicationChrome";
import ExpandableCommunicationCard from "../components/ExpandableCommunicationCard";
import QueryStateView from "../components/QueryStateView";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { canMutateEntity, canReadEntity, isSuperAdminSessionRole } from "../domain/security/permissions";
import { canArchiveAnnouncement } from "../lib/mobileCtaRbacAlignment";
import { announcementRowKey, mergeAnnouncementsByKey, sortAnnouncementsByPublishedAt } from "../lib/communicationPagination";
import { filterCommunicationRows, excerptCommunication } from "../lib/communicationListFilter";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { downloadCommunicationAttachment, downloadPlatformAnnouncementAttachment } from "../services/api";
import {
  archiveCanonicalAnnouncement,
  getCanonicalAnnouncementById,
  getCanonicalAnnouncementsPage,
  markCanonicalAnnouncementRead,
  type CanonicalAnnouncement,
} from "../services/domainHydrationApi";
import {
  emptyResourceSnapshot,
  snapshotFromFailure,
  snapshotFromSuccess,
  type ResourceSnapshot,
} from "../lib/dataTruth";
import { mergeFocusedAnnouncement, resolveFocusedAnnouncement } from "../lib/announcementsOpenById";
import type { RootStackParamList } from "../navigation/AppNavigator";

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

function announcementOriginLabel(announcement: CanonicalAnnouncement): string {
  if (announcement.originLabel) return announcement.originLabel;
  if (announcement.source === "platform") {
    return announcement.systemBroadcast ? "Annonce Somafrik" : "Annonce administrative Somafrik";
  }
  return "Annonce établissement";
}

export default function AnnouncementsScreen() {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const { session } = useAuth();
  const route = useRoute<RouteProp<RootStackParamList, "Announcements">>();
  const focusedAnnouncementId = String(route.params?.announcementId ?? "").trim();
  const canRead = canReadEntity(session, "announcements");
  const canCreate = canMutateEntity(session, "announcements", "CREATE");
  const canArchive = canArchiveAnnouncement(session);
  const isSuperadmin = isSuperAdminSessionRole(session?.role) || isSuperAdminSessionRole(session?.user?.role);
  const { loadAnnouncements: load, resourceScopeKey, activeSchoolCode } = useAdminData();
  const [announcementsSnapshot, setAnnouncementsSnapshot] =
    useState<ResourceSnapshot<CanonicalAnnouncement>>(emptyResourceSnapshot());
  const [schoolCursor, setSchoolCursor] = useState<string | null>(null);
  const [platformCursor, setPlatformCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursor = schoolCursor || platformCursor;
  const [archivingId, setArchivingId] = useState("");
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [focusedAnnouncement, setFocusedAnnouncement] = useState<CanonicalAnnouncement | null>(null);
  const markedFocusedIdRef = useRef("");

  const loadFirstPage = useCallback(async () => {
    if (!canRead) {
      setAnnouncementsSnapshot(emptyResourceSnapshot());
      setSchoolCursor(null);
      setPlatformCursor(null);
      return;
    }
    setAnnouncementsSnapshot((current) => ({ status: "loading", data: current.data }));
    try {
      const page = await getCanonicalAnnouncementsPage(activeSchoolCode);
      setAnnouncementsSnapshot(snapshotFromSuccess(page.items));
      setSchoolCursor(page.schoolCursor);
      setPlatformCursor(page.platformCursor);
    } catch (error) {
      setAnnouncementsSnapshot(snapshotFromFailure(error, []));
      setSchoolCursor(null);
      setPlatformCursor(null);
    }
  }, [canRead, activeSchoolCode]);

  const loadMoreAnnouncements = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const pendingSchoolCursor = schoolCursor;
      const pendingPlatformCursor = platformCursor;
      const page = await getCanonicalAnnouncementsPage(activeSchoolCode, {
        schoolCursor: pendingSchoolCursor,
        platformCursor: pendingPlatformCursor,
        includeSchool: Boolean(pendingSchoolCursor),
        includePlatform: Boolean(pendingPlatformCursor),
      });
      setAnnouncementsSnapshot((current) =>
        snapshotFromSuccess(sortAnnouncementsByPublishedAt(mergeAnnouncementsByKey(current.data, page.items))),
      );
      if (pendingSchoolCursor) setSchoolCursor(page.schoolCursor);
      if (pendingPlatformCursor) setPlatformCursor(page.platformCursor);
    } catch (error) {
      Alert.alert("Chargement interrompu", error instanceof Error ? error.message : "Réessayez.");
    } finally {
      setLoadingMore(false);
    }
  }, [activeSchoolCode, schoolCursor, platformCursor, nextCursor, loadingMore]);

  const refreshList = useCallback(() => {
    void load();
    void loadFirstPage();
  }, [load, loadFirstPage]);

  useFocusEffect(
    useCallback(() => {
      if (canRead) refreshList();
    }, [canRead, refreshList, resourceScopeKey]),
  );

  const markReadIfNeeded = async (announcement: CanonicalAnnouncement) => {
    if (announcement.readAt) return;
    await markCanonicalAnnouncementRead(
      announcement.id,
      activeSchoolCode,
      announcement.source,
    ).catch(() => null);
    await load();
    await loadFirstPage();
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
            await loadFirstPage();
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

  const visible = useMemo(() => {
    const filtered = filterCommunicationRows(
      (canRead && announcementsSnapshot.status === "success" ? announcementsSnapshot.data : []).map((row) => ({
        ...row,
        excerpt: excerptCommunication(String(row.message || "")),
        author: row.author || "",
        audience: row.audienceLabel || row.audience || "",
        unread: !row.readAt,
      })),
      query,
      unreadOnly,
    );
    return mergeFocusedAnnouncement(
      filtered,
      focusedAnnouncement
        ? {
            ...focusedAnnouncement,
            excerpt: excerptCommunication(String(focusedAnnouncement.message || "")),
            author: focusedAnnouncement.author || "",
            audience: focusedAnnouncement.audienceLabel || focusedAnnouncement.audience || "",
            unread: !focusedAnnouncement.readAt,
          }
        : null,
    );
  }, [canRead, announcementsSnapshot, query, unreadOnly, focusedAnnouncement]);

  useEffect(() => {
    if (!focusedAnnouncementId || !canRead) {
      setFocusedAnnouncement(null);
      markedFocusedIdRef.current = "";
      return;
    }
    let cancelled = false;
    const list = announcementsSnapshot.status === "success" ? announcementsSnapshot.data : [];
    void resolveFocusedAnnouncement({
      announcementId: focusedAnnouncementId,
      list,
      fetchById: (id) => getCanonicalAnnouncementById(id, activeSchoolCode),
    }).then((row) => {
      if (!cancelled) setFocusedAnnouncement(row);
    });
    return () => {
      cancelled = true;
    };
  }, [focusedAnnouncementId, canRead, announcementsSnapshot, activeSchoolCode]);

  useEffect(() => {
    if (!focusedAnnouncement || focusedAnnouncement.readAt) return;
    if (markedFocusedIdRef.current === focusedAnnouncement.id) return;
    markedFocusedIdRef.current = focusedAnnouncement.id;
    void markReadIfNeeded(focusedAnnouncement);
  }, [focusedAnnouncement]);

  return (
    <>
      <FlatList
        style={styles.container}
        contentContainerStyle={contentStyle}
        data={visible}
        keyExtractor={(item) => announcementRowKey(item)}
        refreshControl={
          canRead ? <RefreshControl refreshing={announcementsSnapshot.status === "loading"} onRefresh={refreshList} /> : undefined
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
                {canCreate ? <AnnouncementMutationControls onChanged={refreshList} /> : null}
                {announcementsSnapshot.status !== "success" ? (
                  <QueryStateView
                    snapshot={announcementsSnapshot}
                    emptyMessage="Aucune annonce."
                    errorMessage="Impossible de charger les annonces."
                    offlineMessage="Réseau indisponible. Les annonces n'ont pas pu être chargées."
                    emptyTestId="announcements-empty"
                    errorTestId="announcements-error"
                    onRetry={refreshList}
                    loadingLabel="Chargement des annonces…"
                  />
                ) : null}
              </>
            )}
          </>
        }
        renderItem={({ item: announcement }) => {
          const origin = announcementOriginLabel(announcement);
          return (
            <ExpandableCommunicationCard
              key={announcement.id === focusedAnnouncementId ? `${announcement.id}-open` : announcement.id}
              title={announcement.title}
              subtitle={origin}
              badge={announcement.readAt ? "Lu" : "Non lu"}
              badgeTone={announcement.readAt ? "default" : "info"}
              testID={`announcement-card-${announcement.id}`}
              defaultExpanded={Boolean(focusedAnnouncementId) && announcement.id === focusedAnnouncementId}
              onExpandedChange={(expanded) => {
                if (expanded) void markReadIfNeeded(announcement);
              }}
            >
              <Text style={styles.message}>{announcement.message || announcement.excerpt}</Text>
              {announcement.author ? (
                <Text style={styles.date}>
                  {announcement.author} · {formatDisplayDate(announcement.publishedAt || announcement.createdAt || announcement.date)}
                </Text>
              ) : (
                <Text style={styles.date}>
                  {formatDisplayDate(announcement.publishedAt || announcement.createdAt || announcement.date)}
                </Text>
              )}
              {announcement.audience ? <Text style={styles.date}>{announcement.audience}</Text> : null}
              {announcement.status ? <StatusBadge status={announcement.status} /> : null}
              {(announcement.attachments ?? []).map((file) => (
                <TouchableOpacity
                  key={file.id}
                  onPress={() => {
                    const download =
                      announcement.source === "platform"
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
              {canArchive && (announcement.source !== "platform" || isSuperadmin) ? (
                <TouchableOpacity
                  style={[styles.smallDangerAction, archivingId === announcement.id && styles.disabled]}
                  onPress={() => confirmArchive(announcement)}
                  disabled={Boolean(archivingId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Archiver l'annonce ${announcement.title}`}
                  accessibilityState={{ disabled: Boolean(archivingId), busy: archivingId === announcement.id }}
                >
                  <Text style={styles.smallDangerText}>
                    {archivingId === announcement.id ? "Archivage…" : "Archiver"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </ExpandableCommunicationCard>
          );
        }}
        ListFooterComponent={
          announcementsSnapshot.status === "success" && nextCursor ? (
            <TouchableOpacity
              style={[styles.secondaryButton, loadingMore && styles.disabled]}
              onPress={() => void loadMoreAnnouncements()}
              disabled={loadingMore}
              testID="announcements-load-more"
              accessibilityRole="button"
              accessibilityLabel="Charger les annonces plus anciennes"
              accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
            >
              <Text style={styles.secondaryButtonText}>
                {loadingMore ? "Chargement…" : "Charger les annonces plus anciennes"}
              </Text>
            </TouchableOpacity>
          ) : null
        }
      />
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
  secondaryButton: { minHeight: 42, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: "#CBD5E1", paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: "#334155", fontWeight: "700" },
  modal: { flex: 1, padding: 20, backgroundColor: "#FFFFFF", gap: 10 },
  link: { color: "#2563EB", fontWeight: "700" },
  create: { marginTop: 16, backgroundColor: "#2563EB", borderRadius: 14, alignItems: "center", padding: 14 },
  createText: { color: "#FFFFFF", fontWeight: "900" },
});
