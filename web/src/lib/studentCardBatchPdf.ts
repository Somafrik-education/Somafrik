import jsQR from "jsqr";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * CARTE-BATCH-PDF-02 — PDF A4 à partir du document CR80 déjà enregistré.
 *
 * Le fichier HTML somafrik-card-batch-print-v1 est la seule source. Les images
 * QR sont recopiées telles quelles. Aucune émission, aucune activation, aucun
 * envoi des jetons. Le PDF et le HTML restent des documents sensibles.
 */
export const CARD_PDF_PRINT_FORMAT = "somafrik-card-batch-print-v1";
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
const MAX_SOURCE_CHARS = 8_000_000;
const MAX_CARDS = 400;
const MAX_PNG_SIDE = 1024;
const MM_TO_PT = 72 / 25.4;
const QR_MM = 22;
const MIN_TEXT_PT = 6.5;

export const CARD_SHEET = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  cardWidthMm: 85.6,
  cardHeightMm: 53.98,
  columns: 2 as const,
  markMm: 1.5,
  offsetMm: 0.35,
  minMarginMm: 5,
} as const;

export const CARD_SHEET_GUTTER_MM = 2 * (CARD_SHEET.offsetMm + CARD_SHEET.markMm);

export interface CardSheetLayout {
  columns: 2;
  rows: 4 | 5;
  cardsPerPage: 8 | 10;
  gutterMm: number;
  marginXMm: number;
  marginYMm: number;
  markMm: number;
  offsetMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
  pageWidthMm: number;
  pageHeightMm: number;
}

export interface CutMarkSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type CardPdfResult =
  | {
      ok: true;
      bytes: Uint8Array;
      pageCount: number;
      cardCount: number;
      cardsPerPage: 8 | 10;
      classCode: string;
    }
  | { ok: false; message: string };

interface PrintableCard {
  holderTitle: string;
  displayName: string;
  schoolName: string | null;
  classLabel: string | null;
  studentCode: string | null;
  png: Uint8Array;
}

interface ValidatedDocument {
  classCode: string;
  cards: PrintableCard[];
}

export function cardPdfOptionalLine(value: string | null): string | null {
  const text = typeof value === "string" ? value.normalize("NFC").trim() : "";
  if (!text || (SCREEN_PLACEHOLDERS as readonly string[]).includes(text)) return null;
  return text;
}

export function cardPdfNameSizeMm(displayName: string): number {
  const length = Array.from(displayName.trim()).length;
  if (length <= 22) return 3.7;
  if (length <= 34) return 3.05;
  if (length <= 48) return 2.7;
  return 2.35;
}

export function suggestedCardPdfName(classCode: string): string {
  const safe = classCode.replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 48);
  return `cartes-a4-${safe || "classe"}.pdf`;
}

export function chooseCardSheetLayout(limits: { minMarginMm?: number } = {}): CardSheetLayout | null {
  const minMarginMm = limits.minMarginMm ?? CARD_SHEET.minMarginMm;
  return measureSheet(5, minMarginMm) ?? measureSheet(4, minMarginMm);
}

export function cardRectMm(layout: CardSheetLayout, slot: number): { x: number; y: number; width: number; height: number } {
  const column = slot % layout.columns;
  const row = Math.floor(slot / layout.columns);
  return {
    x: layout.marginXMm + column * (layout.cardWidthMm + layout.gutterMm),
    y:
      layout.pageHeightMm -
      layout.marginYMm -
      (row + 1) * layout.cardHeightMm -
      row * layout.gutterMm,
    width: layout.cardWidthMm,
    height: layout.cardHeightMm,
  };
}

