import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import jsQR from "jsqr";
import { CARD_BATCH_PRINT_FORMAT, assembleBatchPrintDocument, convertBatchPrintDocument } from "./studentCardBatchPrintable";
import { renderStudentCardQrDataUrl } from "./studentCardQr";
import { STUDENT_CARD_HOLDER_TITLES, studentCardNameStep, studentCardOptionalText } from "./studentCardPolicy";
import {
  CARD_PDF_INCOMPLETE,
  CARD_PDF_PRINT_FORMAT,
  CARD_PDF_QR_MISMATCH,
  CARD_PDF_UNRECOGNIZED,
  CARD_SHEET,
  CARD_SHEET_GUTTER_MM,
  cardCutMarkSegments,
  cardPdfNameSizeMm,
  cardPdfOptionalLine,
  cardRectMm,
  chooseCardSheetLayout,
  convertBatchPrintFileToPdf,
  decodeCardPngRgba,
  suggestedCardPdfName,
  type CardSheetLayout,
} from "./studentCardBatchPdf";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const MM_TO_PT = 72 / 25.4;

interface FixtureSecret {
  studentId: string;
  publicId: string;
  cardToken: string;
  secret: string;
}

const cache = new Map<string, Promise<{ html: string; secrets: FixtureSecret[] }>>();

