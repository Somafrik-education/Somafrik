import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import QueryStateView from "../components/QueryStateView";
import StudentSwitcher from "../components/StudentSwitcher";
import { useAdminData } from "../context/AdminDataContext";
import StudentsScopeAlert from "../components/StudentsScopeAlert";
import { useAuth } from "../context/AuthContext";
import { messageThemes } from "../data/catalog";
import { MessagePriority } from "../domain/communication/MessageService";
import {
  canShowStaffMessagesComposer,
  resolveMessagesRouteAccess,
} from "../lib/mobileCtaRbacAlignment";
import {
  buildConversationReplyPayload,
  buildMessagePayload,
  collectSuccessfulAttachmentIds,
  isAllowedMessageAttachmentMime,
  replyPostConfirmAction,
} from "../lib/messageAttachments";
import { mergeRowsById } from "../lib/communicationPagination";
import { hasCommunicationSchoolScope, withCommunicationSchoolPayload } from "../lib/communicationSchoolScope";
import { filterCommunicationRows } from "../lib/communicationListFilter";
import { useMessagesUnreadCount } from "../lib/messagesRead";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { sendClientsMessage, replyClientsConversationMessage, getMessageRecipients, uploadCommunicationAttachment, downloadCommunicationAttachment } from "../services/api";
import { createInFlightLock, createIntentionStore } from "../lib/mutationGuard";
import { NETWORK_COPY } from "../lib/networkResilience";
import { submitProtectedMutation } from "../lib/outbox";
import { KeyboardAvoidingContainer } from "../components/KeyboardAwareScreen";
import AccessibleIconButton from "../components/AccessibleIconButton";
import CommunicationChrome from "../components/CommunicationChrome";
import { MIN_TOUCH_TARGET_DP, USABILITY_TEST_IDS } from "../lib/mobileUsability";
import {
  emptyResourceSnapshot,
  snapshotFromFailure,
  snapshotFromSuccess,
  type ResourceSnapshot,
} from "../lib/dataTruth";
import {
  getCanonicalConversationMessages,
  getCanonicalConversationsPage,
  markCanonicalMessageRead,
  type CanonicalConversation,
  type CanonicalSchoolMessage,
} from "../services/domainHydrationApi";
import type { CanonicalMessageRecipient } from "../services/api";
import type { RootStackParamList } from "../navigation/AppNavigator";

const priorities: MessagePriority[] = ["Faible", "Moyenne", "Haute", "Critique"];

function counterpartName(conversation: CanonicalConversation, selfId?: string) {
  const others = (conversation.participants ?? []).filter((row) => row.userId !== selfId);
  if (!others.length) return conversation.subject || "Conversation";
  return others.map((row) => row.name || row.userId).join(", ");
}

