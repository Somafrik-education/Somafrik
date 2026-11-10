import jsQR from "jsqr";
import {
  PDFDocument,
  StandardFonts,
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import {
  CARD_CUT_MARK_COLOR,
  CARD_CUT_MARK_WIDTH_PT,
  CARD_SHEET,
  CARD_SHEET_GUTTER_MM,
  STUDENT_CARD_INTER_METRICS,
  STUDENT_CARD_P1,
  cardCutMarkSegments,
  cardRectMm,
  cardVisualReport,
  chooseCardSheetLayout,
  decodeCardVisualDataUrl,
  readCardVisual,
  studentCardNameSizeMm,
  type CardSheetLayout,
  type CardVisual,
  type CardVisualReport,
  type CutMarkSegment,
} from "./studentCardDesign";

/**
 * CARTE-BATCH-PDF-02 — PDF A4 à partir du document CR80 déjà enregistré.
 *
 * Le fichier HTML somafrik-card-batch-print-v2 (ou l'ancien somafrik-card-batch-print-v1)
 * est la seule source. Les images QR sont recopiées telles quelles. Aucune émission, aucune
 * activation, aucun envoi des jetons. Le PDF et le HTML restent des documents sensibles.
 *
 * CARTE-BATCH-DESIGN-01 — chaque carte est dessinée selon la maquette P1 (STUDENT_CARD_P1) :
 * bandeau, logo, photo ou initiales, identité, QR à droite, référence et pied Somafrik.
 * Logo et photo viennent uniquement de la source v2 ; un document v1 n'en contient pas,
 * les cartes sont alors produites sans logo et avec les initiales, sans rien inventer.
 */
export const CARD_PDF_PRINT_FORMAT = "somafrik-card-batch-print-v2";
export const CARD_PDF_LEGACY_PRINT_FORMAT = "somafrik-card-batch-print-v1";
export const CLASS_CARD_PDF_BUTTON_LABEL = "Produire le PDF A4";
export const CLASS_CARD_PDF_DIALOG_TITLE = "PDF A4 des cartes";

export const CARD_PDF_UNRECOGNIZED =
  "Ce document n’est pas un lot de cartes CR80 reconnu. Aucun PDF n’est produit, et aucune carte n’est émise.";
export const CARD_PDF_INCOMPLETE =
  "Le document CR80 est incomplet ou altéré. Aucun PDF n’est produit, et aucune carte n’est émise.";
export const CARD_PDF_QR_MISMATCH =
  "Le QR d’une carte ne correspond pas à son jeton. Aucun PDF n’est produit, et aucune carte n’est émise.";

const CARD_PDF_HOLDER_TITLES = {
  eleve: "CARTE D’ÉLÈVE",
  etudiant: "CARTE D’ÉTUDIANT",
} as const;

const SCREEN_PLACEHOLDERS = ["Non renseigné", "Aucune inscription active"] as const;
const SOURCE_ID = "somafrik-card-batch-source";
const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{16,200}$/;
const STUDENT_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLASS_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Le document v2 transporte la police, le logo et les photos : plafond relevé, toujours borné. */
export const CARD_PDF_MAX_SOURCE_CHARS = 32_000_000;
const MAX_CARDS = 400;
const MAX_PNG_SIDE = 1024;
const MM_TO_PT = 72 / 25.4;

export { CARD_SHEET, CARD_SHEET_GUTTER_MM, cardCutMarkSegments, cardRectMm, chooseCardSheetLayout };
export type { CardSheetLayout, CutMarkSegment };

export type CardPdfResult =
  | {
      ok: true;
      bytes: Uint8Array;
      pageCount: number;
      cardCount: number;
      cardsPerPage: 8 | 10;
      classCode: string;
      visuals: CardVisualReport;
    }
  | { ok: false; message: string };

interface PrintableCard {
  holderTitle: string;
  displayName: string;
  schoolName: string | null;
  classLabel: string | null;
  studentCode: string | null;
  cardRef: string;
  photo: CardVisual;
  png: Uint8Array;
}

interface ValidatedDocument {
  classCode: string;
  schoolLogo: CardVisual;
  cards: PrintableCard[];
}

export function cardPdfOptionalLine(value: string | null): string | null {
  const text = typeof value === "string" ? value.normalize("NFC").trim() : "";
  if (!text || (SCREEN_PLACEHOLDERS as readonly string[]).includes(text)) return null;
  return text;
}

/** Taille du nom : mêmes paliers que la carte individuelle (STUDENT_CARD_P1). */
export function cardPdfNameSizeMm(displayName: string): number {
  return studentCardNameSizeMm(displayName);
}

export function suggestedCardPdfName(classCode: string): string {
  const safe = classCode.replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 48);
  return `cartes-a4-${safe || "classe"}.pdf`;
}

