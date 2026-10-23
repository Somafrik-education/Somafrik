import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import jsQR from "jsqr";
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StudentCardFace } from "../components/students/StudentCardFace";
import {
  assembleBatchPrintDocument,
  convertBatchPrintDocument,
  type BatchPrintIdentity,
} from "./studentCardBatchPrintable";
import { convertBatchPrintFileToPdf } from "./studentCardBatchPdf";
import {
  STUDENT_CARD_P1,
  cardVisualReport,
  cardVisualReportMessage,
  studentCardFaceCss,
  type CardVisual,
} from "./studentCardDesign";
import { STUDENT_CARD_HOLDER_TITLES, studentCardInitials, studentCardRef } from "./studentCardPolicy";
import { renderStudentCardQrDataUrl } from "./studentCardQr";
import { testPngDataUrl } from "./studentCardTestImages";

/**
 * CARTE-BATCH-DESIGN-01 — les mêmes cartes dans les trois rendus : carte individuelle
 * (StudentCardFace), HTML CR80 par classe et PDF A4. Une seule référence de design.
 */

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const LOGO: CardVisual = { state: "embedded", src: testPngDataUrl(32, 32, [200, 30, 40]) };
const PHOTO: CardVisual = { state: "embedded", src: testPngDataUrl(40, 52, [214, 190, 160], [30, 60, 120]) };

interface Fixture {
  identity: BatchPrintIdentity;
  publicId: string;
  cardToken: string;
}

const FIXTURES: Fixture[] = [
  {
    identity: {
      studentId: "stu00000001",
      holderKind: "eleve",
      displayName: "Kabila Amina",
      studentCode: "CD-KIN-2026-1000",
      classLabel: "6ème A",
      schoolName: "Institut Nuru",
      photo: PHOTO,
    },
    publicId: "pubAB000001XY",
    cardToken: "pubAB000001XY.secretxvalue00000001",
  },
  {
    identity: {
      studentId: "stu00000002",
      holderKind: "etudiant",
      displayName: "Ilunga Grâce",
      studentCode: null,
      classLabel: "Licence 2",
      schoolName: "Institut Nuru",
      photo: { state: "absent" },
    },
    publicId: "pubAB000002XY",
    cardToken: "pubAB000002XY.secretxvalue00000002",
  },
];

async function buildThreeRenders() {
  const qrs = new Map<string, string>();
  for (const fixture of FIXTURES) qrs.set(fixture.publicId, await renderStudentCardQrDataUrl(fixture.cardToken));
  const assembled = assembleBatchPrintDocument(
    { batchId: BATCH_ID, classCode: "CLS-1", className: "6ème A", expiresAt: null, schoolLogo: LOGO },
    FIXTURES.map((fixture) => ({
      studentId: fixture.identity.studentId,
      publicId: fixture.publicId,
      cardToken: fixture.cardToken,
      secret: fixture.cardToken.split(".")[1],
    })),
    FIXTURES.map((fixture) => fixture.identity),
  );
  if (!assembled.ok) throw new Error("document attendu");
  const html = convertBatchPrintDocument(assembled.value, qrs);
  if (!html.ok) throw new Error("document attendu");
  const pdf = await convertBatchPrintFileToPdf(html.value);
  if (!pdf.ok) throw new Error(pdf.message);
  return { qrs, html: html.value, pdf };
}

async function pdfContent(bytes: Uint8Array): Promise<{ pdf: PDFDocument; content: string }> {
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPage(0).node.Contents();
  const entries = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  let content = "";
  for (const entry of entries) {
    const stream = entry instanceof PDFRawStream ? entry : pdf.context.lookup(entry);
    if (stream instanceof PDFRawStream) content += new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
  }
  return { pdf, content };
}

const WIN_ANSI: Record<number, string> = { 0x85: "…", 0x92: "’" };

function pdfStrings(content: string): string[] {
  return [...content.matchAll(/<([0-9A-Fa-f]+)> Tj/g)].map((match) => {
    const hex = match[1];
    let text = "";
    for (let index = 0; index < hex.length; index += 2) {
      const byte = Number.parseInt(hex.slice(index, index + 2), 16);
      text += WIN_ANSI[byte] ?? String.fromCharCode(byte);
    }
    return text;
  });
}

function pdfQrPayloads(pdf: PDFDocument): string[] {
  const payloads: string[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    if (object.dict.get(PDFName.of("ColorSpace"))?.toString() !== "/DeviceRGB") continue;
    const width = object.dict.lookup(PDFName.of("Width"));
    const height = object.dict.lookup(PDFName.of("Height"));
    if (!(width instanceof PDFNumber) || !(height instanceof PDFNumber) || width.asNumber() < 100) continue;
    const rgb = decodePDFRawStream(object).decode();
    const rgba = new Uint8ClampedArray(width.asNumber() * height.asNumber() * 4);
    for (let index = 0, target = 0; index < rgb.length; index += 3, target += 4) {
      rgba.set([rgb[index], rgb[index + 1], rgb[index + 2], 255], target);
    }
    const payload = jsQR(rgba, width.asNumber(), height.asNumber(), { inversionAttempts: "dontInvert" })?.data;
    if (payload) payloads.push(payload);
  }
  return payloads;
}

