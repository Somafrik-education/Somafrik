import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { classStudentsApi, type ClassStudent } from "./classStudentsApi";
import { studentCardsApi } from "./studentCardsApi";
import { StudentCardFace } from "../components/students/StudentCardFace";
import {
  CARD_BATCH_PRINT_FORMAT,
  CARD_BATCH_PRINT_LEGACY_FORMAT,
  assembleBatchPrintDocument,
  convertBatchPrintDocument,
  loadBatchPrintIdentities,
  loadBatchPrintSchoolLogo,
  loadEmbeddedCardFontCss,
  readBatchPrintDocument,
  type BatchPrintIdentity,
} from "./studentCardBatchPrintable";
import { CARD_SHEET, cardRectMm, chooseCardSheetLayout, type CardVisual } from "./studentCardDesign";
import { TEST_PHOTO_JPEG_DATA_URL, testPngDataUrl } from "./studentCardTestImages";

vi.mock("./classStudentsApi", () => ({
  classStudentsApi: { list: vi.fn() },
}));

vi.mock("./studentCardsApi", () => ({
  studentCardsApi: { list: vi.fn() },
}));

const SECRET = "supersecretvalue";
const TOKEN = `pubidvalue.${SECRET}`;
const QR = "data:image/png;base64,AAAA";
const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const LOGO: CardVisual = { state: "embedded", src: testPngDataUrl(32, 32, [200, 30, 40]) };
const PHOTO: CardVisual = { state: "embedded", src: TEST_PHOTO_JPEG_DATA_URL };

const identity: BatchPrintIdentity = {
  studentId: "student-new",
  holderKind: "eleve",
  displayName: "Awa DIOP",
  studentCode: "MAT-1",
  classLabel: "6ème A",
  schoolName: "Institut Nuru",
};

function documentFor(identities: BatchPrintIdentity[] = [identity], schoolLogo?: CardVisual) {
  return assembleBatchPrintDocument(
    { batchId: BATCH_ID, classCode: "CLS-1", className: "6ème A", expiresAt: null, schoolLogo },
    [{ studentId: "student-new", publicId: "pubidvalue", cardToken: TOKEN, secret: SECRET }],
    identities,
  );
}

function visiblePart(html: string): string {
  return html.replace(/<script[\s\S]*<\/script>/, "");
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("conversion locale CR80", () => {
  it("produit un document relisible, à la taille CR80, sans nouvelle émission", () => {
    const assembled = documentFor();
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const printable = convertBatchPrintDocument(assembled.value, new Map([["pubidvalue", QR]]));
    expect(printable.ok).toBe(true);
    if (!printable.ok) return;
    expect(printable.value).toContain("85.60mm");
    expect(printable.value).toContain("53.98mm");
    expect(printable.value).toContain("CARTE D’ÉLÈVE");
    expect(printable.value).toContain("Awa DIOP");
    expect(visiblePart(printable.value)).not.toContain(SECRET);
    const restored = readBatchPrintDocument(printable.value);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.format).toBe(CARD_BATCH_PRINT_FORMAT);
    expect(restored.value.cards[0].cardToken).toBe(TOKEN);
    const again = convertBatchPrintDocument(restored.value, new Map([["pubidvalue", QR]]));
    expect(again.ok).toBe(true);
  });

  it("refuse un fichier de jetons et une identité incomplète", () => {
    expect(readBatchPrintDocument(`Jeton: ${TOKEN}`).ok).toBe(false);
    const withoutHolder: BatchPrintIdentity = { ...identity, holderKind: null };
    const withoutName: BatchPrintIdentity = { ...identity, displayName: null };
    expect(documentFor([withoutHolder]).ok).toBe(false);
    expect(documentFor([withoutName]).ok).toBe(false);
    const assembled = documentFor();
    if (!assembled.ok) throw new Error("document attendu");
    expect(convertBatchPrintDocument(assembled.value, new Map()).ok).toBe(false);
  });

  it("relie l'UUID du lot au matricule de la liste de classe", async () => {
    const studentUuid = "eeeeeeee-eeee-4eee-8eee-0000000000b1";
    const roster: ClassStudent & { studentUuid: string } = {
      id: "STU-WEB-CR80",
      publicId: "STU-WEB-CR80",
      studentCode: "STU-WEB-CR80",
      matricule: "STU-WEB-CR80",
      studentUuid,
      firstName: "Awa",
      lastName: "DIOP",
      name: "Awa DIOP",
      gender: "",
      birthDate: "",
      className: "Terminale A",
      classCode: "WEB-CR80",
      schoolCode: "CD-WEB-26-001",
      parentPhone: "",
      parentEmail: "",
      status: "active",
      enrollmentId: null,
      enrollmentDate: "",
      academicYearName: "2026-2027",
    };
    vi.mocked(classStudentsApi.list).mockResolvedValue([roster]);
    vi.mocked(studentCardsApi.list).mockResolvedValue({
      cards: [],
      holder: { kind: "eleve", source: "school_type" },
    });

    const identities = await loadBatchPrintIdentities({
      classCode: "WEB-CR80",
      schoolName: "Lycée Smoke CR80",
      className: "Terminale A",
      studentIds: [studentUuid],
    });

    expect(studentCardsApi.list).toHaveBeenCalledWith(studentUuid);
    expect(identities).toEqual([
      {
        studentId: studentUuid,
        holderKind: "eleve",
        displayName: "Awa DIOP",
        studentCode: "STU-WEB-CR80",
        classLabel: "Terminale A",
        schoolName: "Lycée Smoke CR80",
        photo: { state: "absent" },
      },
    ]);
  });
});

