import type { SchoolMessage } from "../../data/catalog";

export type MessageStatus = "Envoyé" | "Distribué" | "Lu" | "Archivé" | "Nouveau" | "En cours" | "Traité";
export type MessagePriority = "Faible" | "Moyenne" | "Haute" | "Critique";

type CreateMessageInput = {
  parentPhone: string;
  message: string;
  theme: string;
  direction: string;
  actorId: string;
  studentId?: string;
  teacherId?: string;
  attachmentUrl?: string;
  priority?: MessagePriority;
};

export class MessageService {
  create(input: CreateMessageInput): SchoolMessage {
    const now = new Date();

    return {
      id: `MSG-${now.getTime()}`,
      parentPhone: input.parentPhone,
      studentId: input.studentId ?? "",
      teacherId: input.teacherId ?? "",
      theme: input.theme,
      direction: input.direction,
      message: input.message.trim(),
      attachmentUrl: input.attachmentUrl?.trim() ?? "",
      priority: input.priority ?? "Moyenne",
      status: "Envoyé",
      date: MessageService.formatDate(now),
      sentAt: MessageService.formatDateTime(now),
      audit: [
        {
          action: "Création",
          actorId: input.actorId,
          date: MessageService.formatDateTime(now),
        },
      ],
    };
  }

  markAsRead(message: SchoolMessage, actorId: string): SchoolMessage {
    const now = new Date();

    return {
      ...message,
      status: "Lu",
      readAt: MessageService.formatDateTime(now),
      audit: [
        ...(message.audit ?? []),
        {
          action: "Lecture",
          actorId,
          date: MessageService.formatDateTime(now),
        },
      ],
    };
  }

  archive(message: SchoolMessage, actorId: string): SchoolMessage {
    const now = new Date();

    return {
      ...message,
      status: "Archivé",
      archivedAt: MessageService.formatDateTime(now),
      audit: [
        ...(message.audit ?? []),
        {
          action: "Archivage",
          actorId,
          date: MessageService.formatDateTime(now),
        },
      ],
    };
  }

  countUnreadForRole(role: string | undefined, session: any, messages: SchoolMessage[]) {
    return messages.filter((message) => this.isUnreadForRole(role, session, message)).length;
  }

  search(messages: SchoolMessage[], query: string) {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return messages;
    }

    return messages.filter((message) =>
      [message.theme, message.direction, message.message, message.parentPhone, message.teacherId, message.date]
        .some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery))
    );
  }

  private isUnreadForRole(role: string | undefined, session: any, message: SchoolMessage) {
    const unreadStatuses = ["Nouveau", "Distribué", "Envoyé"];

    if (!unreadStatuses.includes(String(message.status))) {
      return false;
    }

    if (
      role === "super_admin" ||
      role === "school_admin" ||
      role === "country_admin" ||
      role === "principal" ||
      role === "proviseur" ||
      role === "prefet" ||
      role === "secretary" ||
      role === "accountant" ||
      role === "adjoint"
    ) {
      return message.direction === "Parent vers école";
    }

    if (role === "teacher") {
      return message.direction === "Parent vers enseignant" && message.teacherId === session?.user.id;
    }

    return message.direction === "École vers parent" || message.direction === "Enseignant vers parent";
  }

  private static formatDate(date: Date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}-${month}-${date.getFullYear()}`;
  }

  private static formatDateTime(date: Date) {
    const hour = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${MessageService.formatDate(date)} ${hour}:${minutes}`;
  }
}