/** Référence imprimée : 6 derniers caractères de l'identifiant public, jamais le jeton. */
export function cardPdfRef(publicId: string): string {
  const value = publicId.trim();
  return value.length > 6 ? value.slice(-6) : value;
}

function fail(message: string): CardPdfResult {
  return { ok: false, message };
}

function sameText(actual: string | null, expected: string): boolean {
  if (actual == null || actual.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalField(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > 160) return undefined;
  return value;
}

function readableLine(value: string | null, forbidden: readonly string[]): string | null | undefined {
  const line = cardPdfOptionalLine(value);
  if (line && line.length > 160) return undefined;
  if (line && forbidden.some((secret) => secret.length > 0 && line.includes(secret))) return undefined;
  return line;
}

export async function convertBatchPrintFileToPdf(source: string): Promise<CardPdfResult> {
  if (typeof source !== "string" || source.length === 0 || source.length > CARD_PDF_MAX_SOURCE_CHARS) {
    return fail(CARD_PDF_UNRECOGNIZED);
  }
  const validated = validateSource(source);
  if (!validated.accepted) return validated.failure;
  const images = extractQrDataUrls(source);
  if (images.length !== validated.cards.length) return fail(CARD_PDF_INCOMPLETE);
  const printable: PrintableCard[] = [];
  for (let index = 0; index < validated.cards.length; index += 1) {
    const card = validated.cards[index];
    const png = decodeDataUrl(images[index]);
    const decoded = png ? await decodeCardPngRgba(png) : null;
    if (!png || !decoded) return fail(CARD_PDF_INCOMPLETE);
    const payload = jsQR(decoded.rgba, decoded.width, decoded.height, { inversionAttempts: "dontInvert" })?.data ?? null;
    if (!sameText(payload, card.cardToken)) return fail(CARD_PDF_QR_MISMATCH);
    printable.push({
      holderTitle: card.holderTitle,
      displayName: card.displayName,
      schoolName: card.schoolName,
      classLabel: card.classLabel,
      studentCode: card.studentCode,
      cardRef: cardPdfRef(card.publicId),
      photo: card.photo,
      png,
    });
  }
  return drawPdf({ classCode: validated.classCode, schoolLogo: validated.schoolLogo, cards: printable });
}

interface ParsedCard {
  cardToken: string;
  publicId: string;
  holderTitle: string;
  displayName: string;
  schoolName: string | null;
  classLabel: string | null;
  studentCode: string | null;
  photo: CardVisual;
}

const NOT_IN_SOURCE: CardVisual = { state: "not_in_source" };

function validateSource(
  source: string,
):
  | { accepted: true; classCode: string; schoolLogo: CardVisual; cards: ParsedCard[] }
  | { accepted: false; failure: CardPdfResult } {
  const match = source.match(
    new RegExp(`<script type="application/json" id="${SOURCE_ID}">([\\s\\S]*?)</script>`),
  );
  if (!match) return { accepted: false, failure: fail(CARD_PDF_UNRECOGNIZED) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { accepted: false, failure: fail(CARD_PDF_UNRECOGNIZED) };
  }
  if (!isRecord(parsed) || (parsed.format !== CARD_PDF_PRINT_FORMAT && parsed.format !== CARD_PDF_LEGACY_PRINT_FORMAT)) {
    return { accepted: false, failure: fail(CARD_PDF_UNRECOGNIZED) };
  }
  const legacy = parsed.format === CARD_PDF_LEGACY_PRINT_FORMAT;
  if (!Array.isArray(parsed.cards) || parsed.cards.length === 0 || parsed.cards.length > MAX_CARDS) {
    return { accepted: false, failure: fail(CARD_PDF_INCOMPLETE) };
  }
  if (typeof parsed.classCode !== "string" || !CLASS_CODE_RE.test(parsed.classCode)) {
    return { accepted: false, failure: fail(CARD_PDF_INCOMPLETE) };
  }
  if (typeof parsed.batchId !== "string" || !UUID_RE.test(parsed.batchId)) {
    return { accepted: false, failure: fail(CARD_PDF_INCOMPLETE) };
  }
  if (parsed.expiresAt != null && (typeof parsed.expiresAt !== "string" || parsed.expiresAt.length > 40)) {
    return { accepted: false, failure: fail(CARD_PDF_INCOMPLETE) };
  }
  if (parsed.className != null && (typeof parsed.className !== "string" || parsed.className.length > 160)) {
    return { accepted: false, failure: fail(CARD_PDF_INCOMPLETE) };
  }
  const schoolLogo = legacy ? NOT_IN_SOURCE : readCardVisual(parsed.schoolLogo);
  if (!schoolLogo) return { accepted: false, failure: fail(CARD_PDF_INCOMPLETE) };

  const publicIds = new Set<string>();
  const tokens = new Set<string>();
  const studentIds = new Set<string>();
  const cards: ParsedCard[] = [];
  for (const entry of parsed.cards) {
    const card = readCard(entry, legacy, publicIds, tokens, studentIds);
    if (!card) return { accepted: false, failure: fail(CARD_PDF_INCOMPLETE) };
    cards.push(card);
  }
  return { accepted: true, classCode: parsed.classCode, schoolLogo, cards };
}

function readCard(
  entry: unknown,
  legacy: boolean,
  publicIds: Set<string>,
  tokens: Set<string>,
  studentIds: Set<string>,
): ParsedCard | null {
  if (!isRecord(entry)) return null;
  const studentId = entry.studentId;
  const publicId = entry.publicId;
  const cardToken = entry.cardToken;
  const holderKind = entry.holderKind;
  const holderTitle = entry.holderTitle;
  const displayName = entry.displayName;
  if (typeof studentId !== "string" || !STUDENT_ID_RE.test(studentId) || studentIds.has(studentId)) return null;
  if (typeof publicId !== "string" || !PUBLIC_ID_RE.test(publicId) || publicIds.has(publicId)) return null;
  if (typeof cardToken !== "string" || tokens.has(cardToken)) return null;
  const dot = cardToken.indexOf(".");
  if (dot <= 0 || cardToken.indexOf(".", dot + 1) !== -1) return null;
  const tokenId = cardToken.slice(0, dot);
  const secret = cardToken.slice(dot + 1);
  if (tokenId !== publicId || !SECRET_RE.test(secret)) return null;
  if (holderKind !== "eleve" && holderKind !== "etudiant") return null;
  if (typeof holderTitle !== "string" || holderTitle !== CARD_PDF_HOLDER_TITLES[holderKind]) return null;
  if (typeof displayName !== "string") return null;
  const name = displayName.normalize("NFC").trim();
  if (!name || name.length > 120 || name.includes(secret) || name.includes(cardToken)) return null;
  const schoolName = optionalField(entry.schoolName);
  const classLabel = optionalField(entry.classLabel);
  const studentCode = optionalField(entry.studentCode);
  if (schoolName === undefined || classLabel === undefined || studentCode === undefined) return null;
  const forbidden = [secret, cardToken, publicId];
  const school = readableLine(schoolName, forbidden);
  const classLine = readableLine(classLabel, forbidden);
  const matricule = readableLine(studentCode, forbidden);
  if (school === undefined || classLine === undefined || matricule === undefined) return null;
  const photo = legacy ? NOT_IN_SOURCE : readCardVisual(entry.photo);
  if (!photo) return null;
  studentIds.add(studentId);
  publicIds.add(publicId);
  tokens.add(cardToken);
  return {
    cardToken,
    publicId,
    holderTitle,
    displayName: name,
    schoolName: school,
    classLabel: classLine,
    studentCode: matricule,
    photo,
  };
}

/**
 * Seules les images du QR comptent (attribut alt figé de la carte, v1 et v2). Le logo et les
 * photos sont relus depuis la source JSON validée, jamais depuis le balisage.
 */
function extractQrDataUrls(source: string): string[] {
  const found: string[] = [];
  const alt = STUDENT_CARD_P1.labels.qrAlt;
  const pattern = new RegExp(
    `<img\\b(?=[^>]*\\balt="${alt}")[^>]*\\bsrc="(data:image\\/png;base64,[A-Za-z0-9+/=\\s]+)"`,
    "g",
  );
  for (const match of source.matchAll(pattern)) found.push(match[1]);
  return found;
}

function decodeDataUrl(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1).replace(/\s/g, ""));
    if (binary.length < 32 || binary.length > 2_000_000) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

