import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { hasCommunicationSchoolScope } from "../lib/communicationSchoolScope";
import {
  archiveInternalNotification,
  createInternalNotification,
  downloadInternalNotificationAttachment,
  listInternalNotifications,
  markInternalNotificationRead,
  uploadInternalNotificationAttachment,
  type InternalNotificationRecord,
} from "../services/internalNotificationsApi";

const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

function formatDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function hasPermission(session: any, permission: string) {
  const permissions = Array.isArray(session?.permissions)
    ? session.permissions
    : Array.isArray(session?.user?.permissions)
      ? session.user.permissions
      : [];
  return permissions.includes(permission) || permissions.includes("ALL_PRIVILEGES") || permissions.includes("COUNTRY_PRIVILEGES");
}

export default function InternalNotificationsScreen() {
  const { session } = useAuth();
  const { activeSchoolCode, requiresSchoolSelection } = useAdminData();
  const [rows, setRows] = useState<InternalNotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<Array<{ id: string; fileName: string }>>([]);
  const [sending, setSending] = useState(false);

  const scopeReady = !requiresSchoolSelection || hasCommunicationSchoolScope(activeSchoolCode);
  const canCreate = hasPermission(session, "Notifications:CREATE") && scopeReady;
  const unread = useMemo(() => rows.filter((row) => !row.readAt).length, [rows]);

  const load = useCallback(async (refresh = false) => {
    if (!scopeReady) {
      setRows([]);
      setError("Sélectionnez un établissement pour consulter ses notifications.");
      setLoading(false);
      return;
    }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const result = await listInternalNotifications(activeSchoolCode);
      setRows(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Notifications indisponibles.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeSchoolCode, scopeReady]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  async function markRead(row: InternalNotificationRecord) {
    try {
      const updated = await markInternalNotificationRead(row.id, activeSchoolCode);
      setRows((current) => current.map((item) => item.id === row.id ? updated : item));
    } catch (err) {
      Alert.alert("Lecture impossible", err instanceof Error ? err.message : "Réessayez.");
    }
  }

  async function archive(row: InternalNotificationRecord) {
    try {
      await archiveInternalNotification(row.id, activeSchoolCode);
      setRows((current) => current.filter((item) => item.id !== row.id));
    } catch (err) {
      Alert.alert("Archivage impossible", err instanceof Error ? err.message : "Réessayez.");
    }
  }

  async function pickAttachments() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png"],
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (picked.canceled) return;
    for (const asset of picked.assets ?? []) {
      const mimeType = asset.mimeType || "";
      if (!ALLOWED_MIME.has(mimeType)) {
        Alert.alert("Fichier refusé", "Seuls PDF, JPEG et PNG sont acceptés.");
        return;
      }
      const saved = await uploadInternalNotificationAttachment({
        uri: asset.uri,
        name: asset.name || "fichier",
        mimeType,
      }, activeSchoolCode);
      setAttachments((current) => [...current, { id: saved.id, fileName: saved.fileName || asset.name || saved.id }]);
    }
  }

  async function submit() {
    if (!title.trim() || !body.trim()) {
      Alert.alert("Champs obligatoires", "Renseignez le titre et le message.");
      return;
    }
    setSending(true);
    try {
      const key = `notification-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await createInternalNotification({
        title: title.trim(),
        body: body.trim(),
        attachmentIds: attachments.map((item) => item.id),
      }, key, activeSchoolCode);
      setTitle("");
      setBody("");
      setAttachments([]);
      setShowComposer(false);
      await load();
    } catch (err) {
      Alert.alert("Envoi impossible", err instanceof Error ? err.message : "Réessayez.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>{unread} non lue(s) · synchronisées avec le Web</Text>
        </View>
        {canCreate ? (
          <TouchableOpacity style={styles.primaryButton} onPress={() => setShowComposer((value) => !value)}>
            <Text style={styles.primaryButtonText}>{showComposer ? "Fermer" : "Nouvelle"}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {showComposer ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nouvelle notification interne</Text>
          <TextInput style={styles.input} placeholder="Titre" value={title} onChangeText={setTitle} />
          <TextInput
            style={[styles.input, styles.bodyInput]}
            placeholder="Message"
            value={body}
            onChangeText={setBody}
            multiline
          />
          <TouchableOpacity style={styles.secondaryButton} onPress={() => void pickAttachments()}>
            <Text style={styles.secondaryButtonText}>Ajouter PDF / JPEG / PNG</Text>
          </TouchableOpacity>
          {attachments.map((item) => <Text key={item.id} style={styles.fileName}>• {item.fileName}</Text>)}
          <TouchableOpacity style={[styles.primaryButton, sending && styles.disabled]} disabled={sending} onPress={() => void submit()}>
            <Text style={styles.primaryButtonText}>{sending ? "Envoi…" : "Envoyer"}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!rows.length && !error ? <Text style={styles.empty}>Aucune notification.</Text> : null}

      {rows.map((row) => (
        <View key={row.id} style={[styles.card, !row.readAt && styles.unreadCard]}>
          <View style={styles.rowTop}>
            <Text style={styles.cardTitle}>{row.title}</Text>
            <Text style={[styles.badge, row.readAt ? styles.readBadge : styles.unreadBadge]}>{row.readAt ? "Lu" : "Non lu"}</Text>
          </View>
          <Text style={styles.body}>{row.body}</Text>
          <Text style={styles.meta}>{row.senderName} · {formatDateTime(row.publishedAt || row.createdAt)}</Text>
          {(row.attachments ?? []).map((attachment) => (
            <TouchableOpacity
              key={attachment.id}
              style={styles.fileButton}
              onPress={async () => {
                try {
                  const uri = await downloadInternalNotificationAttachment(
                    attachment.id,
                    attachment.fileName,
                    activeSchoolCode,
                  );
                  await Linking.openURL(uri);
                } catch (err) {
                  Alert.alert("Téléchargement impossible", err instanceof Error ? err.message : "Réessayez.");
                }
              }}
            >
              <Text style={styles.fileButtonText}>{attachment.fileName}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.actions}>
            {!row.readAt ? (
              <TouchableOpacity style={styles.secondaryButton} onPress={() => void markRead(row)}>
                <Text style={styles.secondaryButtonText}>Marquer comme lu</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.secondaryButton} onPress={() => void archive(row)}>
              <Text style={styles.secondaryButtonText}>Archiver</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { fontSize: 24, fontWeight: "800", color: "#0F172A" },
  subtitle: { marginTop: 4, color: "#64748B" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E2E8F0", padding: 16, gap: 10 },
  unreadCard: { borderColor: "#93C5FD", backgroundColor: "#EFF6FF" },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: "#0F172A" },
  body: { color: "#334155", lineHeight: 20 },
  meta: { color: "#64748B", fontSize: 12 },
  badge: { overflow: "hidden", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: "700" },
  readBadge: { color: "#475569", backgroundColor: "#E2E8F0" },
  unreadBadge: { color: "#1D4ED8", backgroundColor: "#DBEAFE" },
  primaryButton: { minHeight: 44, borderRadius: 12, backgroundColor: "#2563EB", paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800" },
  secondaryButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: "#CBD5E1", paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: "#334155", fontWeight: "700" },
  disabled: { opacity: 0.55 },
  input: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#FFFFFF" },
  bodyInput: { minHeight: 100, textAlignVertical: "top" },
  fileName: { color: "#475569", fontSize: 12 },
  fileButton: { paddingVertical: 6 },
  fileButtonText: { color: "#2563EB", fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  error: { color: "#B91C1C", backgroundColor: "#FEE2E2", borderRadius: 12, padding: 12 },
  empty: { textAlign: "center", color: "#64748B", paddingVertical: 32 },
});
