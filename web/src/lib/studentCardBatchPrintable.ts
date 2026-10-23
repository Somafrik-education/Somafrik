import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StudentCardFace } from "../components/students/StudentCardFace";
import { classStudentsApi } from "./classStudentsApi";
import { schoolHasLogo, schoolLogoSrc, type SchoolLogoSource } from "./schoolLogo";
import {
  CARD_CUT_MARK_COLOR,
  CARD_CUT_MARK_WIDTH_PT,
  CARD_LOGO_PIXELS,
  CARD_PHOTO_PIXELS,
  STUDENT_CARD_FONT_STACK,
  STUDENT_CARD_P1,
  cardCutMarkSegments,
  cardRectMm,
  cardVisualSrc,
  chooseCardSheetLayout,
  decodeCardVisualDataUrl,
  readCardVisual,
  studentCardFaceCss,
  type CardVisual,
} from "./studentCardDesign";
import { STUDENT_CARD_FONT_FACES, STUDENT_CARD_FONT_FAMILY } from "./studentCardFonts";
import {
  STUDENT_CARD_CR80,
  studentCardHolderTitle,
  studentCardOptionalText,
  studentCardRef,
} from "./studentCardPolicy";
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
 *
 * CARTE-BATCH-DESIGN-01 — chaque carte du document est le composant StudentCardFace
 * (maquette P1) rendu tel quel, avec le CSS de la référence unique studentCardDesign.
 * La source v2 transporte aussi le logo de l'établissement et la photo de chaque élève.
 * Les jetons et leur format restent inchangés. Un document v1 se relit toujours :
 * le logo et les photos y sont marqués « not_in_source », jamais inventés.
 */
export const CARD_BATCH_PRINT_FORMAT = "somafrik-card-batch-print-v2";
export const CARD_BATCH_PRINT_LEGACY_FORMAT = "somafrik-card-batch-print-v1";
const SOURCE_ELEMENT_ID = "somafrik-card-batch-source";

export interface BatchPrintIdentity {
  studentId: string;
  holderKind: "eleve" | "etudiant" | null;
  displayName: string | null;
  studentCode: string | null;
  classLabel: string | null;
  schoolName: string | null;
  /** Absent : l'identité ne fournit pas de photo (initiales imprimées). */
  photo?: CardVisual;
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
  photo: CardVisual;
}

export interface BatchPrintDocument {
  format: typeof CARD_BATCH_PRINT_FORMAT;
  batchId: string;
  classCode: string;
  className: string | null;
  expiresAt: string | null;
  schoolLogo: CardVisual;
  cards: BatchPrintCard[];
}

export interface BatchPrintMeta {
  batchId: string;
  classCode: string;
  className: string | null;
  expiresAt: string | null;
  schoolLogo?: CardVisual;
}

type PrintResult<T> = { ok: true; value: T } | { ok: false; message: string };

const PRINT_UNAVAILABLE =
  "Le document CR80 ne peut pas être produit. Les cartes ne seront pas activées, et aucune nouvelle émission n'est lancée.";

const ABSENT: CardVisual = Object.freeze({ state: "absent" }) as CardVisual;
const UNAVAILABLE: CardVisual = Object.freeze({ state: "unavailable" }) as CardVisual;
const NOT_IN_SOURCE: CardVisual = Object.freeze({ state: "not_in_source" }) as CardVisual;

function copyVisual(visual: CardVisual | undefined): CardVisual | undefined {
  if (visual === undefined) return ABSENT;
  return readCardVisual(visual);
}