export async function decodeCardPngRgba(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; rgba: Uint8ClampedArray } | null> {
  try {
    return await decodePng(bytes);
  } catch {
    return null;
  }
}

async function decodePng(bytes: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < signature.length || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error("png");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    offset += 4;
    const type = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    offset += 4;
    if (length < 0 || offset + length + 4 > bytes.length) throw new Error("png");
    const data = bytes.subarray(offset, offset + length);
    offset += length + 4;
    if (type === "IHDR") {
      if (data.length < 13) throw new Error("png");
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = header.getUint32(0);
      height = header.getUint32(4);
      const bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error("png");
      if (width < 21 || height < 21 || width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) throw new Error("png");
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!width || !height || idat.length === 0) throw new Error("png");
  const compressed = concatBytes(idat);
  const inflated = await inflateZlib(compressed);
  const channels = bytesPerPixel(colorType);
  const stride = width * channels;
  if (inflated.length < height * (stride + 1)) throw new Error("png");
  const raw = unfilter(inflated, width, height, channels);
  const rgba = toRgba(raw, width, height, colorType, palette);
  return { width, height, rgba };
}

function bytesPerPixel(colorType: number): number {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 3) return 1;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error("png");
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = stream.pipeThrough(new DecompressionStream("deflate")).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    size += step.value.byteLength;
  }
  const inflated = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    inflated.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return inflated;
}

