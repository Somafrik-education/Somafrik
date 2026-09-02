import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import FormField from "../components/FormField";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import StudentSwitcher from "../components/StudentSwitcher";
import { useAdminData } from "../context/AdminDataContext";
import StudentsScopeAlert from "../components/StudentsScopeAlert";
import { useAuth } from "../context/AuthContext";
import { messageThemes } from "../data/catalog";
import { MessagePriority, MessageService } from "../domain/communication/MessageService";
import {
  canShowStaffMessagesComposer,
  resolveMessagesRouteAccess,
} from "../lib/mobileCtaRbacAlignment";
import { buildMessagePayload, collectSuccessfulAttachmentIds, isAllowedMessageAttachmentMime } from "../lib/messageAttachments";
import { hasCommunicationSchoolScope, withCommunicationSchoolPayload } from "../lib/communicationSchoolScope";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { sendClientsMessage, getMessageRecipients, uploadCommunicationAttachment, downloadCommunicationAttachment } from "../services/api";
import { createInFlightLock, createIntentionStore } from "../lib/mutationGuard";
import { NETWORK_COPY } from "../lib/networkResilience";
import { submitProtectedMutation } from "../lib/outbox";
import { KeyboardAvoidingContainer } from "../components/KeyboardAwareScreen";
import AccessibleIconButton from "../components/AccessibleIconButton";
import { MIN_TOUCH_TARGET_DP, USABILITY_TEST_IDS } from "../lib/mobileUsability";
import {
  emptyResourceSnapshot,
  snapshotFromFailure,
  snapshotFromSuccess,
  type ResourceSnapshot,
} from "../lib/dataTruth";
import { markCanonicalMessageRead, type CanonicalSchoolMessage } from "../services/domainHydrationApi";
import type { CanonicalMessageRecipient } from "../services/api";

const messageService = new MessageService();
const priorities: MessagePriority[] = ["Faible", "Moyenne", "Haute", "Critique"];

