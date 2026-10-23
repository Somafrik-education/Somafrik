import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import QRCode from "qrcode";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StudentCardFace, type StudentCardFaceProps } from "./StudentCardFace";
import { STUDENT_CARD_QR_OPTIONS, STUDENT_CARD_QR_QUIET_ZONE_MODULES } from "../../lib/studentCardQr";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "index.css"), "utf8");

const LONG_NAME = "Mukendi Kabongo Ngalula Marie-Josée Tshibanda Wa Kalombo Ilunga";
const LONG_CODE = "CD-KIN-UN-2026-000018734-B";
const LONG_CLASS = "Licence 2 — Informatique de gestion et réseaux, option systèmes";
const LONG_SCHOOL = "Institut supérieur de gestion et de commerce de Kinshasa-Gombe";

function props(overrides: Partial<StudentCardFaceProps> = {}): StudentCardFaceProps {
  return {
    holderTitle: "CARTE D’ÉLÈVE",
    identity: {
      displayName: "Kabila Amina",
      classLabel: "6ème A",
      studentCode: "CD-001",
      schoolName: "Lycée Test",
      photoUrl: null,
    },
    cardRef: "ABCDEF",
    logoSrc: null,
    qr: { kind: "ready", src: "data:image/png;base64,QR" },
    ...overrides,
  };
}

/** Bloc CSS de la carte (hors règles d'impression globales). */
function cardCss(): string {
  return css.slice(css.indexOf("CARTE-UI-01 — recto de la carte"), css.indexOf("@page student-card-cr80"));
}

