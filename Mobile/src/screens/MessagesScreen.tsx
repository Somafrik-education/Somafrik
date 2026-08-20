import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import StudentSwitcher from "../components/StudentSwitcher";
import { useAdminData } from "../context/AdminDataContext";
import { useAuth } from "../context/AuthContext";
import { messageThemes } from "../data/catalog";
import { MessagePriority, MessageService } from "../domain/communication/MessageService";
import { canMutateEntity, canReadRoute } from "../domain/security/permissions";
import { classNameMatches, scopedStudentsForSession } from "../lib/establishment";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { sendClientsMessage } from "../services/api";
import { createInFlightLock, createIntentionStore } from "../lib/mutationGuard";
import { NETWORK_COPY } from "../lib/networkResilience";
import { submitProtectedMutation } from "../lib/outbox";
import { KeyboardAvoidingContainer } from "../components/KeyboardAwareScreen";
import AccessibleIconButton from "../components/AccessibleIconButton";
import { MIN_TOUCH_TARGET_DP, USABILITY_TEST_IDS } from "../lib/mobileUsability";
import {
  markCanonicalMessageRead,
  type CanonicalSchoolMessage,
} from "../services/domainHydrationApi";

const messageService = new MessageService();
const priorities: MessagePriority[] = ["Faible", "Moyenne", "Haute", "Critique"];