function unfilter(inflated: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  let offset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[offset];
    offset += 1;
    for (let column = 0; column < stride; column += 1) {
      const raw = inflated[offset];
      offset += 1;
      const left = column >= channels ? out[row * stride + column - channels] : 0;
      const up = row > 0 ? out[(row - 1) * stride + column] : 0;
      const upLeft = row > 0 && column >= channels ? out[(row - 1) * stride + column - channels] : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error("png");
      out[row * stride + column] = value & 255;
    }
  }
  return out;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonal = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonal) return left;
  if (upDistance <= diagonal) return up;
  return upLeft;
}

function toRgba(
  raw: Uint8Array,
  width: number,
  height: number,
  colorType: number,
  palette: Uint8Array | null,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const pixels = width * height;
  if (colorType === 6) {
    rgba.set(raw.subarray(0, pixels * 4));
    return rgba;
  }
  for (let index = 0; index < pixels; index += 1) {
    const target = index * 4;
    if (colorType === 2) {
      const source = index * 3;
      rgba[target] = raw[source];
      rgba[target + 1] = raw[source + 1];
      rgba[target + 2] = raw[source + 2];
      rgba[target + 3] = 255;
    } else if (colorType === 0) {
      rgba[target] = raw[index];
      rgba[target + 1] = raw[index];
      rgba[target + 2] = raw[index];
      rgba[target + 3] = 255;
    } else if (colorType === 4) {
      rgba[target] = raw[index * 2];
      rgba[target + 1] = raw[index * 2];
      rgba[target + 2] = raw[index * 2];
      rgba[target + 3] = raw[index * 2 + 1];
    } else if (colorType === 3 && palette) {
      const color = raw[index] * 3;
      rgba[target] = palette[color] ?? 0;
      rgba[target + 1] = palette[color + 1] ?? 0;
      rgba[target + 2] = palette[color + 2] ?? 0;
      rgba[target + 3] = 255;
    } else {
      throw new Error("png");
    }
  }
  return rgba;
}

