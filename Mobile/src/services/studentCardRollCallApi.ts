/**
 * CARTE-PR1 — appel collectif. Le cardToken ne quitte l'appareil que vers le scan
 * brouillon ; il n'est jamais persisté ni journalisé. Les réponses ne portent aucune identité.
 */
import { httpRequest } from "./httpClient";

export type RollCallScanResponse = {
  status: "accepted";
  receipt: string;
  dedupKey: string;
  expiresAt: string;
};

export type RollCallValidateResponse = {
  recorded: number;
  alreadyRecorded?: number;
  mode?: "direction";
  duplicatesIgnored: number;
  classId: string;
  date: string;
};

export function scanRollCallCard(input: {
  sessionId: string;
  classId: string;
  date: string;
  mode: "teacher" | "direction";
  cardToken: string;
}) {
  return httpRequest<RollCallScanResponse>("/student-cards/roll-call/scan", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function validateRollCall(
  body: {
    sessionId: string;
    classId: string;
    date: string;
    mode: "teacher" | "direction";
    receipts: string[];
    justification?: string;
  },
  options: { idempotencyKey: string },
) {
  return httpRequest<RollCallValidateResponse>("/student-cards/roll-call/validate", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: options.idempotencyKey,
  });
}

/**
 * CARTE-PR3-M2 — liste d'appel de l'enseignant affecté (lecture seule côté serveur) :
 * élèves inscrits, statut existant et clé de rapprochement propre à la session.
 */
export function getClassRollCallRoster(input: { sessionId: string; classId: string; date: string }) {
  const query = new URLSearchParams({ sessionId: input.sessionId, classId: input.classId, date: input.date });
  return httpRequest<unknown>(`/student-cards/roll-call/roster?${query.toString()}`, { method: "GET" });
}

export type ClassRollCallValidateResponse = {
  counts?: unknown;
  protected?: unknown;
  idempotentReplay?: unknown;
};

/** CARTE-PR3-M2 — validation de l'appel complet confirmé (`complete: true`), idempotente par session. */
export function validateCompleteClassRollCall(
  body: {
    sessionId: string;
    classId: string;
    date: string;
    mode: "teacher";
    receipts: string[];
    manual: { studentId: string; status: "present" | "late" | "absent" }[];
    complete: true;
  },
  options: { idempotencyKey: string },
) {
  return httpRequest<ClassRollCallValidateResponse>("/student-cards/roll-call/validate", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: options.idempotencyKey,
  });
}

/** CARTE-UX-ROLE-01 — supervision de direction : compteurs par classe, aucune donnée d'élève. */
export function getRollCallOverview(date: string) {
  return httpRequest<unknown>(`/student-cards/roll-call/overview?date=${encodeURIComponent(date)}`, { method: "GET" });
}