export default function MessagesScreen() {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { session, selectedStudentId } = useAuth();
  const route = useRoute<RouteProp<RootStackParamList, "Messages">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, "Messages">>();
  const {
    loadMessages,
    resourceScopeKey,
    activeSchoolCode,
    requiresSchoolSelection,
  } = useAdminData();

  const [theme, setTheme] = useState(messageThemes[0]);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState("");
  const [priority, setPriority] = useState<MessagePriority>("Moyenne");
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedRecipientUserId, setSelectedRecipientUserId] = useState("");
  const [recipientSnapshot, setRecipientSnapshot] =
    useState<ResourceSnapshot<CanonicalMessageRecipient>>(emptyResourceSnapshot());
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ id: string; fileName: string }>>([]);
  const [conversationsSnapshot, setConversationsSnapshot] =
    useState<ResourceSnapshot<CanonicalConversation>>(emptyResourceSnapshot());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<CanonicalConversation | null>(null);
  const [threadMessages, setThreadMessages] = useState<CanonicalSchoolMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sendHint, setSendHint] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [replyError, setReplyError] = useState("");
  const [replying, setReplying] = useState(false);
  const sendLockRef = useRef(createInFlightLock());
  const sendIntentionRef = useRef(createIntentionStore());
  const replyLockRef = useRef(createInFlightLock());
  const replyIntentionRef = useRef(createIntentionStore());
  const selectedConversationIdRef = useRef("");
  selectedConversationIdRef.current = String(selectedConversation?.id ?? "");

  const role = session?.role;
  const selfId = String(session?.user?.id ?? "");
  const messagesAccess = resolveMessagesRouteAccess(session);
  const canRead = messagesAccess.canReadList;
  const canSend = messagesAccess.canCompose;
  const scopeReady = !requiresSchoolSelection || hasCommunicationSchoolScope(activeSchoolCode);
  const showStaffComposer = canShowStaffMessagesComposer(session) && scopeReady;
  const showComposer =
    scopeReady && (((role === "parent_student" || role === "teacher") && canSend) || showStaffComposer);
  const canReplyInThread = canSend && scopeReady;
  const parentChildren = session?.user.children ?? [];
  const staffSendBlocked =
    showComposer &&
    !selectedConversation?.id &&
    (recipientSnapshot.status !== "success" || !selectedRecipientUserId);
  const { count: unreadApiCount, refresh: refreshUnread } = useMessagesUnreadCount(canRead && scopeReady, activeSchoolCode);

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

  const loadConversations = useCallback(async () => {
    if (!canRead || !scopeReady) {
      setConversationsSnapshot(emptyResourceSnapshot());
      setNextCursor(null);
      return;
    }
    setConversationsSnapshot((current) => ({ status: "loading", data: current.data }));
    try {
      const page = await getCanonicalConversationsPage(activeSchoolCode);
      setConversationsSnapshot(snapshotFromSuccess(page.items));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setConversationsSnapshot(snapshotFromFailure(error, []));
      setNextCursor(null);
    }
  }, [canRead, activeSchoolCode, scopeReady]);

  const loadMoreConversations = useCallback(async () => {
    if (!canRead || !scopeReady || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getCanonicalConversationsPage(activeSchoolCode, { cursor: nextCursor });
      setConversationsSnapshot((current) => snapshotFromSuccess(mergeRowsById(current.data, page.items)));
      setNextCursor(page.nextCursor);
    } catch (error) {
      Alert.alert("Chargement interrompu", error instanceof Error ? error.message : "Réessayez.");
    } finally {
      setLoadingMore(false);
    }
  }, [canRead, activeSchoolCode, scopeReady, nextCursor, loadingMore]);

  useFocusEffect(
    useCallback(() => {
      if (canRead) {
        void loadConversations();
        void loadMessages();
        void refreshUnread();
      }
      if (canSend) void loadCanonicalRecipients();
    }, [canRead, canSend, loadConversations, loadMessages, loadCanonicalRecipients, refreshUnread, resourceScopeKey]),
  );

  const visibleConversations = useMemo(
    () =>
      filterCommunicationRows(
        conversationsSnapshot.data.map((row) => ({
          ...row,
          title: counterpartName(row, selfId),
          excerpt: row.lastMessage?.body || "",
          author: row.lastMessage?.senderName || "",
          unreadCount: row.unreadCount ?? 0,
        })),
        query,
        unreadOnly,
      ),
    [conversationsSnapshot.data, query, unreadOnly, selfId],
  );

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
      conversationId: selectedConversation?.id,
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
      await loadConversations();
      await loadMessages();
      await refreshUnread();
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

  const closeThread = () => {
    selectedConversationIdRef.current = "";
    setSelectedConversation(null);
    setThreadMessages([]);
    setReplyDraft("");
    setReplyError("");
  };

  const replyInThread = async () => {
    if (!replyLockRef.current.tryBegin()) return;
    const conversationId = String(selectedConversation?.id ?? "").trim();
    if (!canReplyInThread || !conversationId) {
      replyLockRef.current.end();
      return;
    }
    const built = buildConversationReplyPayload({
      conversationId,
      message: replyDraft,
    });
    if (!built.ok) {
      replyLockRef.current.end();
      if (built.code === "empty_message") {
        setReplyError("Message est obligatoire.");
      }
      return;
    }
    setReplyError("");
    const payload = withCommunicationSchoolPayload(built.payload, activeSchoolCode);
    const intentionId = `message-reply:${conversationId}:${String(payload.message)}`;
    const idempotencyKey = replyIntentionRef.current.getOrCreate(intentionId);
    setReplying(true);
    try {
      try {
        const submitted = await submitProtectedMutation({
          domain: "messages",
          method: "POST",
          path: `/backoffice/conversations/${encodeURIComponent(conversationId)}/messages`,
          payload,
          idempotencyKey,
          userId: String(session?.user.id ?? ""),
          schoolScope: String(activeSchoolCode || session?.school?.code || session?.user.schoolCode || ""),
          persistOutbox: true,
          request: () => replyClientsConversationMessage(conversationId, payload, { idempotencyKey }),
        });
        if (submitted.outcome !== "confirmed") {
          const queuedLike = submitted.outcome === "queued" || submitted.outcome === "in_flight";
          Alert.alert(
            queuedLike ? NETWORK_COPY.queued : NETWORK_COPY.failed,
            queuedLike
              ? "La réponse est conservée en file d'attente. Elle n'apparaîtra dans le fil qu'après confirmation serveur."
              : submitted.error instanceof Error
                ? submitted.error.message
                : "Impossible d'envoyer la réponse.",
          );
          return;
        }
        replyIntentionRef.current.rotate(intentionId);
        setReplyDraft("");
      } catch (error) {
        Alert.alert("Envoi impossible", error instanceof Error ? error.message : "Impossible d'envoyer la réponse.");
        return;
      }

      try {
        const thread = await getCanonicalConversationMessages(conversationId, activeSchoolCode);
        const apply = replyPostConfirmAction({
          mutationConfirmed: true,
          refreshFailed: false,
          activeConversationId: selectedConversationIdRef.current,
          sentConversationId: conversationId,
        });
        if (apply.applyThread) {
          setThreadMessages(thread);
          try {
            await refreshUnread();
          } catch {
            /* unread stale n'est pas un échec d'envoi */
          }
        }
      } catch {
        const refresh = replyPostConfirmAction({
          mutationConfirmed: true,
          refreshFailed: true,
          activeConversationId: selectedConversationIdRef.current,
          sentConversationId: conversationId,
        });
        if (refresh.announceRefreshWarning) {
          Alert.alert(
            "Fil non actualisé",
            "La réponse a été envoyée. Rouvrez la conversation pour voir le fil à jour.",
          );
        }
      }
    } finally {
      setReplying(false);
      replyLockRef.current.end();
    }
  };

  const openConversation = async (item: CanonicalConversation) => {
    selectedConversationIdRef.current = String(item.id ?? "");
    setSelectedConversation(item);
    setReplyDraft("");
    setReplyError("");
    try {
      const thread = await getCanonicalConversationMessages(item.id, activeSchoolCode);
      setThreadMessages(thread);
      await Promise.all(
        thread
          .filter((row) => row.senderUserId && row.senderUserId !== selfId && !row.readAt)
          .map((row) => markCanonicalMessageRead(row.id, activeSchoolCode).catch(() => null)),
      );
      await loadConversations();
      await refreshUnread();
    } catch {
      setThreadMessages([]);
    }
  };

  const pendingConversationId = String(route.params?.conversationId ?? "").trim();
  useEffect(() => {
    if (!pendingConversationId || !canRead || !scopeReady) return;
    void openConversation({ id: pendingConversationId });
    navigation.setParams({ conversationId: undefined });
  }, [pendingConversationId, canRead, scopeReady, navigation]);

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingContainer>
      <SectionList
        sections={
          canRead && conversationsSnapshot.status === "success"
            ? [{ title: "Conversations", data: visibleConversations }]
            : []
        }
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          canRead ? (
            <RefreshControl
              refreshing={conversationsSnapshot.status === "loading"}
              onRefresh={() => {
                void loadConversations();
                void loadMessages();
                if (canSend) void loadCanonicalRecipients();
                void refreshUnread();
              }}
            />
          ) : undefined
        }
        contentContainerStyle={[styles.content, { paddingBottom: scrollContentPaddingBottom }]}
        ListHeaderComponent={
          <>
        {role === "parent_student" && <StudentSwitcher />}
        <StudentsScopeAlert />
        <CommunicationChrome
          surface="messages"
          title="Communication"
          searchPlaceholder="Rechercher"
          unreadLabel="Non lus"
          countLabel={
            !scopeReady
              ? "Sélectionnez un établissement pour ouvrir Messages."
              : canRead
                ? `${unreadApiCount} non lu(s)`
                : "Rédaction uniquement • lecture non autorisée"
          }
          search={query}
          onSearch={setQuery}
          unreadOnly={unreadOnly}
          onUnreadOnly={setUnreadOnly}
        />

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
        ) : conversationsSnapshot.status !== "success" ? (
          <QueryStateView
            snapshot={conversationsSnapshot}
            emptyMessage="Aucune conversation."
            errorMessage="Impossible de charger les conversations."
            offlineMessage="Réseau indisponible. Les conversations n'ont pas pu être chargées."
            emptyTestId="messages-empty"
            errorTestId="messages-error"
            onRetry={() => void loadConversations()}
            loadingLabel="Chargement des conversations…"
          />
        ) : null}
          </>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>
            {section.title} ({section.data.length})
          </Text>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.messageCard}
            onPress={() => void openConversation(item)}
            accessibilityRole="button"
            accessibilityLabel={item.title}
          >
            <View style={styles.rowTop}>
              <Text style={styles.messageTitle} numberOfLines={1}>{item.title}</Text>
              {(item.unreadCount ?? 0) > 0 ? (
                <Text style={styles.unread}>{item.unreadCount}</Text>
              ) : null}
            </View>
            <Text style={styles.messageBody} numberOfLines={1}>{item.excerpt || "—"}</Text>
            <Text style={styles.meta}>{item.lastMessage?.sentAt || item.updatedAt}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          canRead && conversationsSnapshot.status === "success" ? <Text style={styles.meta}>Aucune conversation.</Text> : null
        }
        ListFooterComponent={
          canRead && conversationsSnapshot.status === "success" && nextCursor ? (
            <TouchableOpacity
              style={[styles.secondaryButton, loadingMore && styles.disabled]}
              onPress={() => void loadMoreConversations()}
              disabled={loadingMore}
              testID="messages-load-more"
              accessibilityRole="button"
              accessibilityLabel="Charger les conversations plus anciennes"
              accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
            >
              <Text style={styles.secondaryButtonText}>
                {loadingMore ? "Chargement…" : "Charger les conversations plus anciennes"}
              </Text>
            </TouchableOpacity>
          ) : null
        }
      />
      </KeyboardAvoidingContainer>

      <Modal visible={Boolean(selectedConversation)} transparent animationType="fade" onRequestClose={closeThread}>
        <KeyboardAvoidingContainer>
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.readerCard} keyboardShouldPersistTaps="handled">
            <AccessibleIconButton
              accessibilityLabel="Fermer le message"
              icon="close"
              onPress={closeThread}
              style={styles.closeButton}
            />
            <Text style={styles.cardTitle}>{selectedConversation ? counterpartName(selectedConversation, selfId) : ""}</Text>
            {threadMessages.map((item) => (
              <View key={item.id}>
                <Text style={styles.meta}>
                  {item.senderName || item.senderUserId} • {item.sentAt || item.date}
                </Text>
                <Text style={styles.readerBody}>{item.message || item.theme}</Text>
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
            {canReplyInThread ? (
              <View style={styles.threadReply} testID="messages-thread-reply-composer">
                <FormField
                  label="Réponse"
                  required
                  type="multiline"
                  value={replyDraft}
                  onChangeText={(value) => {
                    setReplyDraft(value);
                    setReplyError("");
                  }}
                  placeholder="Écrire une réponse…"
                  editable={!replying}
                  autoCorrect
                  error={replyError}
                  accessibilityLabel="Texte de la réponse"
                  testID="messages-thread-reply-input"
                />
                <TouchableOpacity
                  style={[styles.sendButton, styles.threadSendButton, replying && styles.disabled]}
                  onPress={() => void replyInThread()}
                  disabled={replying}
                  testID="messages-thread-reply-send"
                  accessibilityRole="button"
                  accessibilityLabel="Envoyer la réponse"
                  accessibilityState={{ busy: replying, disabled: replying }}
                >
                  {replying ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="send-outline" size={20} color="#FFFFFF" />}
                  <Text style={styles.sendText}>{replying ? NETWORK_COPY.recording : "Envoyer"}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.meta} testID="messages-thread-reply-forbidden">
                La réponse n'est pas autorisée.
              </Text>
            )}
          </ScrollView>
        </View>
        </KeyboardAvoidingContainer>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 16 },
  composeCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 14, marginBottom: 12 },
  cardTitle: { color: "#0F172A", fontSize: 16, fontWeight: "800", marginBottom: 10 },
  label: { color: "#334155", fontSize: 12, fontWeight: "800", marginBottom: 6 },
  choiceRow: { gap: 8, marginBottom: 12 },
  segmentRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  segmentButton: { flex: 1, minHeight: MIN_TOUCH_TARGET_DP, alignItems: "center", justifyContent: "center", borderRadius: 14, padding: 10, backgroundColor: "#F1F5F9" },
  chip: { borderRadius: 999, paddingHorizontal: 12, minHeight: MIN_TOUCH_TARGET_DP, justifyContent: "center", paddingVertical: 8, backgroundColor: "#F1F5F9" },
  chipActive: { backgroundColor: "#0F172A" },
  chipText: { color: "#475569", fontWeight: "800" },
  chipTextActive: { color: "#FFFFFF" },
  sendButton: { backgroundColor: "#2563EB", borderRadius: 14, padding: 14, flexDirection: "row", justifyContent: "center", alignItems: "center" },
  threadReply: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E2E8F0" },
  threadSendButton: { minHeight: MIN_TOUCH_TARGET_DP, marginTop: 4 },
  sendText: { color: "#FFFFFF", fontWeight: "900", marginLeft: 8 },
  disabled: { opacity: 0.5 },
  errorText: { color: "#B91C1C", fontWeight: "800", padding: 14 },
  sectionTitle: { color: "#0F172A", fontSize: 16, fontWeight: "800", marginBottom: 8 },
  messageCard: { backgroundColor: "#FFFFFF", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, borderWidth: 1, borderColor: "#E2E8F0" },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  messageTitle: { flex: 1, color: "#0F172A", fontWeight: "800" },
  unread: { color: "#FFFFFF", backgroundColor: "#DC2626", overflow: "hidden", borderRadius: 9, paddingHorizontal: 6, fontSize: 11, fontWeight: "800" },
  meta: { color: "#64748B", fontWeight: "600", marginTop: 4, fontSize: 12 },
  messageBody: { color: "#334155", marginTop: 4 },
  secondaryButton: { minHeight: 42, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: "#CBD5E1", paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: "#334155", fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "center", padding: 20 },
  readerCard: { backgroundColor: "#FFFFFF", borderRadius: 22, padding: 18 },
  closeButton: { alignSelf: "flex-end", padding: 8 },
  readerBody: { color: "#0F172A", fontSize: 16, fontWeight: "700", lineHeight: 24, marginTop: 12 },
});