export function cardCutMarkSegments(
  x: number,
  y: number,
  width: number,
  height: number,
  offset: number,
  mark: number,
): CutMarkSegment[] {
  return [
    { x1: x - offset - mark, y1: y, x2: x - offset, y2: y },
    { x1: x, y1: y - offset - mark, x2: x, y2: y - offset },
    { x1: x + width + offset, y1: y, x2: x + width + offset + mark, y2: y },
    { x1: x + width, y1: y - offset - mark, x2: x + width, y2: y - offset },
    { x1: x - offset - mark, y1: y + height, x2: x - offset, y2: y + height },
    { x1: x, y1: y + height + offset, x2: x, y2: y + height + offset + mark },
    { x1: x + width + offset, y1: y + height, x2: x + width + offset + mark, y2: y + height },
    { x1: x + width, y1: y + height + offset, x2: x + width, y2: y + height + offset + mark },
  ];
}

function fail(message: string): CardPdfResult {
  return { ok: false, message };
}

function measureSheet(rows: 4 | 5, minMarginMm: number): CardSheetLayout | null {
  const { columns, cardWidthMm, cardHeightMm, pageWidthMm, pageHeightMm, markMm, offsetMm } = CARD_SHEET;
  const gutterMm = CARD_SHEET_GUTTER_MM;
  const gridWidth = columns * cardWidthMm + (columns - 1) * gutterMm;
  const gridHeight = rows * cardHeightMm + (rows - 1) * gutterMm;
  const marginXMm = (pageWidthMm - gridWidth) / 2;
  const marginYMm = (pageHeightMm - gridHeight) / 2;
  if (marginXMm < minMarginMm || marginYMm < minMarginMm) return null;
  return {
    columns,
    rows,
    cardsPerPage: rows === 5 ? 10 : 8,
    gutterMm,
    marginXMm,
    marginYMm,
    markMm,
    offsetMm,
    cardWidthMm,
    cardHeightMm,
    pageWidthMm,
    pageHeightMm,
  };
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
  if (typeof source !== "string" || source.length === 0 || source.length > MAX_SOURCE_CHARS) {
    return fail(CARD_PDF_UNRECOGNIZED);
  }
  const validated = validateSource(source);
  if (!validated.accepted) return validated.failure;
  const images = extractPngDataUrls(source);
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
      png,
    });
  }
  return drawPdf({ classCode: validated.classCode, cards: printable });
}

interface ParsedCard {
  cardToken: string;
  holderTitle: string;
  displayName: string;
  schoolName: string | null;
  classLabel: string | null;
  studentCode: string | null;
}

function validateSource(
  source: string,
): { accepted: true; classCode: string; cards: ParsedCard[] } | { accepted: false; failure: CardPdfResult } {
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
  if (!isRecord(parsed) || parsed.format !== CARD_PDF_PRINT_FORMAT) {
    return { accepted: false, failure: fail(CARD_PDF_UNRECOGNIZED) };
  }
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

  const publicIds = new Set<string>();
  const tokens = new Set<string>();
  const studentIds = new Set<string>();
  const cards: ParsedCard[] = [];
  for (const entry of parsed.cards) {
    const card = readCard(entry, publicIds, tokens, studentIds);
    if (!card) return { accepted: false, failure: fail(CARD_PDF_INCOMPLETE) };
    cards.push(card);
  }
  return { accepted: true, classCode: parsed.classCode, cards };
}

function readCard(
  entry: unknown,
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
  studentIds.add(studentId);
  publicIds.add(publicId);
  tokens.add(cardToken);
  return { cardToken, holderTitle, displayName: name, schoolName: school, classLabel: classLine, studentCode: matricule };
}