export default function MessagesScreen() {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { session, selectedStudentId } = useAuth();
  const {
    messagesSnapshot,
    loadMessages,
    resourceScopeKey,
    activeSchoolCode,
    requiresSchoolSelection,
    establishmentStudents,
  } = useAdminData();

  const [theme, setTheme] = useState(messageThemes[0]);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState("");
  const [priority, setPriority] = useState<MessagePriority>("Moyenne");
  const [query, setQuery] = useState("");
  const [selectedRecipientUserId, setSelectedRecipientUserId] = useState("");
  const [recipientSnapshot, setRecipientSnapshot] =
    useState<ResourceSnapshot<CanonicalMessageRecipient>>(emptyResourceSnapshot());
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ id: string; fileName: string }>>([]);
  const [selectedMessage, setSelectedMessage] = useState<CanonicalSchoolMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [sendHint, setSendHint] = useState("");
  const sendLockRef = useRef(createInFlightLock());
  const sendIntentionRef = useRef(createIntentionStore());

  const role = session?.role;
  const messagesAccess = resolveMessagesRouteAccess(session);
  const canRead = messagesAccess.canReadList;
  const canSend = messagesAccess.canCompose;
  const scopeReady = !requiresSchoolSelection || hasCommunicationSchoolScope(activeSchoolCode);
  const showStaffComposer = canShowStaffMessagesComposer(session) && scopeReady;
  const showComposer =
    scopeReady && (((role === "parent_student" || role === "teacher") && canSend) || showStaffComposer);
  const parentPhone = session?.user.parentPhone ?? session?.user.children?.[0]?.parentPhone ?? "";
  const parentChildren = session?.user.children ?? [];
  const teacherStudents = establishmentStudents;
  const staffSendBlocked =
    showComposer &&
    !selectedMessage?.conversationId &&
    (recipientSnapshot.status !== "success" || !selectedRecipientUserId);

  const loadCanonicalRecipients = useCallback(async () => {
    if (!canSend || !scopeReady) {
      setRecipientSnapshot(emptyResourceSnapshot());
      setSelectedRecipientUserId("");
      return;
    }
    setRecipientSnapshot({ status: "loading", data: [] });
    try {
      const rows = await getMessageRecipients(activeSchoolCode);
      setRecipientSnapshot(snapshotFromSuccess(rows));
      setSelectedRecipientUserId((current) =>
        rows.some((row) => row.userId === current) ? current : "",
      );
    } catch (error) {
      setRecipientSnapshot(snapshotFromFailure(error, []));
      setSelectedRecipientUserId("");
    }
  }, [canSend, activeSchoolCode, scopeReady]);

  useFocusEffect(
    useCallback(() => {
      if (canRead) void loadMessages();
      if (canSend) void loadCanonicalRecipients();
    }, [canRead, canSend, loadMessages, loadCanonicalRecipients, resourceScopeKey]),
  );

  const roleMessages = useMemo(() => {
    const messages = messagesSnapshot.data;
    if (role === "teacher") {
      return messages.filter(
        (item) =>
          (item.direction === "Parent vers enseignant" || item.direction === "Enseignant vers parent") &&
          (item.teacherId === session?.user.id || teacherStudents.some((student) => student.parentPhone === item.parentPhone)),
      );
    }
    if (role === "parent_student" || role === "student") {
      return messages.filter((item) => item.parentPhone === parentPhone);
    }
    return messages;
  }, [messagesSnapshot.data, parentPhone, role, session?.user.id, teacherStudents]);

  const visibleMessages = useMemo(() => messageService.search(roleMessages, query), [query, roleMessages]);
  const receivedMessages = useMemo(
    () => visibleMessages.filter((item) => isReceivedMessage(item, role, session)),
    [role, session, visibleMessages],
  );
  const sentMessages = useMemo(
    () => visibleMessages.filter((item) => !isReceivedMessage(item, role, session)),
    [role, session, visibleMessages],
  );
  const unreadCount = messageService.countUnreadForRole(role, session, visibleMessages);

  const pickAndUploadAttachments = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png"],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (picked.canceled) return;
      const assets = picked.assets ?? [];
      const uploads: Array<{ ok: boolean; id?: string }> = [];
      for (const asset of assets) {
        const mimeType = asset.mimeType || "";
        if (!isAllowedMessageAttachmentMime(mimeType)) {
          Alert.alert("Fichier refusé", "Seuls PDF, JPEG et PNG sont acceptés.");
          return;
        }
        try {
          const saved = await uploadCommunicationAttachment({
            uri: asset.uri,
            name: asset.name || "fichier",
            mimeType,
          }, activeSchoolCode);
          uploads.push({ ok: true, id: saved.id });
          setPendingAttachments((current) => [...current, { id: saved.id, fileName: saved.fileName || asset.name || saved.id }]);
        } catch (error) {
          uploads.push({ ok: false });
          Alert.alert("Upload échoué", error instanceof Error ? error.message : "Impossible d'envoyer la pièce jointe.");
          return;
        }
      }
      const collected = collectSuccessfulAttachmentIds(uploads);
      if (!collected.ok) {
        Alert.alert("Upload échoué", "Le message n'a pas été envoyé.");
      }
    } catch (error) {
      Alert.alert("Pièce jointe", error instanceof Error ? error.message : "Sélection impossible.");
    }
  };

  const pickImageAttachment = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photos", "Autorisez l'accès à la galerie pour joindre une image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType || "image/jpeg";
    if (!isAllowedMessageAttachmentMime(mimeType)) {
      Alert.alert("Fichier refusé", "Seuls PDF, JPEG et PNG sont acceptés.");
      return;
    }
    try {
      const saved = await uploadCommunicationAttachment({
        uri: asset.uri,
        name: asset.fileName || "image.jpg",
        mimeType,
      }, activeSchoolCode);
      setPendingAttachments((current) => [...current, { id: saved.id, fileName: saved.fileName || saved.id }]);
    } catch (error) {
      Alert.alert("Upload échoué", error instanceof Error ? error.message : "Impossible d'envoyer la pièce jointe.");
    }
  };

  const sendMessage = async () => {
    if (!sendLockRef.current.tryBegin()) return;
    if (!canSend || !scopeReady) {
      sendLockRef.current.end();
      return;
    }
    if (!message.trim()) {
      sendLockRef.current.end();
      setMessageError("Message est obligatoire.");
      return;
    }
    setMessageError("");
    const selected = recipientSnapshot.data.find((row) => row.userId === selectedRecipientUserId);
    const built = buildMessagePayload({
      message,
      recipientUserId: selectedRecipientUserId,
      conversationId: selectedMessage?.conversationId,
      studentId: selected?.studentId || selectedStudentId || parentChildren[0]?.id,
      attachmentIds: pendingAttachments.map((file) => file.id),
      theme,
      priority,
    });
    if (!built.ok) {
      sendLockRef.current.end();
      Alert.alert(
        built.code === "empty_message" ? "Message incomplet" : "Destinataire requis",
        built.code === "client_attachment_url_forbidden"
          ? "Les URL libres ne sont pas acceptées."
          : "Choisissez un destinataire autorisé avant l'envoi.",
      );
      return;
    }
    const payload = withCommunicationSchoolPayload(built.payload, activeSchoolCode);
    const intentionId = `message:${String(payload.conversationId || payload.participantUserIds)}:${String(payload.message)}`;
    const idempotencyKey = sendIntentionRef.current.getOrCreate(intentionId);
    setSending(true);
    setSendHint(NETWORK_COPY.recording);
    try {
      const submitted = await submitProtectedMutation({
        domain: "messages",
        method: "POST",
        path: "/backoffice/messages",
        payload,
        idempotencyKey,
        userId: String(session?.user.id ?? ""),
        schoolScope: String(activeSchoolCode || session?.school?.code || session?.user.schoolCode || ""),
        persistOutbox: true,
        request: () => sendClientsMessage(payload, { idempotencyKey }),
      });
      if (submitted.outcome !== "confirmed") {
        const queuedLike = submitted.outcome === "queued" || submitted.outcome === "in_flight";
        setSendHint(queuedLike ? NETWORK_COPY.queued : NETWORK_COPY.failed);
        Alert.alert(
          queuedLike ? NETWORK_COPY.queued : NETWORK_COPY.failed,
          queuedLike
            ? "Le message est conservé en file d'attente. Il ne sera marqué envoyé qu'après confirmation serveur."
            : submitted.error instanceof Error
              ? submitted.error.message
              : "Impossible d'envoyer le message.",
        );
        return;
      }
      sendIntentionRef.current.rotate(intentionId);
      await loadMessages();
      setMessage("");
      setPendingAttachments([]);
      setSendHint("");
      Alert.alert("Message envoyé", "Le serveur a confirmé l'envoi du message.");
    } catch (error) {
      setSendHint(NETWORK_COPY.failed);
      Alert.alert("Envoi impossible", error instanceof Error ? error.message : "Impossible d'envoyer le message.");
    } finally {
      setSending(false);
      sendLockRef.current.end();
    }
  };

  const openMessage = async (item: CanonicalSchoolMessage) => {
    setSelectedMessage(item);
    if (!isReceivedMessage(item, role, session) || !isUnreadStatus(item.status)) return;
    try {
      const updated = await markCanonicalMessageRead(item.id, activeSchoolCode);
      if (updated) setSelectedMessage(updated);
      await loadMessages();
    } catch {
      // Aucun faux statut local : l'état serveur reste l'autorité.
    }
  };

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingContainer>
      <SectionList
        sections={
          canRead && messagesSnapshot.status === "success"
            ? [
                { title: "Messages reçus", data: receivedMessages },
                { title: "Messages envoyés", data: sentMessages },
              ]
            : []
        }
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          canRead ? (
            <RefreshControl
              refreshing={messagesSnapshot.status === "loading"}
              onRefresh={() => {
                void loadMessages();
                if (canSend) void loadCanonicalRecipients();
              }}
            />
          ) : undefined
        }
        contentContainerStyle={[styles.content, { paddingBottom: scrollContentPaddingBottom }]}
        ListHeaderComponent={
          <>
        {role === "parent_student" && <StudentSwitcher />}
        <StudentsScopeAlert />
        <Text style={styles.title}>Messages</Text>
        {!scopeReady ? (
          <Text style={styles.subtitle}>Sélectionnez un établissement pour ouvrir Messages.</Text>
        ) : (
          <Text style={styles.subtitle}>
            {canRead ? `${unreadCount} non lu(s) • données serveur` : "Rédaction uniquement • lecture non autorisée"}
          </Text>
        )}

        {showComposer && (
          <View style={styles.composeCard} testID={USABILITY_TEST_IDS.messagesComposer}>
            <Text style={styles.cardTitle}>{role === "teacher" ? "Écrire à un parent" : "Écrire un message"}</Text>
            {recipientSnapshot.status !== "success" ? (
              <QueryStateView
                snapshot={recipientSnapshot}
                emptyMessage="Aucun destinataire autorisé."
                errorMessage="Impossible de charger les destinataires."
                offlineMessage="Réseau indisponible. Les destinataires n'ont pas pu être chargés."
                emptyTestId="messages-staff-recipients-empty"
                errorTestId="messages-staff-recipients-error"
                onRetry={() => void loadCanonicalRecipients()}
                loadingLabel="Chargement des destinataires…"
              />
            ) : (
              <ChoiceRow
                label="Destinataire"
                values={recipientSnapshot.data.map((row) => ({
                  id: row.userId,
                  label: row.studentName ? `${row.displayName} (${row.studentName})` : row.displayName || row.userId,
                }))}
                selectedId={selectedRecipientUserId}
                onSelect={setSelectedRecipientUserId}
                disabled={sending}
              />
            )}

            <ChoiceRow
              label="Thème"
              values={messageThemes.map((item) => ({ id: item, label: item }))}
              selectedId={theme}
              onSelect={setTheme}
              disabled={sending}
            />
            <ChoiceRow
              label="Priorité"
              values={priorities.map((item) => ({ id: item, label: item }))}
              selectedId={priority}
              onSelect={(value) => setPriority(value as MessagePriority)}
              disabled={sending}
            />

            <FormField
              label="Message"
              required
              type="multiline"
              value={message}
              onChangeText={(value) => {
                setMessage(value);
                setMessageError("");
              }}
              placeholder="Ex. Expliquez votre message…"
              editable={!sending}
              autoCorrect
              error={messageError}
              accessibilityLabel="Texte du message"
            />
            {pendingAttachments.length ? (
              <Text style={styles.meta}>{pendingAttachments.map((file) => file.fileName).join(", ")}</Text>
            ) : null}
            <View style={styles.segmentRow}>
              <SegmentButton label="PDF / fichier" selected={false} onPress={() => void pickAndUploadAttachments()} />
              <SegmentButton label="Image" selected={false} onPress={() => void pickImageAttachment()} />
            </View>
            <TouchableOpacity
              style={[styles.sendButton, (sending || staffSendBlocked) && styles.disabled]}
              onPress={() => void sendMessage()}
              disabled={sending || staffSendBlocked}
              testID={USABILITY_TEST_IDS.messagesSend}
              accessibilityRole="button"
              accessibilityLabel="Envoyer le message"
              accessibilityState={{ busy: sending, disabled: sending || staffSendBlocked }}
            >
              {sending ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="send-outline" size={20} color="#FFFFFF" />}
              <Text style={styles.sendText}>{sending ? NETWORK_COPY.recording : "Envoyer"}</Text>
            </TouchableOpacity>
            {sendHint ? <Text style={styles.meta}>{sendHint}</Text> : null}
          </View>
        )}

        {!canRead ? (
          <Text style={styles.errorText}>
            {canSend
              ? showComposer
                ? "Lecture des messages non autorisée. Le composer reste disponible."
                : "Lecture non autorisée."
              : "Accès refusé aux messages."}
          </Text>
        ) : messagesSnapshot.status !== "success" ? (
          <QueryStateView
            snapshot={messagesSnapshot}
            emptyMessage="Aucun message pour ce compte."
            errorMessage="Impossible de charger les messages."
            offlineMessage="Réseau indisponible. Les messages n'ont pas pu être chargés."
            emptyTestId="messages-empty"
            errorTestId="messages-error"
            onRetry={() => void loadMessages()}
            loadingLabel="Chargement des messages…"
          />
        ) : (
          <FormField
            label="Recherche"
            hideVisibleLabel
            type="search"
            value={query}
            onChangeText={setQuery}
            placeholder="Ex. thème ou parent"
            accessibilityLabel="Rechercher un message"
          />
        )}
          </>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>
            {section.title} ({section.data.length})
          </Text>
        )}
        renderItem={({ item }) => {
          return (
            <TouchableOpacity style={styles.messageCard} onPress={() => void openMessage(item)} accessibilityRole="button" accessibilityLabel={item.theme}>
              <Text style={styles.messageTitle}>{item.theme}</Text>
              <Text style={styles.meta}>
                {item.senderName || item.direction} • {item.sentAt || item.date}
              </Text>
              <Text style={styles.messageBody} numberOfLines={3}>{item.message}</Text>
              <Text style={styles.status}>Statut : {item.status}</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          canRead && messagesSnapshot.status === "success" ? <Text style={styles.meta}>Aucun message.</Text> : null
        }
      />
      </KeyboardAvoidingContainer>

      <Modal visible={Boolean(selectedMessage)} transparent animationType="fade" onRequestClose={() => setSelectedMessage(null)}>
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.readerCard} keyboardShouldPersistTaps="handled">
            <AccessibleIconButton
              accessibilityLabel="Fermer le message"
              icon="close"
              onPress={() => setSelectedMessage(null)}
              style={styles.closeButton}
            />
            <Text style={styles.cardTitle}>{selectedMessage?.theme}</Text>
            <Text style={styles.meta}>
              {selectedMessage?.senderName || selectedMessage?.senderUserId || selectedMessage?.direction} •{" "}
              {selectedMessage?.sentAt || selectedMessage?.date}
            </Text>
            {selectedMessage?.status ? <Text style={styles.status}>Statut : {selectedMessage.status}</Text> : null}
            {visibleMessages
              .filter((item) => item.conversationId && item.conversationId === selectedMessage?.conversationId)
              .sort((a, b) => String(a.sentAt ?? a.date).localeCompare(String(b.sentAt ?? b.date)))
              .map((item) => (
                <View key={item.id}>
                  <Text style={styles.meta}>
                    {item.senderName || item.direction} • {item.sentAt || item.date}
                    {item.status === "pending" ? " • en attente d'envoi" : ""}
                  </Text>
                  <Text style={styles.readerBody}>{item.message}</Text>
                  {(item.attachments ?? []).map((file) => (
                    <TouchableOpacity
                      key={file.id}
                      onPress={() => {
                        void downloadCommunicationAttachment(file.id, file.fileName, activeSchoolCode)
                          .then((uri) => Linking.openURL(uri))
                          .catch((error) =>
                            Alert.alert(
                              "Téléchargement refusé",
                              error instanceof Error ? error.message : "Pièce jointe inaccessible.",
                            ),
                          );
                      }}
                    >
                      <Text style={styles.meta}>{file.fileName}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            {selectedMessage &&
            !visibleMessages.some((item) => item.conversationId === selectedMessage.conversationId) ? (
              <Text style={styles.readerBody}>{selectedMessage.message}</Text>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function ChoiceRow({ label, values, selectedId, onSelect, disabled }: {
  label: string;
  values: Array<{ id: string; label: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
        {values.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.chip, selectedId === item.id && styles.chipActive]}
            onPress={() => onSelect(item.id)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${label} ${item.label}`}
            accessibilityState={{ selected: selectedId === item.id, disabled }}
          >
            <Text style={[styles.chipText, selectedId === item.id && styles.chipTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </>
  );
}

function SegmentButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.segmentButton, selected && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function isUnreadStatus(status?: string) {
  return ["Nouveau", "Distribué", "Envoyé"].includes(String(status));
}

function isReceivedMessage(message: CanonicalSchoolMessage, role: string | undefined, session: any) {
  if (
    [
      "super_admin",
      "school_admin",
      "country_admin",
      "principal",
      "proviseur",
      "prefet",
      "secretary",
      "accountant",
      "adjoint",
      "supervisor",
    ].includes(String(role))
  ) {
    return message.direction === "Parent vers école";
  }
  if (role === "teacher") return message.direction === "Parent vers enseignant" && message.teacherId === session?.user.id;
  return message.direction === "École vers parent" || message.direction === "Enseignant vers parent";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  title: { color: "#0F172A", fontSize: 30, fontWeight: "900" },
  subtitle: { color: "#64748B", fontWeight: "700", marginTop: 4, marginBottom: 16 },
  composeCard: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 16, marginBottom: 18 },
  cardTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginBottom: 10 },
  label: { color: "#334155", fontSize: 12, fontWeight: "900", marginBottom: 6 },
  choiceRow: { gap: 8, marginBottom: 12 },
  segmentRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  segmentButton: { flex: 1, minHeight: MIN_TOUCH_TARGET_DP, alignItems: "center", justifyContent: "center", borderRadius: 14, padding: 10, backgroundColor: "#F1F5F9" },
  chip: { borderRadius: 999, paddingHorizontal: 12, minHeight: MIN_TOUCH_TARGET_DP, justifyContent: "center", paddingVertical: 8, backgroundColor: "#F1F5F9" },
  chipActive: { backgroundColor: "#0F172A" },
  chipText: { color: "#475569", fontWeight: "800" },
  chipTextActive: { color: "#FFFFFF" },
  input: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 14, padding: 12, marginBottom: 12, color: "#0F172A" },
  messageInput: { minHeight: 100, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 14, padding: 12, marginBottom: 12, color: "#0F172A", textAlignVertical: "top" },
  sendButton: { backgroundColor: "#2563EB", borderRadius: 14, padding: 14, flexDirection: "row", justifyContent: "center", alignItems: "center" },
  sendText: { color: "#FFFFFF", fontWeight: "900", marginLeft: 8 },
  disabled: { opacity: 0.5 },
  errorText: { color: "#B91C1C", fontWeight: "800", padding: 14 },
  section: { marginBottom: 18 },
  sectionTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginBottom: 8 },
  messageCard: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 14, marginBottom: 10 },
  messageTitle: { color: "#0F172A", fontWeight: "900" },
  meta: { color: "#64748B", fontWeight: "700", marginTop: 4 },
  messageBody: { color: "#334155", fontWeight: "700", marginTop: 8, lineHeight: 20 },
  status: { color: "#2563EB", fontWeight: "800", marginTop: 8 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "center", padding: 20 },
  readerCard: { backgroundColor: "#FFFFFF", borderRadius: 22, padding: 18 },
  closeButton: { alignSelf: "flex-end", padding: 8 },
  readerBody: { color: "#0F172A", fontSize: 16, fontWeight: "700", lineHeight: 24, marginTop: 12 },
});