describe("StudentCardFace — CARTE-UI-01", () => {
  it("identités longues : nom, matricule, classe et établissement intégraux, sans troncature", () => {
    render(
      <StudentCardFace
        {...props({
          holderTitle: "CARTE D’ÉTUDIANT",
          identity: { displayName: LONG_NAME, classLabel: LONG_CLASS, studentCode: LONG_CODE, schoolName: LONG_SCHOOL, photoUrl: null },
        })}
      />,
    );
    expect(screen.getByTestId("student-card-name").textContent).toBe(LONG_NAME);
    expect(screen.getByTestId("student-card-code").textContent).toBe(LONG_CODE);
    expect(screen.getByTestId("student-card-class").textContent).toBe(LONG_CLASS);
    expect(screen.getByText(LONG_SCHOOL)).toBeInTheDocument();
    // Paliers typographiques au lieu de points de suspension.
    expect(screen.getByTestId("student-card-name")).toHaveClass("scf-name-l4");
    expect(screen.getByTestId("student-card-code")).toHaveClass("scf-value-l2");
    const sheet = screen.getByTestId("student-card-sheet");
    expect(sheet.innerHTML).not.toMatch(/truncate|text-ellipsis|line-clamp/);
    expect(sheet.textContent).not.toContain("...");
  });

  it("CSS de la carte : aucune troncature, retour à la ligne, texte ≥ 6,5 pt, dimensions physiques", () => {
    const block = cardCss();
    expect(block).not.toMatch(/text-overflow|ellipsis|line-clamp/);
    expect(block).toMatch(/\.scf-name \{[^}]*overflow-wrap: anywhere/);
    expect(block).toMatch(/\.scf-value \{[^}]*overflow-wrap: anywhere/);
    expect(block).toMatch(/\.scf-school \{[^}]*overflow-wrap: anywhere/);
    const sizes = [...block.matchAll(/font-size: ([\d.]+)mm/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(8);
    // 6,5 pt = 2,293 mm.
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(2.29);
    expect(block).toMatch(/\.scf-band \{[^}]*height: 13mm/);
    expect(block).toMatch(/\.scf-qr \{[^}]*width: 23mm;[^}]*height: 23mm/);
    expect(block).toMatch(/"Somafrik Card Inter"/);
    // Marges de sécurité : aucun texte à moins de 3 mm des bords gauche/droit.
    expect(block).toMatch(/\.scf-body \{[^}]*left: 3\.5mm;[^}]*right: 3\.5mm/);
    expect(block).toMatch(/\.scf-band \{[^}]*padding: 0 3mm/);
    expect(block).toMatch(/\.scf-foot \{[^}]*padding: 0 3\.5mm/);
  });

  it("impression : page CR80 sans marge, A4 à taille réelle, aucune mise à l'échelle", () => {
    expect(css).toMatch(/@page student-card-cr80 \{\s*size: 85\.6mm 53\.98mm;\s*margin: 0;/);
    expect(css).toMatch(/@page student-card-a4 \{\s*size: A4 portrait;/);
    expect(css).toMatch(/body\.somafrik-print-student-card \.student-card-preview \{\s*zoom: 1 !important;/);
    expect(css).toMatch(/\.student-card-sheet \{[^}]*width: 85\.6mm !important;[^}]*height: 53\.98mm !important;/);
    const printBlock = css.slice(css.indexOf("@page student-card-cr80"), css.indexOf("@media (prefers-reduced-motion"));
    expect(printBlock).not.toMatch(/scale\(|transform:/);
  });

  it("données facultatives absentes : lignes masquées, jamais de libellé de remplacement", () => {
    render(
      <StudentCardFace
        {...props({ identity: { displayName: "Awa Diallo", classLabel: null, studentCode: null, schoolName: null, photoUrl: null } })}
      />,
    );
    expect(screen.queryByTestId("student-card-class")).toBeNull();
    expect(screen.queryByTestId("student-card-code")).toBeNull();
    expect(screen.queryByText("Matricule")).toBeNull();
    expect(screen.queryByTestId("student-card-logo")).toBeNull();
    expect(screen.getByTestId("student-card-sheet").textContent).not.toMatch(/Non renseigné|Aucune inscription active|null|undefined/);
  });

  it("photo disponible, sinon initiales ; photo illisible : retour aux initiales", () => {
    const { rerender } = render(
      <StudentCardFace {...props({ identity: { ...props().identity, photoUrl: "https://exemple.test/photo.jpg" } })} />,
    );
    const photo = screen.getByTestId("student-card-photo");
    expect(photo).toHaveAttribute("src", "https://exemple.test/photo.jpg");
    expect(screen.queryByTestId("student-card-initials")).toBeNull();
    fireEvent.error(photo);
    expect(screen.queryByTestId("student-card-photo")).toBeNull();
    expect(screen.getByTestId("student-card-initials")).toHaveTextContent("KA");
    rerender(<StudentCardFace {...props()} />);
    expect(screen.getByTestId("student-card-initials")).toHaveTextContent("KA");
  });

  it("logo de l'établissement affiché s'il existe, masqué s'il est illisible ; mention Somafrik discrète", () => {
    render(<StudentCardFace {...props({ logoSrc: "/api/schools/CD-1/logo" })} />);
    const logo = screen.getByTestId("student-card-logo");
    expect(logo).toHaveAttribute("src", "/api/schools/CD-1/logo");
    fireEvent.error(logo);
    expect(screen.queryByTestId("student-card-logo")).toBeNull();
    expect(screen.getByText("Somafrik")).toHaveClass("scf-brand");
    expect(screen.getByTestId("student-card-ref")).toHaveTextContent("…ABCDEF");
  });

  it("aucune prop ne transporte le jeton : seule l'image du QR est reçue", () => {
    const keys = Object.keys(props()).sort();
    expect(keys).toEqual(["cardRef", "holderTitle", "identity", "logoSrc", "qr"]);
    expect(Object.keys(props().identity).sort()).toEqual(["classLabel", "displayName", "photoUrl", "schoolName", "studentCode"]);
    // @ts-expect-error — StudentCardFace n'accepte pas de cardToken.
    const withToken: StudentCardFaceProps = { ...props(), cardToken: "CARD-A.TOKEN-1" };
    void withToken;
    render(<StudentCardFace {...props()} />);
    expect(document.body.innerHTML).not.toMatch(/TOKEN|data-token|data-card-token/);
  });

  it("QR : zone de silence de 4 modules dans l'image et environ 19 mm de modules dans 23 mm", async () => {
    // Jeton au format de production (22 + 1 + 43 caractères base64url), fictif.
    const token = `${"A".repeat(22)}.${"b".repeat(43)}`;
    const { modules } = QRCode.create(token, { errorCorrectionLevel: STUDENT_CARD_QR_OPTIONS.errorCorrectionLevel });
    const svg = await QRCode.toString(token, { ...STUDENT_CARD_QR_OPTIONS, color: { ...STUDENT_CARD_QR_OPTIONS.color }, type: "svg" });
    const viewBox = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
    expect(STUDENT_CARD_QR_OPTIONS.margin).toBeGreaterThanOrEqual(STUDENT_CARD_QR_QUIET_ZONE_MODULES);
    expect(viewBox - modules.size).toBe(2 * STUDENT_CARD_QR_OPTIONS.margin);
    const dataAreaMm = (23 * modules.size) / viewBox;
    expect(dataAreaMm).toBeGreaterThanOrEqual(18.5);
    expect(dataAreaMm).toBeLessThanOrEqual(20);
    expect(STUDENT_CARD_QR_OPTIONS.errorCorrectionLevel).toBe("M");
    expect(STUDENT_CARD_QR_OPTIONS.color).toEqual({ dark: "#000000", light: "#ffffff" });
  });
});
