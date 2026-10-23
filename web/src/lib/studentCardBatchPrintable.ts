import { classStudentsApi } from "./classStudentsApi";
import { studentCardHolderTitle } from "./studentCardPolicy";
import { renderStudentCardQrDataUrl } from "./studentCardQr";
import { studentCardsApi } from "./studentCardsApi";
import type { PreparedCardSecret } from "./studentCardBatchSession";

/**
 * CARTE-BATCH-WEB-01 — document CR80 produit localement avant toute activation.
 *
 * Le serveur ne conserve pas les secrets. Après activation, aucun PDF ne peut
 * être reconstruit depuis PostgreSQL. Le fichier enregistré par l'opérateur
 * contient la source versionnée : un lot PDF ultérieur la relit, sans nouvelle
 * émission. Un simple fichier de jetons ne passe pas cette conversion.
 */
export const CARD_BATCH_PRINT_FORMAT = "somafrik-card-batch-print-v1";
const SOURCE_ELEMENT_ID = "somafrik-card-batch-source";

export interface BatchPrintIdentity {
  studentId: string;
  holderKind: "eleve" | "etudiant" | null;
  displayName: string | null;
  studentCode: string | null;
  classLabel: string | null;
  schoolName: string | null;
}

export interface BatchPrintCard {
  studentId: string;
  publicId: string;
  cardToken: string;
  holderKind: "eleve" | "etudiant";
  holderTitle: string;
  displayName: string;
  studentCode: string | null;
  classLabel: string | null;
  schoolName: string | null;
}

export interface BatchPrintDocument {
  format: typeof CARD_BATCH_PRINT_FORMAT;
  batchId: string;
  classCode: string;
  className: string | null;
  expiresAt: string | null;
  cards: BatchPrintCard[];
}

export interface BatchPrintMeta {
  batchId: string;
  classCode: string;
  className: string | null;
  expiresAt: string | null;
}

type PrintResult<T> = { ok: true; value: T } | { ok: false; message: string };

const PRINT_UNAVAILABLE =
  "Le document CR80 ne peut pas être produit. Les cartes ne seront pas activées, et aucune nouvelle émission n'est lancée.";

