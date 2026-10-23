import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudentCardPrintView } from "./StudentCardPrintView";
import type { StudentCardHolder } from "../../lib/studentCardsApi";

const qrToDataUrl = vi.hoisted(() => vi.fn(async (value: string, options?: unknown) => {
  void options;
  return `data:image/png;base64,len-${value.length}`;
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: (value: string, options?: unknown) => qrToDataUrl(value, options) },
}));

const TOKEN = "CARD-A.TOKEN-1";

const identity = {
  displayName: "Kabila Amina",
  classLabel: "6ème A",
  studentCode: "CD-001",
  schoolName: "Lycée Test",
  photoUrl: null,
  publicId: "PUBLIC-ID-ABCDEF",
};

const school = {
  code: "CD-1",
  hasLogo: true,
  logoSource: "school_upload" as const,
  logoUploadedAt: "2026-10-01T00:00:00.000Z",
};

const ELEVE: StudentCardHolder = { kind: "eleve", source: "school_type" };
const ETUDIANT: StudentCardHolder = { kind: "etudiant", source: "school_setting" };

function renderCard(holder: StudentCardHolder | null = ELEVE, overrides: Partial<typeof identity> = {}) {
  return render(
    <StudentCardPrintView
      cardToken={TOKEN}
      holder={holder}
      identity={{ ...identity, ...overrides }}
      school={school}
      onClose={() => undefined}
    />,
  );
}

function expectSecretAbsent() {
  expect(document.body.textContent).not.toContain("TOKEN-1");
  expect(document.body.innerHTML).not.toContain(TOKEN);
  expect(document.body.innerHTML).not.toMatch(/data-(card-)?token/);
}