export function assembleBatchPrintDocument(
  meta: BatchPrintMeta,
  secrets: readonly PreparedCardSecret[],
  identities: readonly BatchPrintIdentity[],
): PrintResult<BatchPrintDocument> {
  if (!meta.batchId || secrets.length === 0) return { ok: false, message: PRINT_UNAVAILABLE };
  const schoolLogo = copyVisual(meta.schoolLogo);
  if (!schoolLogo) return { ok: false, message: PRINT_UNAVAILABLE };
  const byStudent = new Map(identities.map((identity) => [identity.studentId, identity]));
  const cards: BatchPrintCard[] = [];
  for (const secret of secrets) {
    const identity = byStudent.get(secret.studentId);
    const holderTitle = studentCardHolderTitle(
      identity?.holderKind ? { kind: identity.holderKind, source: "school_setting" } : null,
    );
    const displayName = identity?.displayName?.trim() ?? "";
    const photo = copyVisual(identity?.photo);
    if (!identity || !holderTitle || !displayName || identity.holderKind == null || !photo) {
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
      photo,
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
      schoolLogo,
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

const fixed = (value: number) => `${Number(value.toFixed(3))}mm`;

/** Recto P1 d'une carte du lot : le composant de la carte individuelle, sans aucune variante. */
export function renderBatchCardFaceMarkup(
  card: BatchPrintCard,
  schoolLogo: CardVisual,
  qrSrc: string,
): string {
  return renderToStaticMarkup(
    createElement(StudentCardFace, {
      holderTitle: card.holderTitle,
      identity: {
        displayName: card.displayName,
        classLabel: studentCardOptionalText(card.classLabel),
        studentCode: studentCardOptionalText(card.studentCode),
        schoolName: studentCardOptionalText(card.schoolName),
        photoUrl: cardVisualSrc(card.photo),
      },
      cardRef: studentCardRef(card.publicId),
      logoSrc: cardVisualSrc(schoolLogo),
      qr: { kind: "ready", src: qrSrc },
    }),
  );
}

function sheetCss(): string {
  return `
@page { size: A4 portrait; margin: 0; }
html, body { margin: 0; padding: 0; }
body { background: #e2e8f0; color: ${STUDENT_CARD_P1.colors.ink}; font-family: ${STUDENT_CARD_FONT_STACK}; }
.scb-notice { box-sizing: border-box; width: 210mm; margin: 6mm auto; padding: 0 4mm; font-size: 12px; line-height: 1.4; }
.scb-page { position: relative; width: 210mm; height: 297mm; margin: 0 auto 8mm; background: #ffffff; overflow: hidden; }
.scb-slot { position: absolute; width: ${STUDENT_CARD_CR80.width}; height: ${STUDENT_CARD_CR80.height}; }
.scb-slot .student-card-face { border-radius: 0; box-shadow: none; }
.scb-mark { position: absolute; display: block; background: ${CARD_CUT_MARK_COLOR}; }
@media print {
  body { background: #ffffff; }
  .scb-notice { display: none; }
  .scb-page { margin: 0; break-after: page; page-break-after: always; }
  .scb-page:last-child { break-after: auto; page-break-after: auto; }
}
`;
}

/** Feuilles A4 : même grille et mêmes repères de découpe que le PDF A4 (studentCardDesign). */
function sheetPages(faces: readonly string[]): string | null {
  const layout = chooseCardSheetLayout();
  if (!layout) return null;
  const markMm = CARD_CUT_MARK_WIDTH_PT * (25.4 / 72);
  const pages: string[] = [];
  for (let start = 0; start < faces.length; start += layout.cardsPerPage) {
    const slots: string[] = [];
    const marks: string[] = [];
    faces.slice(start, start + layout.cardsPerPage).forEach((face, offset) => {
      const rect = cardRectMm(layout, offset);
      const top = layout.pageHeightMm - rect.y - rect.height;
      slots.push(`<div class="scb-slot" style="left:${fixed(rect.x)};top:${fixed(top)}">${face}</div>`);
      for (const segment of cardCutMarkSegments(rect.x, rect.y, rect.width, rect.height, layout.offsetMm, layout.markMm)) {
        const horizontal = segment.y1 === segment.y2;
        const left = horizontal ? Math.min(segment.x1, segment.x2) : segment.x1 - markMm / 2;
        const bottom = horizontal ? segment.y1 - markMm / 2 : Math.min(segment.y1, segment.y2);
        const width = horizontal ? Math.abs(segment.x2 - segment.x1) : markMm;
        const height = horizontal ? markMm : Math.abs(segment.y2 - segment.y1);
        const markTop = layout.pageHeightMm - bottom - height;
        marks.push(
          `<i class="scb-mark" style="left:${fixed(left)};top:${fixed(markTop)};width:${fixed(width)};height:${fixed(height)}"></i>`,
        );
      }
    });
    const pageNumber = pages.length + 1;
    pages.push(`<section class="scb-page" aria-label="Page ${pageNumber}">${slots.join("")}${marks.join("")}</section>`);
  }
  return pages.join("");
}

export interface BatchPrintRenderOptions {
  /** Règles @font-face intégrées (police de la carte). Vide : police de secours, comme la carte individuelle. */
  fontCss?: string;
}

function sameVisual(left: CardVisual, right: CardVisual): boolean {
  return left.state === right.state && cardVisualSrc(left) === cardVisualSrc(right);
}

export function convertBatchPrintDocument(
  document: BatchPrintDocument,
  qrByPublicId: ReadonlyMap<string, string>,
  options: BatchPrintRenderOptions = {},
): PrintResult<string> {
  if (document.format !== CARD_BATCH_PRINT_FORMAT || document.cards.length === 0) {
    return { ok: false, message: PRINT_UNAVAILABLE };
  }
  if (!readCardVisual(document.schoolLogo)) return { ok: false, message: PRINT_UNAVAILABLE };
  const faces: string[] = [];
  for (const card of document.cards) {
    const qr = qrByPublicId.get(card.publicId) ?? "";
    if (!qr.startsWith("data:image/png") || !card.holderTitle || !card.displayName || !card.cardToken) {
      return { ok: false, message: PRINT_UNAVAILABLE };
    }
    if (!readCardVisual(card.photo)) return { ok: false, message: PRINT_UNAVAILABLE };
    faces.push(renderBatchCardFaceMarkup(card, document.schoolLogo, qr));
  }
  const pages = sheetPages(faces);
  if (!pages) return { ok: false, message: PRINT_UNAVAILABLE };
  const fontCss = typeof options.fontCss === "string" && !/<\/?style/i.test(options.fontCss) ? options.fontCss : "";
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Cartes élèves CR80</title><style>${fontCss}${studentCardFaceCss()}${sheetCss()}</style></head><body><p class="scb-notice">${escapeHtml(
    "Document CR80 local. Il sert à imprimer les cartes (A4, taille réelle, échelle 100 %) et à produire plus tard le PDF, sans nouvelle émission.",
  )}</p><main class="scb-sheets">${pages}</main><script type="application/json" id="${SOURCE_ELEMENT_ID}">${sourceJson(document)}</script></body></html>`;
  const readBack = readBatchPrintDocument(html);
  if (!readBack.ok || readBack.value.cards.length !== document.cards.length) {
    return { ok: false, message: PRINT_UNAVAILABLE };
  }
  if (!sameVisual(readBack.value.schoolLogo, document.schoolLogo)) return { ok: false, message: PRINT_UNAVAILABLE };
  for (let index = 0; index < document.cards.length; index += 1) {
    const original = document.cards[index];
    const restored = readBack.value.cards[index];
    if (
      restored.publicId !== original.publicId ||
      restored.cardToken !== original.cardToken ||
      !sameVisual(restored.photo, original.photo)
    ) {
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
    const parsed = JSON.parse(match[1]) as Omit<Partial<BatchPrintDocument>, "format"> & { format?: string; cards?: unknown };
    const legacy = parsed.format === CARD_BATCH_PRINT_LEGACY_FORMAT;
    if ((!legacy && parsed.format !== CARD_BATCH_PRINT_FORMAT) || !Array.isArray(parsed.cards) || parsed.cards.length === 0) {
      return { ok: false, message: PRINT_UNAVAILABLE };
    }
    const schoolLogo = legacy ? NOT_IN_SOURCE : readCardVisual(parsed.schoolLogo);
    if (!schoolLogo) return { ok: false, message: PRINT_UNAVAILABLE };
    const cards: BatchPrintCard[] = [];
    for (const card of parsed.cards as Partial<BatchPrintCard>[]) {
      const photo = legacy ? NOT_IN_SOURCE : readCardVisual(card.photo);
      if (!photo) return { ok: false, message: PRINT_UNAVAILABLE };
      cards.push({
        studentId: String(card.studentId ?? ""),
        publicId: String(card.publicId ?? ""),
        cardToken: String(card.cardToken ?? ""),
        holderKind: card.holderKind === "etudiant" ? "etudiant" : "eleve",
        holderTitle: String(card.holderTitle ?? ""),
        displayName: String(card.displayName ?? ""),
        studentCode: card.studentCode ?? null,
        classLabel: card.classLabel ?? null,
        schoolName: card.schoolName ?? null,
        photo,
      });
    }
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
        schoolLogo,
        cards,
      },
    };
  } catch {
    return { ok: false, message: PRINT_UNAVAILABLE };
  }
}

export interface BatchPrintEnvironment extends BatchPrintRenderOptions {
  /** Produit les règles @font-face intégrées ; par défaut, lit les fichiers locaux de la police. */
  loadFontCss?: () => Promise<string>;
}

export async function renderBatchPrintDocument(
  document: BatchPrintDocument,
  env: BatchPrintEnvironment = {},
): Promise<PrintResult<string>> {
  const qrByPublicId = new Map<string, string>();
  for (const card of document.cards) {
    const qr = await renderStudentCardQrDataUrl(card.cardToken);
    qrByPublicId.set(card.publicId, qr);
  }
  let fontCss = env.fontCss;
  if (fontCss === undefined) {
    try {
      fontCss = await (env.loadFontCss ?? loadEmbeddedCardFontCss)();
    } catch {
      fontCss = "";
    }
  }
  return convertBatchPrintDocument(document, qrByPublicId, { fontCss });
}

/* ------------------------------------------------------------------------------------------ */
/* Intégration de la police, du logo et des photos (navigateur uniquement, sans jeton).        */
/* ------------------------------------------------------------------------------------------ */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * Règles @font-face de la police de la carte, fichiers intégrés : le document s'ouvre hors
 * connexion avec la même typographie que la carte individuelle. Échec : chaîne vide.
 */
export async function loadEmbeddedCardFontCss(fetcher: typeof fetch = fetch): Promise<string> {
  try {
    const rules: string[] = [];
    for (const face of STUDENT_CARD_FONT_FACES) {
      const response = await fetcher(face.src);
      if (!response.ok) return "";
      const bytes = new Uint8Array(await response.arrayBuffer());
      const woff2 = bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32;
      if (!woff2 || bytes.length > 200_000) return "";
      rules.push(
        `@font-face{font-family:"${STUDENT_CARD_FONT_FAMILY}";src:url(data:font/woff2;base64,${bytesToBase64(bytes)}) format("woff2");font-weight:${face.weight};font-style:normal;font-display:block;unicode-range:${face.unicodeRange};}`,
      );
    }
    return rules.join("");
  } catch {
    return "";
  }
}

export type CardImageKind = "photo" | "logo";
export type CardImageLoader = (url: string | null | undefined, kind: CardImageKind) => Promise<CardVisual>;

const IMAGE_FETCH_TIMEOUT_MS = 8000;
const IMAGE_MAX_SOURCE_BYTES = 8_000_000;

function acceptedImageUrl(url: string): boolean {
  return /^(https?:\/\/|\/(?!\/)|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(url);
}

/**
 * Récupère l'image, la recadre aux dimensions de la maquette (photo : couverture 20 × 25,7 mm ;
 * logo : contenu dans un carré) et l'intègre en data URL. Aucun identifiant ni jeton n'est envoyé.
 */
export const embedCardImage: CardImageLoader = async (url, kind) => {
  const raw = String(url ?? "").trim();
  if (!raw) return ABSENT;
  if (!acceptedImageUrl(raw) || typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return UNAVAILABLE;
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetch(raw, { credentials: "omit", cache: "no-store", signal: controller?.signal });
    if (!response.ok) return UNAVAILABLE;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size <= 0 || blob.size > IMAGE_MAX_SOURCE_BYTES) return UNAVAILABLE;
    const bitmap = await createImageBitmap(blob);
    const width = kind === "photo" ? CARD_PHOTO_PIXELS.width : CARD_LOGO_PIXELS;
    const height = kind === "photo" ? CARD_PHOTO_PIXELS.height : CARD_LOGO_PIXELS;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context || bitmap.width <= 0 || bitmap.height <= 0) return UNAVAILABLE;
    const scale =
      kind === "photo"
        ? Math.max(width / bitmap.width, height / bitmap.height)
        : Math.min(width / bitmap.width, height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    if (kind === "photo") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    bitmap.close?.();
    const src = kind === "photo" ? canvas.toDataURL("image/jpeg", 0.85) : canvas.toDataURL("image/png");
    return decodeCardVisualDataUrl(src) ? { state: "embedded", src } : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Logo de l'établissement : absent si aucun logo téléversé, jamais de logo de remplacement. */
export async function loadBatchPrintSchoolLogo(
  school: SchoolLogoSource,
  loadImage: CardImageLoader = embedCardImage,
): Promise<CardVisual> {
  if (!schoolHasLogo(school)) return ABSENT;
  const src = schoolLogoSrc(school);
  if (!src) return UNAVAILABLE;
  try {
    return await loadImage(src, "logo");
  } catch {
    return UNAVAILABLE;
  }
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
  photoUrl?: string | null;
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
  loadImage?: CardImageLoader;
}): Promise<BatchPrintIdentity[]> {
  const loadImage = input.loadImage ?? embedCardImage;
  const roster = (await classStudentsApi.list(input.classCode)) as RosterStudent[];
  const identities: BatchPrintIdentity[] = [];
  for (const studentId of input.studentIds) {
    const student = findRosterStudent(roster, studentId);
    const listed = await studentCardsApi.list(studentId);
    const kind = listed.holder?.kind === "eleve" || listed.holder?.kind === "etudiant" ? listed.holder.kind : null;
    const displayName = student ? String(student.name ?? "").trim() || `${student.lastName ?? ""} ${student.firstName ?? ""}`.trim() : "";
    const studentCode = student ? String(student.matricule ?? "").trim() || String(student.studentCode ?? "").trim() : "";
    let photo: CardVisual = ABSENT;
    try {
      photo = await loadImage(student?.photoUrl ?? null, "photo");
    } catch {
      photo = UNAVAILABLE;
    }
    identities.push({
      studentId,
      holderKind: kind,
      displayName: displayName || null,
      studentCode: studentCode || null,
      classLabel: input.className,
      schoolName: input.schoolName,
      photo,
    });
  }
  return identities;
}
