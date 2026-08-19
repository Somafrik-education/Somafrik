import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import StudentSwitcher from "../components/StudentSwitcher";
import { messageThemes } from "../data/catalog";
import { useAdminData } from "../context/AdminDataContext";
import { useAuth } from "../context/AuthContext";
import { MessagePriority, MessageService } from "../domain/communication/MessageService";
import { canMutateEntity, canReadEntity } from "../domain/security/permissions";
import { useCanonicalResource } from "../hooks/useCanonicalResource";
import { classNameMatches, scopedStudentsForSession } from "../lib/establishment";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { sendClientsMessage } from "../services/api";
import {
  getCanonicalMessages,
  getCanonicalTeachers,
  markCanonicalMessageRead,
  type CanonicalSchoolMessage,
  type CanonicalTeacher,
} from "../services/domainHydrationApi";

const messageService = new MessageService();
const priorities: MessagePriority[] = ["Faible", "Moyenne", "Haute", "Critique"];

export default function MessagesScreen() {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const { session, selectedStudentId } = useAuth();
  const { studentsData, assignmentsData, classesData } = useAdminData();
  const { snapshot: messagesSnapshot, load: loadMessages } = useCanonicalResource<CanonicalSchoolMessage>(getCanonicalMessages);
  const { snapshot: teachersSnapshot, load: loadTeachers } = useCanonicalResource<CanonicalTeacher>(getCanonicalTeachers);

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

  const role = session?.role;
  const canRead = canReadEntity(session, "messages");
  const canSend = canMutateEntity(session, "messages", "CREATE");
  const parentPhone = session?.user.parentPhone ?? session?.user.children?.[0]?.parentPhone ?? "";
  const parentChildren = session?.user.children ?? [];
  const teachersData = teachersSnapshot.data;
  const teacherScopeState = { teachers: teachersData, assignments: assignmentsData, classes: classesData };
  const teacherStudents = scopedStudentsForSession(session, studentsData, teacherScopeState);

  useFocusEffect(
    useCallback(() => {
      if (canRead) void loadMessages();
      if (role === "parent_student" || role === "teacher") void loadTeachers();
    }, [canRead, loadMessages, loadTeachers, role]),
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
    const messagesData = messagesSnapshot.data;
    if (role === "teacher") {
      return messagesData.filter(
        (item) =>
          (item.direction === "Parent vers enseignant" || item.direction === "Enseignant vers parent") &&
          (item.teacherId === session?.user.id || teacherStudents.some((student) => student.parentPhone === item.parentPhone)),
      );
    }
    if (role === "parent_student" || role === "student") {
      return messagesData.filter((item) => item.parentPhone === parentPhone);
    }
    return messagesData;
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
    if (sending || !canSend) return;
    if (!message.trim()) {
      Alert.alert("Message incomplet", "Veuillez écrire votre message avant l'envoi.");
      return;
    }

    let payload: Record<string, unknown> | null = null;
    if (role === "parent_student") {
      const teacherId = recipient === "teacher" ? selectedTeacherId || availableTeachers[0]?.id : "";
      if (recipient === "teacher" && !teacherId) {
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

    if (!payload) return;
    setSending(true);
    try {
      await sendClientsMessage(payload);
      await loadMessages();
      setMessage("");
      setAttachmentUrl("");
      Alert.alert("Message envoyé", "Le serveur a confirmé l'envoi du message.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Impossible d'envoyer le message.";
      Alert.alert("Envoi impossible", text);
    } finally {
      setSending(false);
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
      // La lecture reste affichée, mais aucun statut local n'est inventé.
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={contentStyle} showsVerticalScrollIndicator={false}>
        {role === "parent_student" && <StudentSwitcher />}

        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Messages</Text>
            <Text style={styles.subtitle}>{unreadCount} non lu(s) • données serveur</Text>
          </View>
        </View>

        {(role === "parent_student" || role === "teacher") && canSend && (
          <View style={styles.composeCard}>
            <Text style={styles.cardTitle}>{role === "teacher" ? "Écrire à un parent" : "Écrire un message"}</Text>

            {role === "teacher" && (
              <>
                <Text style={styles.label}>Parent</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.themeList}>
                  {teacherStudents.map((student) => {
                    const selected = (teacherStudentId || teacherStudents[0]?.id) === student.id;
                    return (
                      <TouchableOpacity
                        key={student.id}
                        style={[styles.themeChip, selected && styles.themeChipActive]}
                        onPress={() => setTeacherStudentId(student.id)}
                        disabled={sending}
                      >
                        <Text style={[styles.themeText, selected && styles.themeTextActive]}>{student.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            )}

            {role === "parent_student" && (
              <>
                <Text style={styles.label}>Destinataire</Text>
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
              </>
            )}

            {role === "parent_student" && recipient === "teacher" && (
              <>
                <Text style={styles.label}>Enseignant</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.themeList}>
                  {availableTeachers.map((teacher) => (
                    <TouchableOpacity
                      key={teacher.id}
                      style={[styles.themeChip, selectedTeacherId === teacher.id && styles.themeChipActive]}
                      onPress={() => setSelectedTeacherId(teacher.id)}
                      disabled={sending}
                    >
                      <Text style={[styles.themeText, selectedTeacherId === teacher.id && styles.themeTextActive]}>
                        {teacher.name || teacher.teacherCode}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <Text style={styles.label}>Thème</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.themeList}>
              {messageThemes.map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[styles.themeChip, item === theme && styles.themeChipActive]}
                  onPress={() => setTheme(item)}
                  disabled={sending}
                >
                  <Text style={[styles.themeText, item === theme && styles.themeTextActive]}>{item}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Priorité</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.themeList}>
              {priorities.map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[styles.themeChip, item === priority && styles.themeChipActive]}
                  onPress={() => setPriority(item)}
                  disabled={sending}
                >
                  <Text style={[styles.themeText, item === priority && styles.themeTextActive]}>{item}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Message</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Expliquez votre message..."
              placeholderTextColor="#94A3B8"
              multiline
              editable={!sending}
              style={styles.messageInput}
            />
            <Text style={styles.label}>Pièce jointe</Text>
            <TextInput
              value={attachmentUrl}
              onChangeText={setAttachmentUrl}
              placeholder="Lien PDF, image, audio ou vidéo"
              placeholderTextColor="#94A3B8"
              editable={!sending}
              style={styles.attachmentInput}
            />
            <TouchableOpacity style={[styles.sendButton, sending && styles.disabled]} onPress={() => void sendMessage()} disabled={sending}>
              {sending ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="send-outline" size={20} color="#FFFFFF" />}
              <Text style={styles.sendText}>{sending ? "Envoi…" : "Envoyer"}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!canRead ? (
          <View style={styles.emptyState}>
            <Ionicons name="lock-closed-outline" size={24} color="#DC2626" />
            <Text style={styles.emptyText}>Accès refusé aux messages.</Text>
          </View>
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
          <>
            <Text style={styles.sectionTitle}>Messages</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Rechercher par thème, direction ou mot-clé"
              placeholderTextColor="#94A3B8"
              style={styles.searchInput}
            />
            <MessageSection title="Messages reçus" emptyText="Aucun message reçu." messages={receivedMessages} teachersData={teachersData} onOpen={openMessage} />
            <MessageSection title="Messages envoyés" emptyText="Aucun message envoyé." messages={sentMessages} teachersData={teachersData} onOpen={openMessage} />
          </>
        )}
      </ScrollView>

      <Modal visible={Boolean(selectedMessage)} transparent animationType="fade" onRequestClose={() => setSelectedMessage(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.readerCard}>
            <View style={styles.readerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.readerTitle}>{selectedMessage?.theme ?? "Message"}</Text>
                <Text style={styles.readerMeta}>{selectedMessage?.direction} • {selectedMessage?.date}</Text>
              </View>
              <TouchableOpacity style={styles.readerClose} onPress={() => setSelectedMessage(null)}>
                <Ionicons name="close" size={20} color="#0F172A" />
              </TouchableOpacity>
            </View>
            <View style={styles.badgeRow}>
              <Text style={[styles.status, selectedMessage && isUnreadStatus(selectedMessage.status) && styles.unreadStatus]}>{selectedMessage?.status ?? ""}</Text>
              <Text style={styles.priorityBadge}>{selectedMessage?.priority ?? "Moyenne"}</Text>
            </View>
            <Text style={styles.readerBody}>{selectedMessage?.message ?? ""}</Text>
            {selectedMessage?.attachmentUrl ? <Text style={styles.readerAttachment}>Pièce jointe : {selectedMessage.attachmentUrl}</Text> : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MessageSection({ title, emptyText, messages, teachersData, onOpen }: {
  title: string;
  emptyText: string;
  messages: CanonicalSchoolMessage[];
  teachersData: CanonicalTeacher[];
  onOpen: (message: CanonicalSchoolMessage) => void;
}) {
  return (
    <View style={styles.messageSection}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.messageSectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{messages.length}</Text>
      </View>
      {messages.map((item) => {
        const teacher = teachersData.find((row) => row.id === item.teacherId);
        return (
          <TouchableOpacity key={item.id} activeOpacity={0.86} style={styles.messageCard} onPress={() => void onOpen(item)}>
            <View style={styles.messageTop}>
              <View style={styles.directionIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color="#2563EB" />
              </View>
              <View style={styles.messageHeaderText}>
                <Text style={styles.messageTheme}>{item.theme}</Text>
                <Text style={styles.messageMeta}>{item.direction} • {teacher?.name ?? item.parentPhone} • {item.date}</Text>
              </View>
              <Text style={[styles.status, isUnreadStatus(item.status) && styles.unreadStatus]}>{item.status}</Text>
            </View>
            <View style={styles.badgeRow}><Text style={styles.priorityBadge}>{item.priority ?? "Moyenne"}</Text></View>
            <Text style={styles.messageBody} numberOfLines={2}>{item.message}</Text>
          </TouchableOpacity>
        );
      })}
      {messages.length === 0 && <Text style={styles.sectionEmpty}>{emptyText}</Text>}
    </View>
  );
}

function SegmentButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.segmentButton, selected && styles.segmentButtonActive]} onPress={onPress}>
      <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{label}</Text>
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
  if (role === "teacher") {
    return message.direction === "Parent vers enseignant" && message.teacherId === session?.user.id;
  }
  return message.direction === "École vers parent" || message.direction === "Enseignant vers parent";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  title: { color: "#0F172A", fontSize: 30, fontWeight: "900" },
  subtitle: { color: "#64748B", fontWeight: "700", marginTop: 4 },
  composeCard: { backgroundColor: "#FFFFFF", borderRadius: 22, padding: 16, marginBottom: 20 },
  cardTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginBottom: 12 },
  label: { color: "#334155", fontSize: 12, fontWeight: "900", marginBottom: 8 },
  segmentRow: { backgroundColor: "#F1F5F9", borderRadius: 16, padding: 4, flexDirection: "row", marginBottom: 14 },
  segmentButton: { flex: 1, borderRadius: 13, paddingVertical: 10, alignItems: "center" },
  segmentButtonActive: { backgroundColor: "#0F172A" },
  segmentText: { color: "#64748B", fontWeight: "900" },
  segmentTextActive: { color: "#FFFFFF" },
  themeList: { gap: 8, paddingRight: 4, marginBottom: 14 },
  themeChip: { borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#FFFFFF" },
  themeChipActive: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  themeText: { color: "#475569", fontWeight: "800", fontSize: 12 },
  themeTextActive: { color: "#FFFFFF" },
  messageInput: { minHeight: 110, borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 16, padding: 12, textAlignVertical: "top", color: "#0F172A", fontWeight: "700", marginBottom: 14 },
  attachmentInput: { borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 16, padding: 12, color: "#0F172A", fontWeight: "700", marginBottom: 14 },
  searchInput: { borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#FFFFFF", borderRadius: 16, padding: 12, color: "#0F172A", fontWeight: "700", marginBottom: 14 },
  sendButton: { backgroundColor: "#2563EB", borderRadius: 16, padding: 14, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  sendText: { color: "#FFFFFF", fontWeight: "900", marginLeft: 8 },
  disabled: { opacity: 0.5 },
  sectionTitle: { color: "#0F172A", fontSize: 20, fontWeight: "900", marginBottom: 12 },
  messageSection: { marginBottom: 18 },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  messageSectionTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  sectionCount: { minWidth: 28, textAlign: "center", color: "#2563EB", backgroundColor: "#EFF6FF", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontWeight: "900" },
  sectionEmpty: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 14, color: "#64748B", fontWeight: "800", marginBottom: 12 },
  messageCard: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 14, marginBottom: 12 },
  messageTop: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  directionIcon: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center", marginRight: 10, backgroundColor: "#EFF6FF" },
  messageHeaderText: { flex: 1 },
  messageTheme: { color: "#0F172A", fontSize: 15, fontWeight: "900" },
  messageMeta: { color: "#64748B", fontSize: 11, fontWeight: "700", marginTop: 3 },
  status: { color: "#2563EB", backgroundColor: "#EFF6FF", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: "900" },
  unreadStatus: { color: "#B45309", backgroundColor: "#FEF3C7" },
  badgeRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  priorityBadge: { color: "#7C3AED", backgroundColor: "#F5F3FF", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: "900" },
  messageBody: { color: "#334155", fontWeight: "700", lineHeight: 20 },
  emptyState: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 18, alignItems: "center" },
  emptyText: { color: "#64748B", fontWeight: "800", marginTop: 8 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.55)", justifyContent: "center", padding: 20 },
  readerCard: { backgroundColor: "#FFFFFF", borderRadius: 24, padding: 18 },
  readerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  readerTitle: { color: "#0F172A", fontSize: 20, fontWeight: "900" },
  readerMeta: { color: "#64748B", fontSize: 12, fontWeight: "800", marginTop: 4 },
  readerClose: { width: 34, height: 34, borderRadius: 12, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  readerBody: { color: "#0F172A", fontSize: 16, fontWeight: "700", lineHeight: 24, marginTop: 6 },
  readerAttachment: { marginTop: 16, color: "#0F766E", backgroundColor: "#ECFDF5", borderRadius: 14, padding: 12, fontWeight: "800" },
});