describe("CARTE-BATCH-DESIGN-01 — maquette P1 dans le document CR80", () => {
  it("rend chaque carte avec StudentCardFace, à l'identique de la carte individuelle", () => {
    const assembled = documentFor([{ ...identity, photo: PHOTO }], LOGO);
    if (!assembled.ok) throw new Error("document attendu");
    const printable = convertBatchPrintDocument(assembled.value, new Map([["pubidvalue", QR]]));
    if (!printable.ok) throw new Error("document attendu");
    const batchFace = parse(printable.value).querySelector(".student-card-face");
    expect(batchFace).not.toBeNull();

    const single = render(
      createElement(StudentCardFace, {
        holderTitle: "CARTE D’ÉLÈVE",
        identity: {
          displayName: "Awa DIOP",
          classLabel: "6ème A",
          studentCode: "MAT-1",
          schoolName: "Institut Nuru",
          photoUrl: PHOTO.state === "embedded" ? PHOTO.src : null,
        },
        cardRef: "dvalue",
        logoSrc: LOGO.state === "embedded" ? LOGO.src : null,
        qr: { kind: "ready", src: QR },
      }),
    );
    const singleFace = single.container.querySelector<HTMLElement>(".student-card-face")!;
    const batchElement = batchFace as HTMLElement;
    expect(batchElement.style.width).toBe(singleFace.style.width);
    expect(batchElement.style.height).toBe(singleFace.style.height);
    const withoutStyle = (element: Element) => {
      const copy = element.cloneNode(true) as Element;
      copy.removeAttribute("style");
      return copy.outerHTML;
    };
    expect(withoutStyle(batchElement)).toBe(withoutStyle(singleFace));
    single.unmount();

    // Éléments de la maquette : bandeau, logo, photo, identité, QR à droite, référence, pied.
    for (const selector of [".scf-band", ".scf-logo img", ".scf-photo img", ".scf-info", ".scf-qr img", ".scf-foot", ".scf-brand"]) {
      expect(batchFace!.querySelector(selector)).not.toBeNull();
    }
    const body = batchFace!.querySelector(".scf-body")!;
    expect([...body.children].map((child) => child.className)).toEqual(["scf-photo", "scf-info", "scf-qr"]);
    expect(batchFace!.querySelector('[data-testid="student-card-ref"]')?.textContent).toBe("…dvalue");
    expect(printable.value).toContain(".student-card-face .scf-band {");
  });

  it("imprime les initiales et laisse le logo vide quand ils manquent, sans rien inventer", () => {
    const assembled = documentFor([{ ...identity, photo: { state: "unavailable" } }], { state: "absent" });
    if (!assembled.ok) throw new Error("document attendu");
    const printable = convertBatchPrintDocument(assembled.value, new Map([["pubidvalue", QR]]));
    if (!printable.ok) throw new Error("document attendu");
    const face = parse(printable.value).querySelector(".student-card-face")!;
    expect(face.querySelector('[data-testid="student-card-initials"]')?.textContent).toBe("AD");
    expect(face.querySelector('[data-testid="student-card-photo"]')).toBeNull();
    expect(face.querySelector('[data-testid="student-card-logo"]')).toBeNull();
    expect(face.querySelectorAll("img")).toHaveLength(1);
  });

  it("transporte le logo et la photo dans la source v2, sans modifier les jetons", () => {
    const assembled = documentFor([{ ...identity, photo: PHOTO }], LOGO);
    if (!assembled.ok) throw new Error("document attendu");
    const printable = convertBatchPrintDocument(assembled.value, new Map([["pubidvalue", QR]]));
    if (!printable.ok) throw new Error("document attendu");
    const restored = readBatchPrintDocument(printable.value);
    if (!restored.ok) throw new Error("document attendu");
    expect(restored.value.schoolLogo).toEqual(LOGO);
    expect(restored.value.cards[0].photo).toEqual(PHOTO);
    expect(restored.value.cards[0].cardToken).toBe(TOKEN);
    expect(restored.value.cards[0].publicId).toBe("pubidvalue");
  });

  it("relit un document v1 : logo et photos marqués absents de la source, initiales imprimées", () => {
    const legacySource = {
      format: CARD_BATCH_PRINT_LEGACY_FORMAT,
      batchId: BATCH_ID,
      classCode: "CLS-1",
      className: "6ème A",
      expiresAt: null,
      cards: [
        {
          studentId: "student-new",
          publicId: "pubidvalue",
          cardToken: TOKEN,
          holderKind: "eleve",
          holderTitle: "CARTE D’ÉLÈVE",
          displayName: "Awa DIOP",
          studentCode: "MAT-1",
          classLabel: "6ème A",
          schoolName: "Institut Nuru",
        },
      ],
    };
    const legacyHtml = `<!DOCTYPE html><html><body><section class="grid"><article class="card"><img alt="QR de la carte" src="${QR}"></article></section><script type="application/json" id="somafrik-card-batch-source">${JSON.stringify(legacySource)}</script></body></html>`;
    const restored = readBatchPrintDocument(legacyHtml);
    if (!restored.ok) throw new Error("document v1 attendu");
    expect(restored.value.schoolLogo).toEqual({ state: "not_in_source" });
    expect(restored.value.cards[0].photo).toEqual({ state: "not_in_source" });
    expect(restored.value.cards[0].cardToken).toBe(TOKEN);
    const reprinted = convertBatchPrintDocument(restored.value, new Map([["pubidvalue", QR]]));
    if (!reprinted.ok) throw new Error("réimpression attendue");
    const face = parse(reprinted.value).querySelector(".student-card-face")!;
    expect(face.querySelector('[data-testid="student-card-initials"]')?.textContent).toBe("AD");
    expect(face.querySelector('[data-testid="student-card-logo"]')).toBeNull();
  });

  it("refuse une image altérée dans la source", () => {
    const tampered: CardVisual = { state: "embedded", src: "data:image/png;base64,PHN2Zz48L3N2Zz4=" };
    expect(documentFor([{ ...identity, photo: tampered }]).ok).toBe(false);
    expect(documentFor([identity], tampered).ok).toBe(false);
    const assembled = documentFor([{ ...identity, photo: PHOTO }], LOGO);
    if (!assembled.ok) throw new Error("document attendu");
    const printable = convertBatchPrintDocument(assembled.value, new Map([["pubidvalue", QR]]));
    if (!printable.ok) throw new Error("document attendu");
    const svg = printable.value.replace(
      /"photo":\{"state":"embedded","src":"[^"]+"\}/,
      '"photo":{"state":"embedded","src":"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="}',
    );
    expect(readBatchPrintDocument(svg).ok).toBe(false);
  });

  it("dispose les cartes sur A4 comme le PDF : mêmes positions, mêmes repères de découpe", () => {
    const secrets = [];
    const identities: BatchPrintIdentity[] = [];
    const qrs = new Map<string, string>();
    for (let index = 0; index < 11; index += 1) {
      const publicId = `pubid${String(index).padStart(6, "0")}`;
      secrets.push({ studentId: `student${index}`, publicId, cardToken: `${publicId}.${SECRET}${index}`, secret: SECRET });
      identities.push({ ...identity, studentId: `student${index}` });
      qrs.set(publicId, QR);
    }
    const assembled = assembleBatchPrintDocument(
      { batchId: BATCH_ID, classCode: "CLS-1", className: "6ème A", expiresAt: null },
      secrets,
      identities,
    );
    if (!assembled.ok) throw new Error("document attendu");
    const printable = convertBatchPrintDocument(assembled.value, qrs);
    if (!printable.ok) throw new Error("document attendu");
    const doc = parse(printable.value);
    const pages = doc.querySelectorAll(".scb-page");
    expect(pages).toHaveLength(2);
    expect(pages[0].querySelectorAll(".scb-slot")).toHaveLength(10);
    expect(pages[1].querySelectorAll(".scb-slot")).toHaveLength(1);
    expect(pages[0].querySelectorAll(".scb-mark")).toHaveLength(80);
    const layout = chooseCardSheetLayout()!;
    const slot = pages[0].querySelectorAll<HTMLElement>(".scb-slot")[3];
    const rect = cardRectMm(layout, 3);
    expect(slot.style.left).toBe(`${Number(rect.x.toFixed(3))}mm`);
    expect(slot.style.top).toBe(`${Number((CARD_SHEET.pageHeightMm - rect.y - rect.height).toFixed(3))}mm`);
    expect(printable.value).toContain("@page { size: A4 portrait; margin: 0; }");
    expect(visiblePart(printable.value)).not.toContain(SECRET);
  });
});