function extractPngDataUrls(source: string): string[] {
  const found: string[] = [];
  const pattern = /<img\b[^>]*\bsrc="(data:image\/png;base64,[A-Za-z0-9+/=\s]+)"/g;
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

async function drawPdf(document: ValidatedDocument): Promise<CardPdfResult> {
  const layout = chooseCardSheetLayout();
  if (!layout) return fail(CARD_PDF_INCOMPLETE);
  try {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const images: Awaited<ReturnType<PDFDocument["embedPng"]>>[] = [];
    for (const card of document.cards) {
      images.push(await pdf.embedPng(card.png));
    }
    const pageWidth = layout.pageWidthMm * MM_TO_PT;
    const pageHeight = layout.pageHeightMm * MM_TO_PT;
    const pageCount = Math.ceil(document.cards.length / layout.cardsPerPage);
    const pages: PDFPage[] = [];
    for (let index = 0; index < pageCount; index += 1) pages.push(pdf.addPage([pageWidth, pageHeight]));
    document.cards.forEach((card, index) => {
      const page = pages[Math.floor(index / layout.cardsPerPage)];
      const rect = cardRectMm(layout, index % layout.cardsPerPage);
      drawCard(page, rect, card, images[index], regular, bold);
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
    };
  } catch {
    return fail(CARD_PDF_INCOMPLETE);
  }
}

function drawCutMarks(
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  layout: CardSheetLayout,
) {
  const color = rgb(0.45, 0.45, 0.45);
  for (const segment of cardCutMarkSegments(rect.x, rect.y, rect.width, rect.height, layout.offsetMm, layout.markMm)) {
    page.drawLine({
      start: { x: segment.x1 * MM_TO_PT, y: segment.y1 * MM_TO_PT },
      end: { x: segment.x2 * MM_TO_PT, y: segment.y2 * MM_TO_PT },
      thickness: 0.4,
      color,
    });
  }
}

function drawCard(
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  card: PrintableCard,
  image: Awaited<ReturnType<PDFDocument["embedPng"]>>,
  regular: PDFFont,
  bold: PDFFont,
) {
  const x = rect.x * MM_TO_PT;
  const y = rect.y * MM_TO_PT;
  const width = rect.width * MM_TO_PT;
  const height = rect.height * MM_TO_PT;
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderWidth: 0.2 * MM_TO_PT,
    borderColor: rgb(0.1, 0.1, 0.1),
  });
  const qr = QR_MM * MM_TO_PT;
  const pad = 3 * MM_TO_PT;
  page.drawImage(image, {
    x: x + width - pad - qr,
    y: y + (height - qr) / 2,
    width: qr,
    height: qr,
  });
  const textWidth = width - pad * 2 - qr - 2 * MM_TO_PT;
  let cursor = y + height - 2.6 * MM_TO_PT;
  const bottom = y + 2.2 * MM_TO_PT;
  const drawLines = (text: string, font: PDFFont, size: number) => {
    for (const line of wrapText(text, font, size, textWidth)) {
      if (cursor - size < bottom) return;
      page.drawText(line, { x: x + pad, y: cursor - size, size, font, color: rgb(0.08, 0.08, 0.08) });
      cursor -= size * 1.2;
    }
  };
  drawLines(card.holderTitle, regular, 2.5 * MM_TO_PT);
  cursor -= 0.6 * MM_TO_PT;
  drawLines(card.displayName, bold, Math.max(cardPdfNameSizeMm(card.displayName) * MM_TO_PT, MIN_TEXT_PT));
  if (card.schoolName) drawLines(card.schoolName, regular, 2.4 * MM_TO_PT);
  if (card.classLabel) drawLines(card.classLabel, regular, 2.45 * MM_TO_PT);
  if (card.studentCode) drawLines(`Matricule ${card.studentCode}`, regular, 2.35 * MM_TO_PT);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const pieces = font.widthOfTextAtSize(word, size) <= maxWidth ? [word] : breakWord(word, font, size, maxWidth);
    for (const piece of pieces) {
      const next = current ? `${current} ${piece}` : piece;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
      else {
        if (current) lines.push(current);
        current = piece;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

function breakWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const parts: string[] = [];
  let chunk = "";
  for (const char of Array.from(word)) {
    const next = chunk + char;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || chunk.length === 0) chunk = next;
    else {
      parts.push(chunk);
      chunk = char;
    }
  }
  if (chunk) parts.push(chunk);
  return parts;
}