/* ------------------------------------------------------------------------------------------ */
/* Dessin de la maquette P1 (cotes STUDENT_CARD_P1, en millimètres).                           */
/* ------------------------------------------------------------------------------------------ */

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

interface CardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const pt = (valueMm: number) => valueMm * MM_TO_PT;

function hexColor(hex: string): RGB {
  const value = hex.replace("#", "");
  return rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  );
}

const COLORS = {
  navy: hexColor(STUDENT_CARD_P1.colors.navy),
  brand: hexColor(STUDENT_CARD_P1.colors.brand),
  ink: hexColor(STUDENT_CARD_P1.colors.ink),
  muted: hexColor(STUDENT_CARD_P1.colors.muted),
  tint: hexColor(STUDENT_CARD_P1.colors.tint),
  paper: hexColor(STUDENT_CARD_P1.colors.paper),
  mark: hexColor(CARD_CUT_MARK_COLOR),
};

function valueStep(value: string, threshold: number): "l1" | "l2" {
  return Array.from(value.trim()).length <= threshold ? "l1" : "l2";
}

/** Position de la ligne de base dans une boîte de ligne CSS (Inter, interlignage centré). */
function baselineInLine(sizeMm: number, lineHeight: number): number {
  const { ascent, descent } = STUDENT_CARD_INTER_METRICS;
  return ((lineHeight - (ascent + descent)) * sizeMm) / 2 + ascent * sizeMm;
}

function trackedWidthMm(text: string, font: PDFFont, sizeMm: number, trackingEm = 0): number {
  const chars = Array.from(text).length;
  return font.widthOfTextAtSize(text, pt(sizeMm)) / MM_TO_PT + chars * trackingEm * sizeMm;
}

interface TextStyle {
  font: PDFFont;
  sizeMm: number;
  color: RGB;
  trackingEm?: number;
  opacity?: number;
}

/** Écrit une ligne ; (xMm, baselineFromTopMm) dans le repère de la carte, origine en haut à gauche. */
function drawLine(page: PDFPage, box: CardBox, text: string, xMm: number, baselineFromTopMm: number, style: TextStyle) {
  const tracking = (style.trackingEm ?? 0) * style.sizeMm;
  if (tracking) page.pushOperators(setCharacterSpacing(pt(tracking)));
  page.drawText(text, {
    x: pt(box.x + xMm),
    y: pt(box.y + box.height - baselineFromTopMm),
    size: pt(style.sizeMm),
    font: style.font,
    color: style.color,
    opacity: style.opacity,
  });
  if (tracking) page.pushOperators(setCharacterSpacing(0));
}