function matches(actual: string | null, expected: string): boolean {
  if (actual == null || actual.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

function hidden(value: string, secret: string): boolean {
  return !value.includes(secret);
}

async function buildHtml(count: number, bare: boolean) {
  const secrets: FixtureSecret[] = [];
  const identities = [];
  const qrs = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    const publicId = `pub${String(index).padStart(8, "0")}`;
    const secret = `secretxvalue${String(index).padStart(4, "0")}`;
    const cardToken = `${publicId}.${secret}`;
    const studentId = `stu${String(index).padStart(8, "0")}`;
    secrets.push({ studentId, publicId, cardToken, secret });
    identities.push({
      studentId,
      holderKind: index % 2 === 0 ? ("eleve" as const) : ("etudiant" as const),
      displayName: index === 0 && !bare ? "Awa DIOP" : `Titulaire ${index}`,
      studentCode: bare ? null : `MAT-${index}`,
      classLabel: bare ? null : "6ème A",
      schoolName: bare ? null : "Institut Nuru",
    });
    qrs.set(publicId, await renderStudentCardQrDataUrl(cardToken));
  }
  const assembled = assembleBatchPrintDocument(
    { batchId: BATCH_ID, classCode: "CLS-1", className: bare ? null : "6ème A", expiresAt: null },
    secrets,
    identities,
  );
  if (!assembled.ok) throw new Error("document CR80 indisponible");
  const html = convertBatchPrintDocument(assembled.value, qrs);
  if (!html.ok) throw new Error("document CR80 indisponible");
  return { html: html.value, secrets };
}

function htmlFor(count: number, bare = false) {
  const key = `${count}:${bare}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = buildHtml(count, bare);
  cache.set(key, pending);
  return pending;
}

function replaceScript(html: string, mutate: (parsed: Record<string, unknown>) => void): string {
  const match = html.match(/<script type="application\/json" id="somafrik-card-batch-source">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("source absente");
  const parsed = JSON.parse(match[1]) as Record<string, unknown>;
  mutate(parsed);
  const json = JSON.stringify(parsed).replace(/</g, "\\u003c");
  return html.replace(match[0], `<script type="application/json" id="somafrik-card-batch-source">${json}</script>`);
}

async function contentOf(pdf: PDFDocument, pageIndex: number): Promise<string> {
  const contents = pdf.getPage(pageIndex).node.Contents();
  if (!contents) return "";
  const entries = contents instanceof PDFArray ? contents.asArray() : [contents];
  let text = "";
  for (const entry of entries) {
    const stream = entry instanceof PDFRawStream ? entry : pdf.context.lookup(entry);
    if (stream instanceof PDFRawStream) {
      text += new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
    }
  }
  return text;
}

function rgbImages(pdf: PDFDocument) {
  const images: { width: number; height: number; rgb: Uint8Array }[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const subtype = object.dict.get(PDFName.of("Subtype"))?.toString();
    const color = object.dict.get(PDFName.of("ColorSpace"))?.toString();
    if (subtype !== "/Image" || color !== "/DeviceRGB") continue;
    const width = object.dict.lookup(PDFName.of("Width"));
    const height = object.dict.lookup(PDFName.of("Height"));
    if (!(width instanceof PDFNumber) || !(height instanceof PDFNumber)) continue;
    images.push({
      width: width.asNumber(),
      height: height.asNumber(),
      rgb: decodePDFRawStream(object).decode(),
    });
  }
  return images;
}

function checksum(bytes: Uint8Array): number {
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sourceRgb(rgba: Uint8ClampedArray): Uint8Array {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let index = 0, target = 0; index < rgba.length; index += 4, target += 3) {
    rgb[target] = rgba[index];
    rgb[target + 1] = rgba[index + 1];
    rgb[target + 2] = rgba[index + 2];
  }
  return rgb;
}

function qrFromRgb(rgb: Uint8Array, width: number, height: number): string | null {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0, target = 0; index < rgb.length; index += 3, target += 4) {
    rgba[target] = rgb[index];
    rgba[target + 1] = rgb[index + 1];
    rgba[target + 2] = rgb[index + 2];
    rgba[target + 3] = 255;
  }
  return jsQR(rgba, width, height, { inversionAttempts: "dontInvert" })?.data ?? null;
}

function matrices(content: string): number[][] {
  const found: number[][] = [];
  const pattern = /([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+cm/g;
  for (const match of content.matchAll(pattern)) {
    found.push(match.slice(1, 7).map(Number));
  }
  return found;
}

function segmentLengths(content: string): number[] {
  const tokens = content.split(/\s+/);
  const lengths: number[] = [];
  let x = 0;
  let y = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== "m" && tokens[index] !== "l") continue;
    const nextX = Number(tokens[index - 2]);
    const nextY = Number(tokens[index - 1]);
    if (tokens[index] === "l" && Number.isFinite(nextX) && Number.isFinite(nextY)) {
      lengths.push(Math.hypot(nextX - x, nextY - y));
    }
    if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
      x = nextX;
      y = nextY;
    }
  }
  return lengths;
}

function closeTo(value: number, expected: number): boolean {
  return Math.abs(value - expected) < 0.05;
}

function countClose(values: number[], expected: number): number {
  return values.filter((value) => closeTo(value, expected)).length;
}

function pdfText(content: string): string {
  const parts: string[] = [];
  const literal = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  const hex = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
  for (const match of content.matchAll(literal)) {
    parts.push(decodePdfLiteral(match[0].replace(/\s*Tj$/, "")));
  }
  for (const match of content.matchAll(hex)) {
    const bytes = match[1].replace(/\s/g, "");
    const raw = new Uint8Array(bytes.length / 2);
    for (let index = 0; index < raw.length; index += 1) raw[index] = Number.parseInt(bytes.slice(index * 2, index * 2 + 2), 16);
    parts.push(new TextDecoder("windows-1252").decode(raw));
  }
  return parts.join("\n");
}

function decodePdfLiteral(token: string): string {
  const body = token.slice(1, -1);
  let text = "";
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== "\\") {
      text += body[index];
      continue;
    }
    const next = body[index + 1];
    if (next === "n") text += "\n";
    else if (next === "r") text += "\r";
    else if (next === "t") text += "\t";
    else if (next && /[0-7]/.test(next)) {
      const octal = body.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] ?? next;
      text += String.fromCharCode(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    } else text += next ?? "";
    index += 1;
  }
  return text;
}

function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
}

describe("mise en page A4", () => {
  it("choisit 10 cartes tant que les marges et les repères tiennent, sinon 8", () => {
    const layout = chooseCardSheetLayout();
    expect(layout?.cardsPerPage).toBe(10);
    expect(layout?.rows).toBe(5);
    expect(layout!.marginXMm).toBeGreaterThanOrEqual(CARD_SHEET.minMarginMm);
    expect(layout!.marginYMm).toBeGreaterThanOrEqual(CARD_SHEET.minMarginMm);
    expect(layout!.marginYMm).toBeLessThan(8);
    expect(layout!.gutterMm).toBe(CARD_SHEET_GUTTER_MM);
    expect(layout!.gutterMm).toBeGreaterThanOrEqual(2 * (layout!.offsetMm + layout!.markMm));
    expect(chooseCardSheetLayout({ minMarginMm: 7 })?.cardsPerPage).toBe(8);
    expect(chooseCardSheetLayout({ minMarginMm: 40 })).toBeNull();
  });

  it("laisse les repères hors des cartes, sans collision entre cartes voisines", () => {
    const layout = chooseCardSheetLayout() as CardSheetLayout;
    const first = cardRectMm(layout, 0);
    const right = cardRectMm(layout, 1);
    const below = cardRectMm(layout, 2);
    const firstMarks = cardCutMarkSegments(first.x, first.y, first.width, first.height, layout.offsetMm, layout.markMm);
    const rightMarks = cardCutMarkSegments(right.x, right.y, right.width, right.height, layout.offsetMm, layout.markMm);
    const belowMarks = cardCutMarkSegments(below.x, below.y, below.width, below.height, layout.offsetMm, layout.markMm);
    for (const segment of firstMarks) {
      const samples = [0, 0.5, 1];
      for (const sample of samples) {
        const x = segment.x1 + (segment.x2 - segment.x1) * sample;
        const y = segment.y1 + (segment.y2 - segment.y1) * sample;
        const inside = x > first.x && x < first.x + first.width && y > first.y && y < first.y + first.height;
        expect(inside).toBe(false);
      }
    }
    for (const leftMark of firstMarks) {
      for (const rightMark of rightMarks) {
        const sameAxis = leftMark.y1 === leftMark.y2 && rightMark.y1 === rightMark.y2 && leftMark.y1 === rightMark.y1;
        if (!sameAxis) continue;
        expect(overlap(leftMark.x1, leftMark.x2, rightMark.x1, rightMark.x2)).toBeLessThanOrEqual(1e-6);
      }
      for (const lowerMark of belowMarks) {
        const sameAxis = leftMark.x1 === leftMark.x2 && lowerMark.x1 === lowerMark.x2 && leftMark.x1 === lowerMark.x1;
        if (!sameAxis) continue;
        expect(overlap(leftMark.y1, leftMark.y2, lowerMark.y1, lowerMark.y2)).toBeLessThanOrEqual(1e-6);
      }
    }
  });
});

describe("conversion PDF du document CR80", () => {
  it("reprend les libellés déjà figés pour la carte", () => {
    expect(CARD_PDF_PRINT_FORMAT).toBe(CARD_BATCH_PRINT_FORMAT);
    expect(cardPdfNameSizeMm("Awa DIOP")).toBe(3.7);
    expect(studentCardNameStep("Awa DIOP")).toBe("l1");
    expect(cardPdfNameSizeMm("A".repeat(23))).toBe(3.05);
    expect(studentCardNameStep("A".repeat(23))).toBe("l2");
    expect(cardPdfOptionalLine("Non renseigné")).toBe(studentCardOptionalText("Non renseigné"));
    expect(cardPdfOptionalLine("Institut Nuru")).toBe(studentCardOptionalText("Institut Nuru"));
    expect(STUDENT_CARD_HOLDER_TITLES.eleve).toBe("CARTE D’ÉLÈVE");
    expect(STUDENT_CARD_HOLDER_TITLES.etudiant).toBe("CARTE D’ÉTUDIANT");
  });

  it("importe un CR80 valide et vérifie le QR, les dimensions et l'absence de rotation", async () => {
    const fixture = await htmlFor(1);
    const secret = fixture.secrets[0].secret;
    const token = fixture.secrets[0].cardToken;
    const result = await convertBatchPrintFileToPdf(fixture.html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cardCount).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.cardsPerPage).toBe(10);
    expect(result.classCode).toBe("CLS-1");
    expect(suggestedCardPdfName(result.classCode)).toBe("cartes-a4-CLS-1.pdf");
    expect(hidden(new TextDecoder("latin1").decode(result.bytes), secret)).toBe(true);
    expect(hidden(new TextDecoder("latin1").decode(result.bytes), token)).toBe(true);

    const pdf = await PDFDocument.load(result.bytes);
    const size = pdf.getPage(0).getSize();
    expect(closeTo(size.width, 210 * MM_TO_PT)).toBe(true);
    expect(closeTo(size.height, 297 * MM_TO_PT)).toBe(true);
    const content = await contentOf(pdf, 0);
    const text = pdfText(content);
    expect(text.includes("Awa DIOP")).toBe(true);
    expect(text.includes("Institut Nuru")).toBe(true);
    expect(text.includes("6ème A")).toBe(true);
    expect(text.includes("Matricule MAT-0")).toBe(true);
    expect(text.includes("CARTE D’ÉLÈVE")).toBe(true);
    expect(hidden(text, secret)).toBe(true);

    const cardWidth = 85.6 * MM_TO_PT;
    const cardHeight = 53.98 * MM_TO_PT;
    const mark = 1.5 * MM_TO_PT;
    const qr = 22 * MM_TO_PT;
    const lengths = segmentLengths(content);
    expect(countClose(lengths, cardWidth)).toBe(1);
    expect(countClose(lengths, cardHeight)).toBe(2);
    expect(countClose(lengths, mark)).toBe(8);
    const transforms = matrices(content);
    expect(transforms.length).toBeGreaterThan(0);
    expect(transforms.every((matrix) => closeTo(matrix[1], 0) && closeTo(matrix[2], 0))).toBe(true);
    expect(transforms.some((matrix) => closeTo(matrix[0], qr) && closeTo(matrix[3], qr))).toBe(true);

    const dataUrl = fixture.html.match(/src="(data:image\/png;base64,[^"]+)"/)?.[1] ?? "";
    const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const source = await decodeCardPngRgba(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
    const images = rgbImages(pdf);
    expect(images).toHaveLength(1);
    expect(images[0].width).toBe(source?.width);
    expect(images[0].height).toBe(source?.height);
    expect(checksum(images[0].rgb)).toBe(checksum(sourceRgb(source?.rgba ?? new Uint8ClampedArray())));
    expect(matches(qrFromRgb(images[0].rgb, images[0].width, images[0].height), token)).toBe(true);
  }, 30000);

  it("masque l'établissement, la classe et le matricule quand ils sont absents", async () => {
    const fixture = await htmlFor(1, true);
    const result = await convertBatchPrintFileToPdf(fixture.html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pdf = await PDFDocument.load(result.bytes);
    const text = pdfText(await contentOf(pdf, 0));
    expect(text.includes("Titulaire 0")).toBe(true);
    expect(text.includes("Institut Nuru")).toBe(false);
    expect(text.includes("Matricule")).toBe(false);
    expect(text.includes("6ème A")).toBe(false);
  }, 30000);

  it("répartit 1, 8, 10, 11 et 25 cartes sans nouvelle page inutile", async () => {
    const cases = [
      [1, 1, [1]],
      [8, 1, [8]],
      [10, 1, [10]],
      [11, 2, [10, 1]],
      [25, 3, [10, 10, 5]],
    ] as const;
    for (const [count, pages, distribution] of cases) {
      const fixture = await htmlFor(count);
      const result = await convertBatchPrintFileToPdf(fixture.html);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.pageCount).toBe(pages);
      expect(result.cardCount).toBe(count);
      const pdf = await PDFDocument.load(result.bytes);
      expect(pdf.getPageCount()).toBe(pages);
      const images = rgbImages(pdf);
      expect(images).toHaveLength(count);
      for (let page = 0; page < pages; page += 1) {
        const content = await contentOf(pdf, page);
        const drawn = content.match(/\/\S+\s+Do/g) ?? [];
        expect(drawn).toHaveLength(distribution[page]);
        const size = pdf.getPage(page).getSize();
        expect(closeTo(size.width, 210 * MM_TO_PT)).toBe(true);
        expect(closeTo(size.height, 297 * MM_TO_PT)).toBe(true);
      }
      for (let index = 0; index < count; index += 1) {
        const payload = qrFromRgb(images[index].rgb, images[index].width, images[index].height);
        expect(matches(payload, fixture.secrets[index].cardToken)).toBe(true);
        expect(hidden(new TextDecoder("latin1").decode(result.bytes), fixture.secrets[index].secret)).toBe(true);
      }
    }
  }, 60000);

  it("refuse un fichier incompatible, altéré ou dont le QR ne correspond pas", async () => {
    const fixture = await htmlFor(1);
    const secret = fixture.secrets[0].secret;
    const token = fixture.secrets[0].cardToken;
    const publicId = fixture.secrets[0].publicId;
    const rejected = [
      await convertBatchPrintFileToPdf(`Jeton: ${token}`),
      await convertBatchPrintFileToPdf(fixture.html.replace(CARD_PDF_PRINT_FORMAT, "somafrik-card-batch-print-v0")),
      await convertBatchPrintFileToPdf(fixture.html.replace("</script>", "")),
      await convertBatchPrintFileToPdf(replaceScript(fixture.html, (parsed) => {
        const cards = parsed.cards as Record<string, unknown>[];
        cards[0].holderKind = "autre";
      })),
      await convertBatchPrintFileToPdf(replaceScript(fixture.html, (parsed) => {
        const cards = parsed.cards as Record<string, unknown>[];
        cards[0].holderTitle = "CARTE ELEVE";
      })),
      await convertBatchPrintFileToPdf(""),
    ];
    for (const result of rejected) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.message === CARD_PDF_UNRECOGNIZED || result.message === CARD_PDF_INCOMPLETE).toBe(true);
      expect(hidden(result.message, secret)).toBe(true);
      expect(hidden(result.message, token)).toBe(true);
      expect(hidden(result.message, publicId)).toBe(true);
    }

    const mismatched = await convertBatchPrintFileToPdf(replaceScript(fixture.html, (parsed) => {
      const cards = parsed.cards as Record<string, unknown>[];
      cards[0].cardToken = `${publicId}.secretxvalue9999`;
    }));
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) {
      expect(mismatched.message).toBe(CARD_PDF_QR_MISMATCH);
      expect(hidden(mismatched.message, secret)).toBe(true);
      expect(hidden(mismatched.message, "secretxvalue9999")).toBe(true);
    }

    const swapped = fixture.html.replace("data:image/png;base64,", "data:image/png;base64,AAAA");
    const broken = await convertBatchPrintFileToPdf(swapped);
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.message === CARD_PDF_INCOMPLETE || broken.message === CARD_PDF_QR_MISMATCH).toBe(true);
      expect(hidden(broken.message, secret)).toBe(true);
    }
  }, 30000);

  it("ne contacte aucun serveur et ne journalise pas les jetons", async () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/studentCardBatchPdf.ts"), "utf8");
    const dialog = readFileSync(resolve(process.cwd(), "src/components/students/StudentCardBatchPdfDialog.tsx"), "utf8");
    const fetchMock = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchMock);
    const fixture = await htmlFor(1);
    const result = await convertBatchPrintFileToPdf(fixture.html);
    expect(result.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();

    const product = `${source}\n${dialog}`;
    expect(/studentCardBatchApi|api\/client|localStorage|sessionStorage|indexedDB|console\.log|fetch\(/.test(product)).toBe(false);
    expect(product.includes("85.6")).toBe(true);
    expect(product.includes("53.98")).toBe(true);
    expect(source.includes(CARD_PDF_PRINT_FORMAT)).toBe(true);
  }, 30000);
});
