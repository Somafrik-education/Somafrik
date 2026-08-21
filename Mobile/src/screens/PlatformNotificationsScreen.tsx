import React, { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import SchoolSelector from "../components/SchoolSelector";
import { hasPlatformBackofficePrivilege } from "../domain/security/permissions";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import type { PlatformNotification } from "../lib/scope";
import {
  buildPlatformNotificationReadPatch,
  isUnreadNotification,
} from "../lib/platformNotificationSync";
import { updatePlatformNotification } from "../services/api";

const TYPE_OPTIONS = ["Information", "Alerte", "Paiement", "Académique", "Système"];
const PRIORITY_OPTIONS = ["Normale", "Haute", "Critique"];
const AUDIENCE_OPTIONS = ["Tous", "Super Administrateur Somafrik", "Admin Pays", "Administrateurs Établissement", "Enseignants", "Parents", "Élèves"];

export default function PlatformNotificationsScreen() {
  const { session } = useAuth();
  const { notificationsData, upsertNotification, refreshBackOfficeState } = useAdminData();
  const { isTablet, horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();
  const [composing, setComposing] = useState<Partial<PlatformNotification> | null>(null);
  const [markingRead, setMarkingRead] = useState(false);

  const canManagePlatform = hasPlatformBackofficePrivilege(session);
  const canCreate = canManagePlatform;
  const canUpdate = canManagePlatform;

  const unreadCount = useMemo(
    () => notificationsData.filter((item) => String(item.status ?? "") !== "Lu" && String(item.status ?? "") !== "read").length,
    [notificationsData],
  );

  if (!canManagePlatform) {
    return (
      <View style={styles.container} testID="platform-notifications-denied">
        <Text style={styles.title}>Notifications plateforme</Text>
        <Text style={styles.empty}>
          Accès réservé aux privilèges plateforme (ALL_PRIVILEGES ou COUNTRY_PRIVILEGES).
        </Text>
      </View>
    );
  }

  const persistReadTargets = async (targets: PlatformNotification[]) => {
    const unreadTargets = targets.filter((item) => item.id && isUnreadNotification(item));
    if (!unreadTargets.length || markingRead) return;

    setMarkingRead(true);
    try {
      await Promise.all(
        unreadTargets.map((item) => {
          const { id, patch } = buildPlatformNotificationReadPatch(item);
          return updatePlatformNotification(id, patch);
        }),
      );
      await refreshBackOfficeState();
    } catch (error) {
      Alert.alert(
        "Synchronisation impossible",
        error instanceof Error
          ? error.message
          : "La notification n'a pas été modifiée dans la base.",
      );
    } finally {
      setMarkingRead(false);
    }
  };

  const markAllRead = () => {
    void persistReadTargets(notificationsData);
  };

  const markRead = (item: PlatformNotification) => {
    void persistReadTargets([item]);
  };

  const saveNotification = () => {
    if (!composing?.title?.trim() || !composing.message?.trim()) {
      Alert.alert("Erreur", "Titre et message obligatoires.");
      return;
    }
    upsertNotification({
      title: composing.title.trim(),
      message: composing.message.trim(),
      type: composing.type ?? "Information",
      audience: composing.audience ?? "Tous",
      priority: composing.priority ?? "Normale",
      status: composing.status ?? "Non lu",
      date: composing.date ?? new Date().toLocaleDateString("fr-FR").replace(/\//g, "-"),
      createdBy: session?.user.name ?? "Mobile",
    });
    setComposing(null);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        padding: horizontalPadding,
        paddingBottom: bottomPadding,
        maxWidth: contentMaxWidth,
        alignSelf: "center",
        width: "100%",
      }}
    >
      <SchoolSelector />
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Notifications plateforme</Text>
          <Text style={styles.subtitle}>{unreadCount} non lue(s)</Text>
        </View>
        {canUpdate && unreadCount > 0 && (
          <TouchableOpacity
            style={[styles.secondaryBtn, markingRead && styles.disabledBtn]}
            disabled={markingRead}
            onPress={markAllRead}
          >
            <Text style={styles.secondaryBtnText}>
              {markingRead ? "Synchronisation…" : "Tout marquer lu"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {canCreate && (
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() =>
            setComposing({
              title: "",
              message: "",
              type: "Information",
              audience: "Tous",
              priority: "Normale",
              status: "Non lu",
            })
          }
        >
          <Text style={styles.primaryBtnText}>Nouvelle notification</Text>
        </TouchableOpacity>
      )}

      <View style={[styles.list, isTablet && styles.listTablet]}>
        {notificationsData.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.card, item.status === "Non lu" && styles.cardUnread]}
            disabled={markingRead}
            onPress={() => canUpdate && markRead(item)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.badge}>{item.priority ?? "Normale"}</Text>
            </View>
            <Text style={styles.cardMessage}>{item.message}</Text>
            <Text style={styles.cardMeta}>
              {item.type ?? "Information"} • {item.audience ?? "Tous"} • {item.date ?? ""}
            </Text>
          </TouchableOpacity>
        ))}
        {notificationsData.length === 0 && (
          <Text style={styles.empty}>Aucune notification plateforme.</Text>
        )}
      </View>

      <Modal visible={Boolean(composing)} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, isTablet && styles.modalCardTablet]}>
            <Text style={styles.modalTitle}>Composer une notification</Text>
            <TextInput
              style={styles.input}
              placeholder="Titre"
              value={composing?.title ?? ""}
              onChangeText={(title) => setComposing((current) => ({ ...(current ?? {}), title }))}
            />
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Message"
              multiline
              value={composing?.message ?? ""}
              onChangeText={(message) => setComposing((current) => ({ ...(current ?? {}), message }))}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionRow}>
              {TYPE_OPTIONS.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.optionChip, composing?.type === type && styles.optionChipActive]}
                  onPress={() => setComposing((current) => ({ ...(current ?? {}), type }))}
                >
                  <Text style={styles.optionChipText}>{type}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionRow}>
              {AUDIENCE_OPTIONS.map((audience) => (
                <TouchableOpacity
                  key={audience}
                  style={[styles.optionChip, composing?.audience === audience && styles.optionChipActive]}
                  onPress={() => setComposing((current) => ({ ...(current ?? {}), audience }))}
                >
                  <Text style={styles.optionChipText}>{audience}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionRow}>
              {PRIORITY_OPTIONS.map((priority) => (
                <TouchableOpacity
                  key={priority}
                  style={[styles.optionChip, composing?.priority === priority && styles.optionChipActive]}
                  onPress={() => setComposing((current) => ({ ...(current ?? {}), priority }))}
                >
                  <Text style={styles.optionChipText}>{priority}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setComposing(null)}>
                <Text style={styles.secondaryBtnText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={saveNotification}>
                <Text style={styles.primaryBtnText}>Envoyer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 28, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", fontWeight: "600", marginTop: 4 },
  primaryBtn: { backgroundColor: "#2563EB", borderRadius: 14, padding: 14, marginBottom: 16 },
  primaryBtnText: { color: "#FFF", fontWeight: "800", textAlign: "center" },
  secondaryBtn: { backgroundColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  secondaryBtnText: { color: "#334155", fontWeight: "700" },
  disabledBtn: { opacity: 0.55 },
  list: { gap: 12 },
  listTablet: { flexDirection: "row", flexWrap: "wrap" },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flex: 1,
    minWidth: 280,
  },
  cardUnread: { borderLeftWidth: 4, borderLeftColor: "#2563EB" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827", flex: 1 },
  badge: { fontSize: 11, fontWeight: "800", color: "#2563EB" },
  cardMessage: { color: "#475569", lineHeight: 20, marginBottom: 8 },
  cardMeta: { color: "#94A3B8", fontSize: 12, fontWeight: "600" },
  empty: { color: "#64748B", textAlign: "center", marginTop: 24 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#FFF", borderRadius: 20, padding: 20 },
  modalCardTablet: { alignSelf: "center", width: "100%", maxWidth: 640 },
  modalTitle: { fontSize: 20, fontWeight: "800", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#F8FAFC",
  },
  textArea: { minHeight: 100, textAlignVertical: "top" },
  optionRow: { marginBottom: 8 },
  optionChip: {
    backgroundColor: "#F1F5F9",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  optionChipActive: { backgroundColor: "#DBEAFE" },
  optionChipText: { color: "#334155", fontWeight: "600", fontSize: 12 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 8 },
});