describe("CARTE-BATCH-DESIGN-01 — une seule référence de design", () => {
  it("le CSS de la carte est produit depuis les cotes de la maquette P1", () => {
    const css = studentCardFaceCss();
    const d = STUDENT_CARD_P1;
    expect(css).toMatch(new RegExp(`\\.scf-band \\{[^}]*height: ${d.band.heightMm}mm`));
    expect(css).toMatch(new RegExp(`\\.scf-photo \\{[^}]*width: ${d.photo.widthMm}mm;[^}]*height: ${d.photo.heightMm}mm`));
    expect(css).toMatch(new RegExp(`\\.scf-qr \\{[^}]*width: ${d.qr.sizeMm}mm;[^}]*height: ${d.qr.sizeMm}mm`));
    expect(css).toMatch(new RegExp(`\\.scf-foot \\{[^}]*height: ${d.foot.heightMm}mm`));
    expect(css).toContain(`--scf-navy: ${d.colors.navy}`);
    // Plus aucune copie de la mise en page dans la feuille globale.
    const globalCss = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(globalCss).not.toMatch(/\.student-card-face \.scf-band \{/);
    // Plus aucun gabarit simplifié dans le générateur par classe.
    const printable = readFileSync(resolve(process.cwd(), "src/lib/studentCardBatchPrintable.ts"), "utf8");
    expect(printable).not.toMatch(/<article class="card">|<h1>/);
    expect(printable).toMatch(/createElement\(StudentCardFace/);
  });

  it("carte individuelle, HTML CR80 et PDF A4 portent les mêmes éléments pour les mêmes cartes", async () => {
    const { qrs, html, pdf } = await buildThreeRenders();
    const batch = new DOMParser().parseFromString(html, "text/html");
    const batchFaces = [...batch.querySelectorAll(".student-card-face")];
    expect(batchFaces).toHaveLength(FIXTURES.length);
    const { pdf: pdfDoc, content } = await pdfContent(pdf.bytes);
    const pdfText = pdfStrings(content);
    const qrPayloads = pdfQrPayloads(pdfDoc);

    FIXTURES.forEach((fixture, index) => {
      const holderTitle = STUDENT_CARD_HOLDER_TITLES[fixture.identity.holderKind!];
      const photoSrc = fixture.identity.photo?.state === "embedded" ? fixture.identity.photo.src : null;
      const single = render(
        createElement(StudentCardFace, {
          holderTitle,
          identity: {
            displayName: fixture.identity.displayName!,
            classLabel: fixture.identity.classLabel,
            studentCode: fixture.identity.studentCode,
            schoolName: fixture.identity.schoolName,
            photoUrl: photoSrc,
          },
          cardRef: studentCardRef(fixture.publicId),
          logoSrc: LOGO.state === "embedded" ? LOGO.src : null,
          qr: { kind: "ready", src: qrs.get(fixture.publicId)! },
        }),
      );
      const singleFace = single.container.querySelector(".student-card-face")!;
      const batchFace = batchFaces[index];

      // 1 et 2 : même balisage, mêmes images (logo, photo ou initiales, QR).
      for (const face of [singleFace, batchFace]) {
        expect(face.querySelector('[data-testid="student-card-holder-title"]')?.textContent).toBe(holderTitle);
        expect(face.querySelector(".scf-school")?.textContent).toBe(fixture.identity.schoolName);
        expect(face.querySelector('[data-testid="student-card-name"]')?.textContent).toBe(fixture.identity.displayName);
        expect(face.querySelector('[data-testid="student-card-ref"]')?.textContent).toBe(`…${studentCardRef(fixture.publicId)}`);
        expect(face.querySelector(".scf-brand")?.textContent).toBe("Somafrik");
        expect(face.querySelector<HTMLImageElement>('[data-testid="student-card-logo"]')?.getAttribute("src")).toBe(
          LOGO.state === "embedded" ? LOGO.src : null,
        );
        expect(face.querySelector('[data-testid="student-card-qr"]')?.getAttribute("src")).toBe(qrs.get(fixture.publicId));
        if (photoSrc) {
          expect(face.querySelector('[data-testid="student-card-photo"]')?.getAttribute("src")).toBe(photoSrc);
        } else {
          expect(face.querySelector('[data-testid="student-card-initials"]')?.textContent).toBe(
            studentCardInitials(fixture.identity.displayName!),
          );
        }
      }
      expect(batchFace.querySelector(".scf-body")?.innerHTML).toBe(singleFace.querySelector(".scf-body")?.innerHTML);
      single.unmount();

      // 3 : le PDF porte les mêmes textes, les mêmes initiales et un QR qui relit le même jeton.
      expect(pdfText).toContain(holderTitle);
      expect(pdfText).toContain(fixture.identity.displayName);
      expect(pdfText).toContain(fixture.identity.classLabel);
      expect(pdfText).toContain(`…${studentCardRef(fixture.publicId)}`);
      if (fixture.identity.studentCode) expect(pdfText).toContain(fixture.identity.studentCode);
      if (!photoSrc) expect(pdfText).toContain(studentCardInitials(fixture.identity.displayName!));
      expect(qrPayloads).toContain(fixture.cardToken);
    });
    expect(pdfText.filter((text) => text === "Somafrik")).toHaveLength(FIXTURES.length);
    expect(pdfText.filter((text) => text === "MATRICULE")).toHaveLength(1);
    expect(pdf.visuals).toEqual({ logo: "embedded", photos: { embedded: 1, absent: 1, unavailable: 0, not_in_source: 0 } });
  }, 30000);

  it("explique à l'opérateur ce qui manque, sans annoncer de réémission", () => {
    expect(cardVisualReportMessage(cardVisualReport(LOGO, [PHOTO]))).toBeNull();
    expect(cardVisualReportMessage(cardVisualReport({ state: "absent" }, [{ state: "absent" }, { state: "unavailable" }]))).toBe(
      "Éléments visuels manquants — aucun logo d’établissement enregistré : emplacement laissé vide ; 1 élève sans photo : initiales imprimées ; 1 photo non intégrée : initiales imprimées.",
    );
    expect(cardVisualReportMessage(cardVisualReport({ state: "not_in_source" }, [{ state: "not_in_source" }]))).toContain(
      "Aucune carte n’est réémise ni remplacée",
    );
  });
});
