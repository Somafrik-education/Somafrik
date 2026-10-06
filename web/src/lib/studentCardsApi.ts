import { api } from "../api/client";

export type StudentCardMedium = "nfc" | "qr" | "nfc_qr";
export type StudentCardStatus = "issued" | "active" | "lost" | "revoked" | "replaced";

export interface StudentAccessCard {
  id: string;
  publicId: string;
  medium: StudentCardMedium;
  status: StudentCardStatus;
  issuedAt?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  replacedByCardId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface IssuedStudentAccessCard extends StudentAccessCard {
  cardToken: string;
}

export interface ReplaceStudentAccessCardResult {
  previous: StudentAccessCard;
  card: IssuedStudentAccessCard;
}

export const studentCardsApi = {
  list(studentId: string) {
    return api.get<{ cards: StudentAccessCard[] }>(
      `/students/${encodeURIComponent(studentId)}/cards`,
    );
  },
  issue(studentId: string, medium: StudentCardMedium) {
    return api.post<IssuedStudentAccessCard>("/student-cards", { studentId, medium });
  },
  markLost(cardId: string, reason?: string) {
    return api.post<StudentAccessCard>(
      `/student-cards/${encodeURIComponent(cardId)}/lost`,
      reason ? { reason } : {},
    );
  },
  revoke(cardId: string, reason?: string) {
    return api.post<StudentAccessCard>(
      `/student-cards/${encodeURIComponent(cardId)}/revoke`,
      reason ? { reason } : {},
    );
  },
  replace(cardId: string) {
    return api.post<ReplaceStudentAccessCardResult>(
      `/student-cards/${encodeURIComponent(cardId)}/replace`,
      {},
    );
  },
};