export function assembleBatchPrintDocument(
  meta: BatchPrintMeta,
  secrets: readonly PreparedCardSecret[],
  identities: readonly BatchPrintIdentity[],
): PrintResult<BatchPrintDocument> {
  if (!meta.batchId || secrets.length === 0) return { ok: false, message: PRINT_UNAVAILABLE };
  const byStudent = new Map(identities.map((identity) => [identity.studentId, identity]));
  const cards: BatchPrintCard[] = [];
  for (const secret of secrets) {
    const identity = byStudent.get(secret.studentId);
    const holderTitle = studentCardHolderTitle(
      identity?.holderKind ? { kind: identity.holderKind, source: "school_setting" } : null,
    );
    const displayName = identity?.displayName?.trim() ?? "";
    if (!identity || !holderTitle || !displayName || identity.holderKind == null) {
      return { ok: false, message: PRINT_UNAVAILABLE };
    }
    cards.push({
      studentId: secret.studentId,
      publicId: secret.publicId,
      cardToken: secret.cardToken,
      holderKind: identity.holderKind,
      holderTitle,
      displayName,
      studentCode: identity.studentCode,
      classLabel: identity.classLabel,
      schoolName: identity.schoolName,
    });
  }
  return {
    ok: true,
    value: {
      format: CARD_BATCH_PRINT_FORMAT,
      batchId: meta.batchId,
      classCode: meta.classCode,
      className: meta.className,
      expiresAt: meta.expiresAt,
      cards,
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sourceJson(document: BatchPrintDocument): string {
  return JSON.stringify(document).replace(/</g, "\\u003c");
}

export function convertBatchPrintDocument(
  document: BatchPrintDocument,
  qrByPublicId: ReadonlyMap<string, string>,
): PrintResult<string> {
  if (document.format !== CARD_BATCH_PRINT_FORMAT || document.cards.length === 0) {
    return { ok: false, message: PRINT_UNAVAILABLE };
  }
  const cards: string[] = [];
  for (const card of document.cards) {
    const qr = qrByPublicId.get(card.publicId) ?? "";
    if (!qr.startsWith("data:image/png") || !card.holderTitle || !card.displayName || !card.cardToken) {
      return { ok: false, message: PRINT_UNAVAILABLE };
    }
    const code = card.studentCode ? `<p class="code">Matricule ${escapeHtml(card.studentCode)}</p>` : "";
    const school = card.schoolName ? `<p class="school">${escapeHtml(card.schoolName)}</p>` : "";
    const classLabel = card.classLabel ? `<p class="class">${escapeHtml(card.classLabel)}</p>` : "";
    cards.push(
      `<article class="card"><h1>${escapeHtml(card.holderTitle)}</h1><p class="name">${escapeHtml(card.displayName)}</p>${school}${classLabel}${code}<img alt="QR de la carte" src="${escapeHtml(qr)}"></article>`,
    );
  }
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Cartes élèves CR80</title><style>@page{size:A4 portrait;margin:8mm}body{margin:0;font-family:sans-serif}.grid{display:grid;grid-template-columns:85.60mm 85.60mm;gap:3mm}.card{width:85.60mm;height:53.98mm;box-sizing:border-box;border:0.2mm solid #111;padding:2mm;break-inside:avoid;page-break-inside:avoid;overflow:hidden}.card:nth-child(8n){break-after:page}.card h1{margin:0;font-size:8pt}.name{margin:1mm 0;font-size:11pt;font-weight:700}.card img{width:22mm;height:22mm}</style></head><body><p>Document CR80 local. Il sert à imprimer les cartes et à produire plus tard le PDF, sans nouvelle émission.</p><section class="grid">${cards.join("")}</section><script type="application/json" id="${SOURCE_ELEMENT_ID}">${sourceJson(document)}</script></body></html>`;
  const readBack = readBatchPrintDocument(html);
  if (!readBack.ok || readBack.value.cards.length !== document.cards.length) {
    return { ok: false, message: PRINT_UNAVAILABLE };
  }
  for (let index = 0; index < document.cards.length; index += 1) {
    const original = document.cards[index];
    const restored = readBack.value.cards[index];
    if (restored.publicId !== original.publicId || restored.cardToken !== original.cardToken) {
      return { ok: false, message: PRINT_UNAVAILABLE };
    }
  }
  return { ok: true, value: html };
}

export function readBatchPrintDocument(source: string): PrintResult<BatchPrintDocument> {
  const match = source.match(
    new RegExp(`<script type="application/json" id="${SOURCE_ELEMENT_ID}">([\\s\\S]*?)</script>`),
  );
  if (!match) return { ok: false, message: PRINT_UNAVAILABLE };
  try {
    const parsed = JSON.parse(match[1]) as Partial<BatchPrintDocument>;
    if (parsed.format !== CARD_BATCH_PRINT_FORMAT || !Array.isArray(parsed.cards) || parsed.cards.length === 0) {
      return { ok: false, message: PRINT_UNAVAILABLE };
    }
    const cards = parsed.cards.map((card) => ({
      studentId: String(card.studentId ?? ""),
      publicId: String(card.publicId ?? ""),
      cardToken: String(card.cardToken ?? ""),
      holderKind: card.holderKind === "etudiant" ? "etudiant" as const : "eleve" as const,
      holderTitle: String(card.holderTitle ?? ""),
      displayName: String(card.displayName ?? ""),
      studentCode: card.studentCode ?? null,
      classLabel: card.classLabel ?? null,
      schoolName: card.schoolName ?? null,
    }));
    if (cards.some((card) => !card.publicId || !card.cardToken || !card.displayName || !card.holderTitle)) {
      return { ok: false, message: PRINT_UNAVAILABLE };
    }
    return {
      ok: true,
      value: {
        format: CARD_BATCH_PRINT_FORMAT,
        batchId: String(parsed.batchId ?? ""),
        classCode: String(parsed.classCode ?? ""),
        className: parsed.className ?? null,
        expiresAt: parsed.expiresAt ?? null,
        cards,
      },
    };
  } catch {
    return { ok: false, message: PRINT_UNAVAILABLE };
  }
}

export async function renderBatchPrintDocument(document: BatchPrintDocument): Promise<PrintResult<string>> {
  const qrByPublicId = new Map<string, string>();
  for (const card of document.cards) {
    const qr = await renderStudentCardQrDataUrl(card.cardToken);
    qrByPublicId.set(card.publicId, qr);
  }
  return convertBatchPrintDocument(document, qrByPublicId);
}

type RosterStudent = {
  id?: string;
  studentUuid?: string;
  studentCode?: string;
  publicId?: string;
  matricule?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
};

/**
 * Le lot identifie l'élève par son UUID. La liste de classe expose cet UUID
 * dans studentUuid et réserve id au matricule public.
 */
function findRosterStudent(roster: readonly RosterStudent[], studentId: string): RosterStudent | undefined {
  const wanted = studentId.trim();
  if (!wanted) return undefined;
  return roster.find((student) =>
    [student.id, student.studentUuid, student.studentCode, student.publicId, student.matricule]
      .some((value) => String(value ?? "").trim() === wanted),
  );
}

export async function loadBatchPrintIdentities(input: {
  classCode: string;
  schoolName: string | null;
  className: string | null;
  studentIds: readonly string[];
}): Promise<BatchPrintIdentity[]> {
  const roster = (await classStudentsApi.list(input.classCode)) as RosterStudent[];
  const identities: BatchPrintIdentity[] = [];
  for (const studentId of input.studentIds) {
    const student = findRosterStudent(roster, studentId);
    const listed = await studentCardsApi.list(studentId);
    const kind = listed.holder?.kind === "eleve" || listed.holder?.kind === "etudiant" ? listed.holder.kind : null;
    const displayName = student ? String(student.name ?? "").trim() || `${student.lastName ?? ""} ${student.firstName ?? ""}`.trim() : "";
    const studentCode = student ? String(student.matricule ?? "").trim() || String(student.studentCode ?? "").trim() : "";
    identities.push({
      studentId,
      holderKind: kind,
      displayName: displayName || null,
      studentCode: studentCode || null,
      classLabel: input.className,
      schoolName: input.schoolName,
    });
  }
  return identities;
}
