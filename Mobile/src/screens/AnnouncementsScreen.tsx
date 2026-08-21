import { useCallback, useEffect, useState } from "react";
import { Alert, View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { canMutateEntity, canReadEntity } from "../domain/security/permissions";
import { canArchiveAnnouncement } from "../lib/mobileCtaRbacAlignment";
import { markAnnouncementsRead } from "../lib/announcementsRead";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  archiveCanonicalAnnouncement,
  type CanonicalAnnouncement,
} from "../services/domainHydrationApi";

export default function AnnouncementsScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const { session } = useAuth();
  const canRead = canReadEntity(session, "announcements");
  const canCreate = canMutateEntity(session, "announcements", "CREATE");
  const canArchive = canArchiveAnnouncement(session);
  const { announcementsSnapshot: snapshot, loadAnnouncements: load, resourceScopeKey } = useAdminData();
  const [archivingId, setArchivingId] = useState("");

  useFocusEffect(
    useCallback(() => {
      if (canRead) void load();
    }, [canRead, load, resourceScopeKey]),
  );

  useEffect(() => {
    if (canRead && snapshot.status === "success") {
      markAnnouncementsRead(session?.user?.id, snapshot.data);
    }
  }, [canRead, session?.user?.id, snapshot]);

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
            await archiveCanonicalAnnouncement(announcement.id);
            await load();
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

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={contentStyle}
      data={canRead && snapshot.status === "success" ? snapshot.data : []}
      keyExtractor={(item) => item.id}
      refreshControl={
        canRead ? <RefreshControl refreshing={snapshot.status === "loading"} onRefresh={() => void load()} /> : undefined
      }
      ListHeaderComponent={
        <>
          <Text style={styles.title}>Annonces</Text>
          <Text style={styles.subtitle}>Communications chargées depuis PostgreSQL</Text>
          {!canRead ? (
            <View style={styles.emptyState}>
              <Ionicons name="lock-closed-outline" size={24} color="#DC2626" />
              <Text style={styles.emptyText}>Accès refusé aux annonces.</Text>
            </View>
          ) : (
            <>
              {canCreate && (
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.addButton}
                  onPress={() => navigation.navigate("AdminCrud", { entity: "announcements" })}
                  accessibilityRole="button"
                  accessibilityLabel="Nouvelle annonce"
                >
                  <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.addButtonText}>Nouvelle annonce</Text>
                </TouchableOpacity>
              )}
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
        <View style={styles.card}>
          <View style={styles.cardMain}>
            <View style={styles.iconBox}>
              <Ionicons name="megaphone-outline" size={24} color="#7C3AED" />
            </View>
            <View style={styles.cardContent}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle} numberOfLines={3}>{announcement.title}</Text>
                {(announcement.systemBroadcast === true || String(announcement.scope ?? "").toLowerCase() === "system") && (
                  <View style={styles.systemBadge}>
                    <Ionicons name="globe-outline" size={12} color="#1D4ED8" />
                    <Text style={styles.systemBadgeText}>Diffusion système</Text>
                  </View>
                )}
              </View>
              <Text style={styles.message} numberOfLines={8}>{announcement.message}</Text>
              {announcement.author ? <Text style={styles.date} numberOfLines={2}>Auteur : {announcement.author}</Text> : null}
              <Text style={styles.date} numberOfLines={2}>{announcement.date || announcement.createdAt}</Text>
              {announcement.status ? <StatusBadge status={announcement.status} /> : null}
            </View>
          </View>
          {canArchive && (
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
        </View>
      )}
      ListFooterComponent={
        canRead ? (
          <Text style={styles.hint}>
            La modification d'une annonce existante reste masquée tant qu'un écran d'édition canonique ciblé n'est pas branché.
          </Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  title: { fontSize: 32, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 6, marginBottom: 20, color: "#64748B", fontWeight: "700" },
  addButton: {
    backgroundColor: "#7C3AED",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: { color: "#FFFFFF", fontWeight: "900", marginLeft: 8 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 22, padding: 16, marginBottom: 14 },
  cardMain: { flexDirection: "row" },
  iconBox: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: "#F5F3FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardContent: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 17, fontWeight: "900", color: "#0F172A" },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  systemBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: "#DBEAFE",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  systemBadgeText: { color: "#1D4ED8", fontWeight: "800", fontSize: 11 },
  message: { marginTop: 6, color: "#475569", fontWeight: "600", lineHeight: 20 },
  date: { marginTop: 8, color: "#7C3AED", fontWeight: "800" },
  status: { marginTop: 4, color: "#64748B", fontWeight: "700" },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  smallDangerAction: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, backgroundColor: "#FEF2F2", paddingHorizontal: 12, minHeight: 44, paddingVertical: 8 },
  smallDangerText: { color: "#DC2626", fontWeight: "900" },
  disabled: { opacity: 0.5 },
  hint: { color: "#64748B", fontWeight: "700", lineHeight: 20, marginTop: 8 },
  emptyState: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 18, alignItems: "center" },
  emptyText: { color: "#64748B", fontWeight: "800", marginTop: 8 },
});