export default function MessagesScreen() {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { session, selectedStudentId } = useAuth();
  const { studentsData, assignmentsData, classesData, messagesSnapshot, loadMessages, teachersSnapshot, loadTeachers, resourceScopeKey } = useAdminData();

  const [theme, setTheme] = useState(messageThemes[0]);
  const [message, setMessage] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [priority, setPriority] = useState<MessagePriority>("Moyenne");
  const [query, setQuery] = useState("");
  const [recipient, setRecipient] = useState<"school" | "teacher">("school");
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [teacherStudentId, setTeacherStudentId] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<CanonicalSchoolMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [sendHint, setSendHint] = useState("");
  const sendLockRef = useRef(createInFlightLock());
  const sendIntentionRef = useRef(createIntentionStore());

  const role = session?.role;
  const canRead = canReadRoute(session, "Messages");
  const canSend =
    canMutateEntity(session, "messages", "CREATE") ||
    role === "parent_student" ||
    role === "teacher";
  const parentPhone = session?.user.parentPhone ?? session?.user.children?.[0]?.parentPhone ?? "";
  const parentChildren = session?.user.children ?? [];
  const teachersData = teachersSnapshot.data;
  const teacherScopeState = { teachers: teachersData, assignments: assignmentsData, classes: classesData };
  const teacherStudents = scopedStudentsForSession(session, studentsData, teacherScopeState);

  useFocusEffect(
    useCallback(() => {
      if (canRead) void loadMessages();
      if (role === "parent_student" || role === "teacher") void loadTeachers();
    }, [canRead, loadMessages, loadTeachers, role, resourceScopeKey]),
  );

  const availableTeachers = useMemo(() => {
    if (role !== "parent_student") return teachersData;
    const childrenClasses = parentChildren.map((child) => child.className);
    return teachersData.filter((teacher) =>
      (teacher.assignments ?? []).some((assignment) =>
        childrenClasses.some((className) => classNameMatches(assignment.className, className)),
      ),
    );
  }, [parentChildren, role, teachersData]);

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

  const sendMessage = async () => {
    if (!sendLockRef.current.tryBegin()) return;
    if (!canSend) {
      sendLockRef.current.end();
      return;
    }
    if (!message.trim()) {
      sendLockRef.current.end();
      Alert.alert("Message incomplet", "Veuillez écrire votre message avant l'envoi.");
      return;
    }

    let payload: Record<string, unknown> | null = null;
    if (role === "parent_student") {
      const teacherId = recipient === "teacher" ? selectedTeacherId || availableTeachers[0]?.id : "";
      if (recipient === "teacher" && !teacherId) {
        sendLockRef.current.end();
        Alert.alert("Enseignant requis", "Veuillez choisir un enseignant.");
        return;
      }
      payload = {
        parentPhone,
        studentId: selectedStudentId ?? parentChildren[0]?.id ?? "",
        ...(teacherId ? { teacherId } : {}),
        theme,
        direction: recipient === "teacher" ? "Parent vers enseignant" : "Parent vers école",
        message: message.trim(),
        ...(attachmentUrl.trim() ? { attachmentUrl: attachmentUrl.trim() } : {}),
        priority,
      };
    } else if (role === "teacher") {
      const student = teacherStudents.find((item) => item.id === teacherStudentId) ?? teacherStudents[0];
      if (!student) {
        sendLockRef.current.end();
        Alert.alert("Parent introuvable", "Aucun parent n'est lié à vos classes.");
        return;
      }
      payload = {
        parentPhone: student.parentPhone,
        studentId: student.id,
        theme,
        direction: "Enseignant vers parent",
        message: message.trim(),
        ...(attachmentUrl.trim() ? { attachmentUrl: attachmentUrl.trim() } : {}),
        priority,
      };
    }

    if (!payload) {
      sendLockRef.current.end();
      return;
    }
    const intentionId = `message:${String(payload.direction)}:${String(payload.studentId)}:${String(payload.message)}`;
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
        schoolScope: String(session?.school?.code ?? session?.user.schoolCode ?? ""),
        persistOutbox: true,
        request: () => sendClientsMessage(payload, { idempotencyKey }),
      });
      if (submitted.outcome !== "confirmed") {
        setSendHint(submitted.outcome === "queued" ? NETWORK_COPY.queued : NETWORK_COPY.failed);
        Alert.alert(
          submitted.outcome === "queued" ? NETWORK_COPY.queued : NETWORK_COPY.failed,
          submitted.outcome === "queued"
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
      setAttachmentUrl("");
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
      const updated = await markCanonicalMessageRead(item.id);
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
                if (role === "parent_student" || role === "teacher") void loadTeachers();
              }}
            />
          ) : undefined
        }
        contentContainerStyle={[styles.content, { paddingBottom: scrollContentPaddingBottom }]}
        ListHeaderComponent={
          <>
        {role === "parent_student" && <StudentSwitcher />}
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.subtitle}>{unreadCount} non lu(s) • données serveur</Text>

        {(role === "parent_student" || role === "teacher") && canSend && (
          <View style={styles.composeCard} testID={USABILITY_TEST_IDS.messagesComposer}>
            <Text style={styles.cardTitle}>{role === "teacher" ? "Écrire à un parent" : "Écrire un message"}</Text>

            {role === "teacher" && (
              <ChoiceRow
                label="Parent"
                values={teacherStudents.map((student) => ({ id: student.id, label: student.name }))}
                selectedId={teacherStudentId || teacherStudents[0]?.id || ""}
                onSelect={setTeacherStudentId}
                disabled={sending}
              />
            )}

            {role === "parent_student" && (
              <View style={styles.segmentRow}>
                <SegmentButton label="École" selected={recipient === "school"} onPress={() => setRecipient("school")} />
                <SegmentButton
                  label="Enseignant"
                  selected={recipient === "teacher"}
                  onPress={() => {
                    setRecipient("teacher");
                    setSelectedTeacherId((current) => current || availableTeachers[0]?.id || "");
                  }}
                />
              </View>
            )}

            {role === "parent_student" && recipient === "teacher" && (
              <ChoiceRow
                label="Enseignant"
                values={availableTeachers.map((teacher) => ({ id: teacher.id, label: teacher.name || teacher.teacherCode }))}
                selectedId={selectedTeacherId}
                onSelect={setSelectedTeacherId}
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

            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Expliquez votre message..."
              multiline
              editable={!sending}
              style={styles.messageInput}
              textAlignVertical="top"
              autoCapitalize="sentences"
              autoCorrect
              returnKeyType="default"
              accessibilityLabel="Texte du message"
            />
            <TextInput
              value={attachmentUrl}
              onChangeText={setAttachmentUrl}
              placeholder="Lien de pièce jointe (optionnel)"
              editable={!sending}
              autoCapitalize="none"
              keyboardType="url"
              style={styles.input}
              accessibilityLabel="Lien de pièce jointe"
            />
            <TouchableOpacity
              style={[styles.sendButton, sending && styles.disabled]}
              onPress={() => void sendMessage()}
              disabled={sending}
              testID={USABILITY_TEST_IDS.messagesSend}
              accessibilityRole="button"
              accessibilityLabel="Envoyer le message"
              accessibilityState={{ busy: sending, disabled: sending }}
            >
              {sending ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="send-outline" size={20} color="#FFFFFF" />}
              <Text style={styles.sendText}>{sending ? NETWORK_COPY.recording : "Envoyer"}</Text>
            </TouchableOpacity>
            {sendHint ? <Text style={styles.meta}>{sendHint}</Text> : null}
          </View>
        )}

        {!canRead ? (
          <Text style={styles.errorText}>Accès refusé aux messages.</Text>
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
          <TextInput value={query} onChangeText={setQuery} placeholder="Rechercher" style={styles.input} accessibilityLabel="Rechercher un message" />
        )}
          </>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>
            {section.title} ({section.data.length})
          </Text>
        )}
        renderItem={({ item }) => {
          const teacher = teachersData.find((row) => row.id === item.teacherId);
          return (
            <TouchableOpacity style={styles.messageCard} onPress={() => void openMessage(item)} accessibilityRole="button" accessibilityLabel={item.theme}>
              <Text style={styles.messageTitle}>{item.theme}</Text>
              <Text style={styles.meta}>{item.direction} • {teacher?.name || item.parentPhone} • {item.date}</Text>
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
            <Text style={styles.meta}>{selectedMessage?.direction} • {selectedMessage?.date}</Text>
            {selectedMessage?.status ? <Text style={styles.status}>Statut : {selectedMessage.status}</Text> : null}
            <Text style={styles.readerBody}>{selectedMessage?.message}</Text>
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
  if (["super_admin", "school_admin", "country_admin", "principal", "prefet", "secretary"].includes(String(role))) {
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
