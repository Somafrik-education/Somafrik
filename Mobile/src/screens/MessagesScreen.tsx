import { useMemo, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { messageThemes } from "../data/catalog";
import { useAdminData } from "../context/AdminDataContext";
import { useAuth } from "../context/AuthContext";
import StudentSwitcher from "../components/StudentSwitcher";
import { MessagePriority, MessageService } from "../domain/communication/MessageService";
import { canMutateEntity, canReadEntity } from "../domain/security/permissions";
import { classNameMatches, scopedStudentsForSession } from "../lib/establishment";
import { useFloatingTabBarLayout } from "../lib/screenLayout";

const messageService = new MessageService();
const priorities: MessagePriority[] = ["Faible", "Moyenne", "Haute", "Critique"];

export default function MessagesScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const { session, selectedStudentId } = useAuth();
  const { createItem, updateItem, messagesData, studentsData, teachersData, assignmentsData, classesData } =
    useAdminData();
  const [theme, setTheme] = useState(messageThemes[0]);
  const [message, setMessage] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [priority, setPriority] = useState<MessagePriority>("Moyenne");
  const [query, setQuery] = useState("");
  const [recipient, setRecipient] = useState<"school" | "teacher">("school");
  const [selectedTeacherId, setSelectedTeacherId] = useState(session?.user.id ?? "");
  const [teacherStudentId, setTeacherStudentId] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<any | null>(null);

  const role = session?.role;
  const parentPhone =
    session?.user.parentPhone ??
    session?.user.children?.[0]?.parentPhone ??
    "";
  const teacherScopeState = { teachers: teachersData, assignments: assignmentsData, classes: classesData };
  const teacherStudents = scopedStudentsForSession(session, studentsData, teacherScopeState);
  const parentChildren = session?.user.children ?? [];

  const availableTeachers = useMemo(() => {
    if (role !== "parent_student") {
      return teachersData;
    }

    const childrenClasses = parentChildren.map((child) => child.className);
    return teachersData.filter((teacher) =>
      (teacher.assignments ?? []).some((assignment) =>
        childrenClasses.some((className) => classNameMatches(assignment.className, className)),
      ),
    );
  }, [parentChildren, role, teachersData]);

  const roleMessages = useMemo(() => {
    if (role === "teacher") {
      return messagesData.filter(
        (item) =>
          (item.direction === "Parent vers enseignant" || item.direction === "Enseignant vers parent") &&
          (item.teacherId === session?.user.id ||
            teacherStudents.some((student) => student.parentPhone === item.parentPhone))
      );
    }

    if (canReadEntity(session, "messages") && role !== "parent_student") {
      return messagesData;
    }

    return messagesData.filter((item) => item.parentPhone === parentPhone);
  }, [messagesData, parentPhone, role, session, teacherStudents]);

  const visibleMessages = useMemo(() => messageService.search(roleMessages, query), [query, roleMessages]);
  const receivedMessages = useMemo(
    () => visibleMessages.filter((item) => isReceivedMessage(item, role, session)),
    [role, session, visibleMessages]
  );
  const sentMessages = useMemo(
    () => visibleMessages.filter((item) => !isReceivedMessage(item, role, session)),
    [role, session, visibleMessages]
  );
  const unreadCount = getUnreadMessagesCount(role, session, visibleMessages);
  const canManageMessages = canMutateEntity(session, "messages", "UPDATE");

  const sendMessage = () => {
    if (!message.trim()) {
      Alert.alert("Message incomplet", "Veuillez écrire votre message avant l'envoi.");
      return;
    }

    if (role === "parent_student") {
      const teacherId = recipient === "teacher" ? selectedTeacherId || availableTeachers[0]?.id : "";

      if (recipient === "teacher" && !teacherId) {
        Alert.alert("Enseignant requis", "Veuillez choisir un enseignant.");
        return;
      }

      createItem("messages", messageService.create({
        parentPhone,
        studentId: selectedStudentId ?? parentChildren[0]?.id ?? "",
        teacherId,
        theme,
        direction: recipient === "teacher" ? "Parent vers enseignant" : "Parent vers école",
        message: message.trim(),
        attachmentUrl,
        priority,
        actorId: session?.user.id ?? parentPhone,
      }));

      setMessage("");
      setAttachmentUrl("");
      Alert.alert("Message envoyé", recipient === "teacher" ? "L'enseignant recevra votre message." : "L'école recevra votre demande.");
      return;
    }

    if (role === "teacher") {
      const student =
        teacherStudents.find((item) => item.id === teacherStudentId) ?? teacherStudents[0];

      if (!student) {
        Alert.alert("Parent introuvable", "Aucun parent n'est lié à vos classes.");
        return;
      }

      createItem("messages", messageService.create({
        parentPhone: student.parentPhone,
        studentId: student.id,
        teacherId: session?.user.id ?? "",
        theme,
        direction: "Enseignant vers parent",
        message: message.trim(),
        attachmentUrl,
        priority,
        actorId: session?.user.id ?? "",
      }));

      setMessage("");
      setAttachmentUrl("");
      Alert.alert("Message envoyé", "Le parent recevra votre message.");
    }
  };

  const archiveMessage = (item: any) => updateItem("messages", messageService.archive(item, session?.user.id ?? parentPhone));
  const openMessage = (item: any) => {
    const shouldMarkRead = isReceivedMessage(item, role, session) && isUnreadStatus(item.status);
    const nextMessage = shouldMarkRead
      ? messageService.markAsRead(item, session?.user.id ?? parentPhone)
      : item;

    if (shouldMarkRead) {
      updateItem("messages", nextMessage);
    }

    setSelectedMessage(nextMessage);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={contentStyle} showsVerticalScrollIndicator={false}>
        {role === "parent_student" && <StudentSwitcher />}

        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Messages</Text>
            <Text style={styles.subtitle}>
              {unreadCount} non lu(s) • école, parents et enseignants
            </Text>
          </View>
          {canManageMessages && (
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.adminButton}
              onPress={() => navigation.navigate("AdminCrud", { entity: "messages" })}
            >
              <Ionicons name="settings-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>

        {(role === "parent_student" || role === "teacher") && (
          <View style={styles.composeCard}>
            <Text style={styles.cardTitle}>
              {role === "teacher" ? "Écrire à un parent" : "Écrire un message"}
            </Text>

            {role === "teacher" && (
              <>
                <Text style={styles.label}>Parent</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.themeList}
                >
                  {teacherStudents.map((student) => {
                    const selected = (teacherStudentId || teacherStudents[0]?.id) === student.id;

                    return (
                      <TouchableOpacity
                        key={student.id}
                        activeOpacity={0.85}
                        style={[styles.themeChip, selected && styles.themeChipActive]}
                        onPress={() => setTeacherStudentId(student.id)}
                      >
                        <Text style={[styles.themeText, selected && styles.themeTextActive]}>
                          {student.name}
                        </Text>
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
                  <SegmentButton
                    label="École"
                    selected={recipient === "school"}
                    onPress={() => setRecipient("school")}
                  />
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
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.themeList}
                >
                  {availableTeachers.map((teacher) => (
                    <TouchableOpacity
                      key={teacher.id}
                      activeOpacity={0.85}
                      style={[
                        styles.themeChip,
                        selectedTeacherId === teacher.id && styles.themeChipActive,
                      ]}
                      onPress={() => setSelectedTeacherId(teacher.id)}
                    >
                      <Text
                        style={[
                          styles.themeText,
                          selectedTeacherId === teacher.id && styles.themeTextActive,
                        ]}
                      >
                        {teacher.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <Text style={styles.label}>Thème</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.themeList}
            >
              {messageThemes.map((item) => {
                const selected = item === theme;

                return (
                  <TouchableOpacity
                    key={item}
                    activeOpacity={0.85}
                    style={[styles.themeChip, selected && styles.themeChipActive]}
                    onPress={() => setTheme(item)}
                  >
                    <Text style={[styles.themeText, selected && styles.themeTextActive]}>
                      {item}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.label}>Priorité</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.themeList}
            >
              {priorities.map((item) => {
                const selected = item === priority;

                return (
                  <TouchableOpacity
                    key={item}
                    activeOpacity={0.85}
                    style={[styles.themeChip, selected && styles.themeChipActive]}
                    onPress={() => setPriority(item)}
                  >
                    <Text style={[styles.themeText, selected && styles.themeTextActive]}>{item}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.label}>Message</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Expliquez votre message..."
              placeholderTextColor="#94A3B8"
              multiline
              style={styles.messageInput}
            />

            <Text style={styles.label}>Pièce jointe</Text>
            <TextInput
              value={attachmentUrl}
              onChangeText={setAttachmentUrl}
              placeholder="Lien PDF, image, audio ou vidéo"
              placeholderTextColor="#94A3B8"
              style={styles.attachmentInput}
            />

            <TouchableOpacity activeOpacity={0.85} style={styles.sendButton} onPress={sendMessage}>
              <Ionicons name="send-outline" size={20} color="#FFFFFF" />
              <Text style={styles.sendText}>Envoyer</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionTitle}>Messages parents</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher par expéditeur, destinataire, date ou mot-clé"
          placeholderTextColor="#94A3B8"
          style={styles.searchInput}
        />
        <MessageSection
          title="Messages reçus"
          emptyText="Aucun message reçu."
          messages={receivedMessages}
          teachersData={teachersData}
          onOpen={openMessage}
          onArchive={archiveMessage}
          canArchive
        />

        <MessageSection
          title="Messages envoyés"
          emptyText="Aucun message envoyé."
          messages={sentMessages}
          teachersData={teachersData}
          onOpen={openMessage}
          onArchive={archiveMessage}
          canArchive
        />

        {visibleMessages.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={24} color="#94A3B8" />
            <Text style={styles.emptyText}>Aucun message pour ce compte.</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={Boolean(selectedMessage)} transparent animationType="fade" onRequestClose={() => setSelectedMessage(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.readerCard}>
            <View style={styles.readerHeader}>
              <View>
                <Text style={styles.readerTitle}>{selectedMessage?.theme ?? "Message"}</Text>
                <Text style={styles.readerMeta}>
                  {selectedMessage?.direction} • {selectedMessage?.date}
                </Text>
              </View>
              <TouchableOpacity style={styles.readerClose} onPress={() => setSelectedMessage(null)}>
                <Ionicons name="close" size={20} color="#0F172A" />
              </TouchableOpacity>
            </View>
            <View style={styles.badgeRow}>
              <Text style={[styles.status, selectedMessage && isUnreadStatus(selectedMessage.status) && styles.unreadStatus]}>
                {selectedMessage?.status ?? ""}
              </Text>
              <Text style={styles.priorityBadge}>{selectedMessage?.priority ?? "Moyenne"}</Text>
            </View>
            <Text style={styles.readerBody}>{selectedMessage?.message ?? ""}</Text>
            {selectedMessage?.attachmentUrl ? (
              <Text style={styles.readerAttachment}>Pièce jointe : {selectedMessage.attachmentUrl}</Text>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MessageSection({
  title,
  emptyText,
  messages,
  teachersData,
  onOpen,
  onArchive,
  canArchive,
}: {
  title: string;
  emptyText: string;
  messages: any[];
  teachersData: any[];
  onOpen: (message: any) => void;
  onArchive: (message: any) => void;
  canArchive: boolean;
}) {
  return (
    <View style={styles.messageSection}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.messageSectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{messages.length}</Text>
      </View>
      {messages.map((item) => (
        <MessageCard
          key={item.id}
          item={item}
          teacher={teachersData.find((row) => row.id === item.teacherId)}
          onOpen={() => onOpen(item)}
          onArchive={() => onArchive(item)}
          canArchive={canArchive}
        />
      ))}
      {messages.length === 0 && <Text style={styles.sectionEmpty}>{emptyText}</Text>}
    </View>
  );
}

function MessageCard({
  item,
  teacher,
  onOpen,
  onArchive,
  canArchive,
}: {
  item: any;
  teacher?: any;
  onOpen: () => void;
  onArchive: () => void;
  canArchive: boolean;
}) {
  const fromSchool = item.direction === "École vers parent";
  const fromTeacher = item.direction === "Enseignant vers parent";

  return (
    <TouchableOpacity key={item.id} activeOpacity={0.86} style={styles.messageCard} onPress={onOpen}>
      <View style={styles.messageTop}>
        <View
          style={[
            styles.directionIcon,
            fromSchool ? styles.schoolIcon : fromTeacher ? styles.teacherIcon : styles.parentIcon,
          ]}
        >
          <Ionicons
            name={fromSchool ? "school-outline" : fromTeacher ? "school-outline" : "person-outline"}
            size={18}
            color={fromSchool ? "#2563EB" : fromTeacher ? "#7C3AED" : "#0F766E"}
          />
        </View>
        <View style={styles.messageHeaderText}>
          <Text style={styles.messageTheme}>{item.theme}</Text>
          <Text style={styles.messageMeta}>
            {item.direction} • {teacher?.name ?? item.parentPhone} • {item.date}
          </Text>
        </View>
        <Text style={[styles.status, isUnreadStatus(item.status) && styles.unreadStatus]}>
          {item.status}
        </Text>
      </View>
      <View style={styles.badgeRow}>
        <Text style={styles.priorityBadge}>{item.priority ?? "Moyenne"}</Text>
        {item.attachmentUrl ? <Text style={styles.attachmentBadge}>Pièce jointe</Text> : null}
        {(item.systemBroadcast === true || String(item.scope ?? "").toLowerCase() === "system") ? (
          <Text style={styles.systemBadge}>Diffusion système</Text>
        ) : null}
      </View>
      <Text style={styles.messageBody} numberOfLines={2}>{item.message}</Text>
      {canArchive && item.status !== "Archivé" && (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.smallAction}
            onPress={(event) => {
              event.stopPropagation();
              onArchive();
            }}
          >
            <Text style={styles.smallActionText}>Archiver</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

function SegmentButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={[styles.segmentButton, selected && styles.segmentButtonActive]}
      onPress={onPress}
    >
      <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function getUnreadMessagesCount(role: string | undefined, session: any, messages: any[]) {
  return messageService.countUnreadForRole(role, session, messages);
}

function isUnreadStatus(status?: string) {
  return ["Nouveau", "Distribué", "Envoyé"].includes(String(status));
}

function isReceivedMessage(message: any, role: string | undefined, session: any) {
  if (
    role === "super_admin" ||
    role === "school_admin" ||
    role === "country_admin" ||
    role === "principal" ||
    role === "prefet" ||
    role === "secretary"
  ) {
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  title: { color: "#0F172A", fontSize: 30, fontWeight: "900" },
  subtitle: { color: "#64748B", fontWeight: "700", marginTop: 4 },
  adminButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },
  composeCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    marginBottom: 20,
  },
  cardTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginBottom: 12 },
  label: { color: "#334155", fontSize: 12, fontWeight: "900", marginBottom: 8 },
  segmentRow: {
    backgroundColor: "#F1F5F9",
    borderRadius: 16,
    padding: 4,
    flexDirection: "row",
    marginBottom: 14,
  },
  segmentButton: {
    flex: 1,
    borderRadius: 13,
    paddingVertical: 10,
    alignItems: "center",
  },
  segmentButtonActive: { backgroundColor: "#0F172A" },
  segmentText: { color: "#64748B", fontWeight: "900" },
  segmentTextActive: { color: "#FFFFFF" },
  themeList: { gap: 8, paddingRight: 4, marginBottom: 14 },
  themeChip: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#FFFFFF",
  },
  themeChipActive: {
    backgroundColor: "#0F172A",
    borderColor: "#0F172A",
  },
  themeText: { color: "#475569", fontWeight: "800", fontSize: 12 },
  themeTextActive: { color: "#FFFFFF" },
  messageInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    padding: 12,
    textAlignVertical: "top",
    color: "#0F172A",
    fontWeight: "700",
    marginBottom: 14,
  },
  attachmentInput: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    padding: 12,
    color: "#0F172A",
    fontWeight: "700",
    marginBottom: 14,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    color: "#0F172A",
    fontWeight: "700",
    marginBottom: 14,
  },
  sendButton: {
    backgroundColor: "#2563EB",
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  sendText: { color: "#FFFFFF", fontWeight: "900", marginLeft: 8 },
  sectionTitle: { color: "#0F172A", fontSize: 20, fontWeight: "900", marginBottom: 12 },
  messageSection: {
    marginBottom: 18,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  messageSectionTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  sectionCount: {
    minWidth: 28,
    textAlign: "center",
    color: "#2563EB",
    backgroundColor: "#EFF6FF",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontWeight: "900",
  },
  sectionEmpty: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    color: "#64748B",
    fontWeight: "800",
    marginBottom: 12,
  },
  messageCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
  },
  messageTop: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  directionIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  schoolIcon: { backgroundColor: "#EFF6FF" },
  teacherIcon: { backgroundColor: "#F5F3FF" },
  parentIcon: { backgroundColor: "#ECFDF5" },
  messageHeaderText: { flex: 1 },
  messageTheme: { color: "#0F172A", fontSize: 15, fontWeight: "900" },
  messageMeta: { color: "#64748B", fontSize: 11, fontWeight: "700", marginTop: 3 },
  status: {
    color: "#2563EB",
    backgroundColor: "#EFF6FF",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "900",
  },
  unreadStatus: {
    color: "#B45309",
    backgroundColor: "#FEF3C7",
  },
  badgeRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  priorityBadge: {
    color: "#7C3AED",
    backgroundColor: "#F5F3FF",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "900",
  },
  attachmentBadge: {
    color: "#0F766E",
    backgroundColor: "#ECFDF5",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "900",
  },
  systemBadge: {
    color: "#1D4ED8",
    backgroundColor: "#DBEAFE",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "900",
  },
  messageBody: { color: "#334155", fontWeight: "700", lineHeight: 20 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  smallAction: {
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallActionText: { color: "#334155", fontSize: 12, fontWeight: "900" },
  emptyState: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    alignItems: "center",
  },
  emptyText: { color: "#64748B", fontWeight: "800", marginTop: 8 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    padding: 20,
  },
  readerCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 18,
  },
  readerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  readerTitle: { color: "#0F172A", fontSize: 20, fontWeight: "900" },
  readerMeta: { color: "#64748B", fontSize: 12, fontWeight: "800", marginTop: 4 },
  readerClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  readerBody: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 24,
    marginTop: 6,
  },
  readerAttachment: {
    marginTop: 16,
    color: "#0F766E",
    backgroundColor: "#ECFDF5",
    borderRadius: 14,
    padding: 12,
    fontWeight: "800",
  },
});