function roundedRectPath(x: number, y: number, width: number, height: number, radius: number): PDFOperator[] {
  const r = Math.min(radius, width / 2, height / 2);
  const k = 0.5522847498 * r;
  return [
    moveTo(x + r, y),
    lineTo(x + width - r, y),
    appendBezierCurve(x + width - r + k, y, x + width, y + r - k, x + width, y + r),
    lineTo(x + width, y + height - r),
    appendBezierCurve(x + width, y + height - r + k, x + width - r + k, y + height, x + width - r, y + height),
    lineTo(x + r, y + height),
    appendBezierCurve(x + r - k, y + height, x, y + height - r + k, x, y + height - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
    closePath(),
  ];
}

/** Rectangle (mm, repère carte depuis le haut) en points PDF. */
function areaPt(box: CardBox, leftMm: number, topMm: number, widthMm: number, heightMm: number) {
  return {
    x: pt(box.x + leftMm),
    y: pt(box.y + box.height - topMm - heightMm),
    width: pt(widthMm),
    height: pt(heightMm),
  };
}

/** Image recadrée dans une zone (couverture ou contenu), découpée par le tracé donné. */
function drawClippedImage(
  page: PDFPage,
  image: PDFImage,
  area: { x: number; y: number; width: number; height: number },
  clipPath: PDFOperator[],
  fit: "cover" | "contain",
) {
  const scale =
    fit === "cover"
      ? Math.max(area.width / image.width, area.height / image.height)
      : Math.min(area.width / image.width, area.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.pushOperators(pushGraphicsState(), ...clipPath, clip(), endPath());
  page.drawImage(image, {
    x: area.x + (area.width - width) / 2,
    y: area.y + (area.height - height) / 2,
    width,
    height,
  });
  page.pushOperators(popGraphicsState());
}

function wrapText(text: string, font: PDFFont, sizeMm: number, maxWidthMm: number, trackingEm = 0): string[] {
  const fits = (value: string) => trackedWidthMm(value, font, sizeMm, trackingEm) <= maxWidthMm;
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const pieces = fits(word) ? [word] : breakWord(word, fits);
    for (const piece of pieces) {
      const next = current ? `${current} ${piece}` : piece;
      if (fits(next)) current = next;
      else {
        if (current) lines.push(current);
        current = piece;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

function breakWord(word: string, fits: (value: string) => boolean): string[] {
  const parts: string[] = [];
  let chunk = "";
  for (const char of Array.from(word)) {
    const next = chunk + char;
    if (fits(next) || chunk.length === 0) chunk = next;
    else {
      parts.push(chunk);
      chunk = char;
    }
  }
  if (chunk) parts.push(chunk);
  return parts;
}

function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function drawCard(
  page: PDFPage,
  box: CardBox,
  card: PrintableCard,
  qr: PDFImage,
  photo: PDFImage | null,
  logo: PDFImage | null,
  fonts: Fonts,
) {
  const d = STUDENT_CARD_P1;
  const W = d.widthMm;
  const H = d.heightMm;
  const longSchool = card.schoolName ? valueStep(card.schoolName, d.thresholds.schoolName) === "l2" : false;

  // Fond de carte.
  page.drawRectangle({ ...areaPt(box, 0, 0, W, H), color: COLORS.paper });

  // Bandeau institutionnel.
  const bandH = longSchool ? d.band.longHeightMm : d.band.heightMm;
  page.drawRectangle({ ...areaPt(box, 0, 0, W, bandH), color: COLORS.navy });

  if (logo) {
    const radius = d.band.logoDiameterMm / 2;
    const centerX = box.x + d.band.padXMm + radius;
    const centerY = box.y + H - bandH / 2;
    page.drawCircle({ x: pt(centerX), y: pt(centerY), size: pt(radius), color: COLORS.paper });
    const image = d.band.logoImageMm;
    const area = areaPt(box, d.band.padXMm + radius - image / 2, bandH / 2 - image / 2, image, image);
    const circle = roundedRectPath(pt(centerX - radius), pt(centerY - radius), pt(2 * radius), pt(2 * radius), pt(radius));
    drawClippedImage(page, logo, area, circle, "contain");
  }

  const columnLeft = d.band.padXMm + d.band.slotWidthMm;
  const columnWidth = W - 2 * (d.band.padXMm + d.band.slotWidthMm);
  const columnCenter = columnLeft + columnWidth / 2;
  const holderSize = longSchool ? d.band.longHolderSizeMm : d.band.holderSizeMm;
  const schoolStep = longSchool ? "l2" : "l1";
  const schoolSize = d.band.schoolSizeMm[schoolStep];
  const schoolLineHeight = d.band.schoolLineHeight[schoolStep];
  const schoolLines = card.schoolName ? wrapText(card.schoolName, fonts.regular, schoolSize, columnWidth) : [];
  const gap = longSchool ? d.band.longTextGapMm : d.band.textGapMm;
  const blockHeight = holderSize + (schoolLines.length > 0 ? gap + schoolLines.length * schoolSize * schoolLineHeight : 0);
  let bandCursor = (bandH - blockHeight) / 2;
  const holderStyle: TextStyle = {
    font: fonts.bold,
    sizeMm: holderSize,
    color: COLORS.paper,
    trackingEm: d.band.holderTrackingEm,
  };
  const holderWidth = trackedWidthMm(card.holderTitle, fonts.bold, holderSize, d.band.holderTrackingEm);
  drawLine(page, box, card.holderTitle, columnCenter - holderWidth / 2, bandCursor + baselineInLine(holderSize, 1), holderStyle);
  bandCursor += holderSize + gap;
  for (const line of schoolLines) {
    const width = trackedWidthMm(line, fonts.regular, schoolSize);
    drawLine(page, box, line, columnCenter - width / 2, bandCursor + baselineInLine(schoolSize, schoolLineHeight), {
      font: fonts.regular,
      sizeMm: schoolSize,
      color: COLORS.paper,
      opacity: d.band.schoolOpacity,
    });
    bandCursor += schoolSize * schoolLineHeight;
  }

  // Corps : photo ou initiales, identité, QR à droite.
  const bodyTop = longSchool ? d.body.longTopMm : d.body.topMm;
  const photoLeft = d.body.leftMm;
  const photoArea = areaPt(box, photoLeft, bodyTop, d.photo.widthMm, d.photo.heightMm);
  const photoPath = roundedRectPath(photoArea.x, photoArea.y, photoArea.width, photoArea.height, pt(d.photo.radiusMm));
  page.pushOperators(pushGraphicsState(), ...photoPath, clip(), endPath());
  page.drawRectangle({ ...photoArea, color: COLORS.tint });
  page.pushOperators(popGraphicsState());
  if (photo) {
    drawClippedImage(page, photo, photoArea, photoPath, "cover");
  } else {
    const initials = initialsOf(card.displayName);
    const size = d.photo.initialsSizeMm;
    const width = trackedWidthMm(initials, fonts.bold, size, d.photo.initialsTrackingEm);
    const { ascent, descent } = STUDENT_CARD_INTER_METRICS;
    const baseline = bodyTop + d.photo.heightMm / 2 - ((ascent + descent) * size) / 2 + ascent * size;
    drawLine(page, box, initials, photoLeft + d.photo.widthMm / 2 - width / 2, baseline, {
      font: fonts.bold,
      sizeMm: size,
      color: COLORS.navy,
      trackingEm: d.photo.initialsTrackingEm,
    });
  }

  const qrLeft = W - d.body.rightMm - d.qr.sizeMm;
  page.drawImage(qr, areaPt(box, qrLeft, bodyTop, d.qr.sizeMm, d.qr.sizeMm));

  const infoLeft = photoLeft + d.photo.widthMm + d.body.gapMm;
  const infoWidth = qrLeft - d.body.gapMm - infoLeft;
  let cursor = bodyTop;
  const block = (text: string, style: TextStyle, lineHeight: number) => {
    for (const line of wrapText(text, style.font, style.sizeMm, infoWidth, style.trackingEm)) {
      drawLine(page, box, line, infoLeft, cursor + baselineInLine(style.sizeMm, lineHeight), style);
      cursor += style.sizeMm * lineHeight;
    }
  };
  block(card.displayName, { font: fonts.bold, sizeMm: studentCardNameSizeMm(card.displayName), color: COLORS.ink }, d.info.nameLineHeight);
  if (card.classLabel) {
    cursor += d.info.gapMm;
    const size = d.info.valueSizeMm[valueStep(card.classLabel, d.thresholds.classLabel)];
    block(card.classLabel, { font: fonts.bold, sizeMm: size, color: COLORS.ink }, d.info.valueLineHeight);
  }
  if (card.studentCode) {
    cursor += d.info.gapMm;
    block(
      d.labels.matricule.toUpperCase(),
      { font: fonts.bold, sizeMm: d.info.captionSizeMm, color: COLORS.muted, trackingEm: d.info.captionTrackingEm },
      d.info.captionLineHeight,
    );
    const size = d.info.valueSizeMm[valueStep(card.studentCode, d.thresholds.studentCode)];
    block(
      card.studentCode,
      { font: fonts.bold, sizeMm: size, color: COLORS.ink, trackingEm: d.info.numberTrackingEm },
      d.info.valueLineHeight,
    );
  }

  // Pied de carte : référence abrégée et marque Somafrik.
  const footTop = H - d.foot.heightMm;
  page.drawRectangle({ ...areaPt(box, 0, footTop, W, d.foot.heightMm), color: COLORS.tint });
  page.drawRectangle({ ...areaPt(box, 0, footTop, W, d.foot.borderMm), color: COLORS.brand });
  const footSize = d.foot.textSizeMm;
  const footContent = d.foot.heightMm - d.foot.borderMm;
  const footBaseline = footTop + d.foot.borderMm + (footContent - footSize) / 2 + baselineInLine(footSize, 1);
  const label = `${d.labels.cardRef} `;
  const footStyle: TextStyle = { font: fonts.regular, sizeMm: footSize, color: COLORS.muted };
  drawLine(page, box, label, d.foot.padXMm, footBaseline, footStyle);
  drawLine(page, box, `…${card.cardRef}`, d.foot.padXMm + trackedWidthMm(label, fonts.regular, footSize), footBaseline, {
    ...footStyle,
    trackingEm: d.info.numberTrackingEm,
  });
  const brandWidth = trackedWidthMm(d.labels.brand, fonts.bold, footSize, d.foot.brandTrackingEm);
  drawLine(page, box, d.labels.brand, W - d.foot.padXMm - brandWidth, footBaseline, {
    font: fonts.bold,
    sizeMm: footSize,
    color: COLORS.muted,
    trackingEm: d.foot.brandTrackingEm,
  });
}

async function embedVisual(pdf: PDFDocument, visual: CardVisual): Promise<PDFImage | null> {
  if (visual.state !== "embedded") return null;
  const decoded = decodeCardVisualDataUrl(visual.src);
  if (!decoded) throw new Error("visual");
  return decoded.type === "png" ? pdf.embedPng(decoded.bytes) : pdf.embedJpg(decoded.bytes);
}

async function drawPdf(document: ValidatedDocument): Promise<CardPdfResult> {
  const layout = chooseCardSheetLayout();
  if (!layout) return fail(CARD_PDF_INCOMPLETE);
  try {
    const pdf = await PDFDocument.create();
    const fonts: Fonts = {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    };
    const logo = await embedVisual(pdf, document.schoolLogo);
    const qrs: PDFImage[] = [];
    const photos: (PDFImage | null)[] = [];
    for (const card of document.cards) {
      qrs.push(await pdf.embedPng(card.png));
      photos.push(await embedVisual(pdf, card.photo));
    }
    const pageWidth = layout.pageWidthMm * MM_TO_PT;
    const pageHeight = layout.pageHeightMm * MM_TO_PT;
    const pageCount = Math.ceil(document.cards.length / layout.cardsPerPage);
    const pages: PDFPage[] = [];
    for (let index = 0; index < pageCount; index += 1) pages.push(pdf.addPage([pageWidth, pageHeight]));
    document.cards.forEach((card, index) => {
      const page = pages[Math.floor(index / layout.cardsPerPage)];
      const rect = cardRectMm(layout, index % layout.cardsPerPage);
      drawCard(page, rect, card, qrs[index], photos[index], logo, fonts);
      drawCutMarks(page, rect, layout);
    });
    const bytes = await pdf.save();
    return {
      ok: true,
      bytes,
      pageCount,
      cardCount: document.cards.length,
      cardsPerPage: layout.cardsPerPage,
      classCode: document.classCode,
      visuals: cardVisualReport(
        document.schoolLogo,
        document.cards.map((card) => card.photo),
      ),
    };
  } catch {
    return fail(CARD_PDF_INCOMPLETE);
  }
}

function drawCutMarks(page: PDFPage, rect: CardBox, layout: CardSheetLayout) {
  for (const segment of cardCutMarkSegments(rect.x, rect.y, rect.width, rect.height, layout.offsetMm, layout.markMm)) {
    page.drawLine({
      start: { x: segment.x1 * MM_TO_PT, y: segment.y1 * MM_TO_PT },
      end: { x: segment.x2 * MM_TO_PT, y: segment.y2 * MM_TO_PT },
      thickness: CARD_CUT_MARK_WIDTH_PT,
      color: COLORS.mark,
    });
  }
}