describe("intégration du logo et de la police", () => {
  it("n'intègre aucun logo de remplacement quand l'établissement n'en a pas", async () => {
    const loadImage = vi.fn(async (): Promise<CardVisual> => LOGO);
    expect(await loadBatchPrintSchoolLogo(null, loadImage)).toEqual({ state: "absent" });
    expect(await loadBatchPrintSchoolLogo({ code: "CD-1", hasLogo: false }, loadImage)).toEqual({ state: "absent" });
    expect(loadImage).not.toHaveBeenCalled();
    const school = {
      code: "CD-1",
      hasLogo: true,
      logoSource: "school_upload",
      logoUploadedAt: "2026-10-01T10:00:00.000Z",
    };
    expect(await loadBatchPrintSchoolLogo(school, loadImage)).toEqual(LOGO);
    expect(loadImage).toHaveBeenCalledWith(expect.stringContaining("/api/schools/CD-1/logo"), "logo");
    const failing = vi.fn(async (): Promise<CardVisual> => {
      throw new Error("offline");
    });
    expect(await loadBatchPrintSchoolLogo(school, failing)).toEqual({ state: "unavailable" });
  });

  it("intègre la police de la carte, ou revient à la police de secours sans bloquer", async () => {
    const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]);
    const fetcher = vi.fn(async () => new Response(woff2)) as unknown as typeof fetch;
    const css = await loadEmbeddedCardFontCss(fetcher);
    expect(css).toContain('font-family:"Somafrik Card Inter"');
    expect(css).toContain("data:font/woff2;base64,");
    expect(css.match(/@font-face/g)).toHaveLength(8);
    const offline = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await loadEmbeddedCardFontCss(offline)).toBe("");
    const notFont = vi.fn(async () => new Response("<html>")) as unknown as typeof fetch;
    expect(await loadEmbeddedCardFontCss(notFont)).toBe("");
  });
});