describe("StudentCardPrintView — CARTE-UI-01", () => {
  beforeEach(() => {
    qrToDataUrl.mockReset();
    qrToDataUrl.mockImplementation(async (value: string, options?: unknown) => {
      void options;
      return `data:image/png;base64,len-${value.length}`;
    });
  });
  afterEach(() => {
    document.body.className = "";
  });

  it("élève : en-tête CARTE D’ÉLÈVE, QR = exactement le cardToken, format CR80, aucun secret en clair", async () => {
    renderCard(ELEVE);
    const sheet = await screen.findByTestId("student-card-sheet");
    expect(sheet).toHaveStyle({ width: "85.60mm", height: "53.98mm" });
    expect(screen.getByTestId("student-card-holder-title")).toHaveTextContent("CARTE D’ÉLÈVE");
    expect(await screen.findByTestId("student-card-qr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeEnabled();
    expect(screen.getByTestId("student-card-name")).toHaveTextContent("Kabila Amina");
    expect(screen.getByTestId("student-card-ref")).toHaveTextContent("…ABCDEF");
    expect(document.body.textContent).not.toContain("PUBLIC-ID-ABCDEF");
    expect(qrToDataUrl).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ errorCorrectionLevel: "M", margin: 4 }));
    for (const call of qrToDataUrl.mock.calls) expect(call[0]).toBe(TOKEN);
    expectSecretAbsent();
    expect(document.body.textContent).not.toMatch(/parentPhone|parentEmail|birthDate|token_hash/);
    expect(document.querySelector('img[src*="/logo"]')).toBeTruthy();
  });

  it("étudiant : en-tête CARTE D’ÉTUDIANT et nom de fichier dédié", async () => {
    renderCard(ETUDIANT);
    expect(screen.getByTestId("student-card-holder-title")).toHaveTextContent("CARTE D’ÉTUDIANT");
    expect(screen.queryByText("CARTE D’ÉLÈVE")).toBeNull();
    expect(await screen.findByTestId("student-card-qr")).toBeInTheDocument();
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);
    await userEvent.setup().click(screen.getByRole("button", { name: "Imprimer" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("Carte-etudiant-CD-001");
    printSpy.mockRestore();
    window.dispatchEvent(new Event("afterprint"));
  });

  it("titulaire absent ou inconnu : impression refusée, aucun QR généré, aucune carte rendue", async () => {
    for (const holder of [null, { kind: null, source: null }, { kind: "student", source: null }] as never[]) {
      const { unmount } = renderCard(holder);
      expect(screen.getByText("Impression impossible")).toBeInTheDocument();
      expect(screen.queryByTestId("student-card-sheet")).toBeNull();
      expect(screen.queryByRole("button", { name: "Imprimer" })).toBeNull();
      expect(screen.getByRole("button", { name: "Terminer" })).toBeEnabled();
      expectSecretAbsent();
      unmount();
    }
    expect(qrToDataUrl).not.toHaveBeenCalled();
  });

  it("laisse Imprimer désactivé tant que le QR est en cours", async () => {
    let resolveQr: (value: string) => void = () => undefined;
    qrToDataUrl.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveQr = resolve;
        }),
    );
    renderCard();
    expect(screen.getByText("Génération du QR…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeDisabled();
    expectSecretAbsent();
    resolveQr("data:image/png;base64,len-16");
    expect(await screen.findByTestId("student-card-qr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeEnabled();
    expectSecretAbsent();
  });

  it("désactive Imprimer si le QR échoue et réessaie localement", async () => {
    const user = userEvent.setup();
    qrToDataUrl.mockRejectedValue(new Error("qr"));
    renderCard();
    expect(await screen.findByText("Le QR n’a pas pu être généré. N’imprimez pas cette carte.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeDisabled();
    expect(screen.queryByTestId("student-card-qr")).toBeNull();
    expectSecretAbsent();
    const callsBeforeRetry = qrToDataUrl.mock.calls.length;
    qrToDataUrl.mockResolvedValue("data:image/png;base64,len-16");
    await user.click(screen.getByRole("button", { name: "Réessayer le QR" }));
    expect(await screen.findByTestId("student-card-qr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Réessayer le QR" })).toBeNull();
    expect(qrToDataUrl.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    for (const call of qrToDataUrl.mock.calls) {
      expect(call[0]).toBe(TOKEN);
    }
    expectSecretAbsent();
  });

  it("formats d'impression : CR80 par défaut, A4 à taille réelle ; classes retirées à la fermeture", async () => {
    const user = userEvent.setup();
    const { unmount } = renderCard();
    await screen.findByTestId("student-card-qr");
    expect(document.body.classList.contains("somafrik-print-student-card")).toBe(true);
    expect(document.body.classList.contains("somafrik-print-student-card-a4")).toBe(false);
    expect(screen.getByRole("radio", { name: "Imprimante à cartes (CR80)" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Feuille A4 (taille réelle, à découper)" }));
    expect(document.body.classList.contains("somafrik-print-student-card-a4")).toBe(true);
    // La carte garde exactement ses dimensions physiques, quel que soit le format.
    expect(screen.getByTestId("student-card-sheet")).toHaveStyle({ width: "85.60mm", height: "53.98mm" });
    await user.click(screen.getByRole("radio", { name: "Imprimante à cartes (CR80)" }));
    expect(document.body.classList.contains("somafrik-print-student-card-a4")).toBe(false);
    await user.click(screen.getByRole("radio", { name: "Feuille A4 (taille réelle, à découper)" }));
    unmount();
    expect(document.body.classList.contains("somafrik-print-student-card")).toBe(false);
    expect(document.body.classList.contains("somafrik-print-student-card-a4")).toBe(false);
  });

  it("données facultatives absentes : lignes masquées, aucun libellé de remplacement imprimé", async () => {
    renderCard(ELEVE, { classLabel: null as never, studentCode: null as never, schoolName: null as never });
    await screen.findByTestId("student-card-qr");
    expect(screen.queryByTestId("student-card-class")).toBeNull();
    expect(screen.queryByTestId("student-card-code")).toBeNull();
    expect(screen.queryByText("Matricule")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Non renseigné|Aucune inscription active/);
  });
});
