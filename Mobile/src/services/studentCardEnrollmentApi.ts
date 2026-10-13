import { httpRequest } from "./httpClient";
import type { EnrollmentCard, IssuedNfcCard, NfcEnrollmentApi, NtagIdentity } from "../lib/studentCardNfcEncoding";

export const studentCardEnrollmentApi: NfcEnrollmentApi & {
  list(studentId: string): Promise<{ cards: EnrollmentCard[]; nfcEnabled: boolean }>;
  retry(card: EnrollmentCard, identity: NtagIdentity): Promise<IssuedNfcCard>;
  revoke(cardId: string): Promise<EnrollmentCard>;
} = {
  list(studentId) { return httpRequest(`/students/${encodeURIComponent(studentId)}/cards`); },
  issue(studentId: string, identity: NtagIdentity) {
    return httpRequest<IssuedNfcCard>("/student-cards", { method: "POST", body: JSON.stringify({ studentId, medium: "nfc", nfc: identity }) });
  },
  confirm(card, cardToken, locked) {
    if (!card.nfc) throw new Error("Affectation NFC absente.");
    return httpRequest<EnrollmentCard>(`/student-cards/${encodeURIComponent(card.id)}/nfc-confirm`, {
      method: "POST", body: JSON.stringify({ uid: card.nfc.uid, tagType: card.nfc.tagType, cardToken, locked }),
    });
  },
  retry(card, identity) { return httpRequest<IssuedNfcCard>(`/student-cards/${encodeURIComponent(card.id)}/nfc-retry`, { method: "POST", body: JSON.stringify(identity) }); },
  revoke(cardId) { return httpRequest(`/student-cards/${encodeURIComponent(cardId)}/revoke`, { method: "POST", body: JSON.stringify({ reason: "Encodage annulé" }) }); },
};
