import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../../api/client";
import type { DocumentSaveEnvironment } from "../../lib/studentCardBatchSession";
import type { BatchPrintIdentity } from "../../lib/studentCardBatchPrintable";
import type { SchoolLogoSource } from "../../lib/schoolLogo";
import type { CardVisual } from "../../lib/studentCardDesign";
import { TEST_PHOTO_JPEG_DATA_URL, testPngDataUrl } from "../../lib/studentCardTestImages";
import { StudentCardBatchDialog } from "./StudentCardBatchDialog";

const SECRET = "supersecretvalue";
const TOKEN = `pubidvalue.${SECRET}`;
const BATCH_ID = "11111111-1111-4111-8111-111111111111";

const batchApi = vi.hoisted(() => ({
  preflight: vi.fn(),
  prepare: vi.fn(),
  read: vi.fn(),
  receiptTechnical: vi.fn(),
  receiptSaved: vi.fn(),
  activate: vi.fn(),
  abort: vi.fn(),
}));

vi.mock("../../lib/studentCardBatchApi", () => ({
  studentCardBatchApi: batchApi,
}));

const publicView = {
  batchId: BATCH_ID,
  classCode: "CLS-1",
  className: "6ème A",
  status: "prepared",
  expiresAt: "2026-10-23T18:00:00.000Z",
  receivedAt: null,
  savedAt: null,
  activatedAt: null,
  secretsIncluded: false as const,
  secretsRecoverable: false as const,
  counts: { prepared: 1, alreadyActive: 1, ineligible: 1 },
  entries: [
    { studentId: "student-active", decision: "already_active", reason: null, publicId: "activepub", outcome: null, cardStatus: "active", scannable: true },
    { studentId: "student-out", decision: "ineligible", reason: "HOLDER_UNDETERMINED", publicId: null, outcome: null, cardStatus: null, scannable: false },
    { studentId: "student-new", decision: "prepared", reason: null, publicId: "pubidvalue", outcome: "prepared", cardStatus: "issued", scannable: false },
  ],
};

const printIdentity: BatchPrintIdentity = {
  studentId: "student-new",
  holderKind: "eleve",
  displayName: "Awa DIOP",
  studentCode: "MAT-1",
  classLabel: "6ème A",
  schoolName: "Institut Nuru",
};

function renderDialog(
  classCode = "CLS-1",
  identities: BatchPrintIdentity[] = [printIdentity],
  extra: { school?: SchoolLogoSource; loadSchoolLogo?: (school: SchoolLogoSource) => Promise<CardVisual> } = {},
) {
  const saveDocument = vi.fn<(textBody: string, filename: string, env: DocumentSaveEnvironment) => Promise<{ verified: boolean; bytesWritten: number; cancelled: boolean }>>(
    async () => ({ verified: true, bytesWritten: 80, cancelled: false }),
  );
  const loadPrintIdentities = vi.fn(async () => identities);
  const view = render(
    <StudentCardBatchDialog
      open
      classCode={classCode}
      className="6ème A"
      schoolName="Institut Nuru"
      onClose={vi.fn()}
      loadPrintIdentities={loadPrintIdentities}
      saveDocument={saveDocument}
      school={extra.school}
      loadSchoolLogo={extra.loadSchoolLogo}
    />,
  );
  return { ...view, saveDocument, loadPrintIdentities };
}

describe("StudentCardBatchDialog", () => {
  beforeEach(() => {
    batchApi.preflight.mockReset();
    batchApi.prepare.mockReset();
    batchApi.read.mockReset();
    batchApi.receiptTechnical.mockReset();
    batchApi.receiptSaved.mockReset();
    batchApi.activate.mockReset();
    batchApi.abort.mockReset();
    batchApi.preflight.mockResolvedValue({
      classCode: "CLS-1",
      className: "6ème A",
      counts: { issueCandidates: 1, alreadyActive: 1, ineligible: 1 },
      entries: [
        { studentId: "student-new", decision: "issue_candidate", reason: null },
        { studentId: "student-active", decision: "already_active", reason: null },
        { studentId: "student-out", decision: "ineligible", reason: "HOLDER_UNDETERMINED" },
      ],
    });
  });

  it("affiche le précontrôle et n'émet rien tant que l'opérateur ne prépare pas", async () => {
    renderDialog();
    expect(await screen.findByText("Titulaire indéterminé")).toBeInTheDocument();
    expect(screen.getByText("Carte déjà active — non réexportée")).toBeInTheDocument();
    expect(screen.getByText("Éligibles").parentElement).toHaveTextContent("1");
    expect(batchApi.prepare).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Activer les cartes" })).not.toBeInTheDocument();
  });

  it("ne réémet pas après une réponse perdue, puis exige l'abandon du lot retrouvé", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    batchApi.prepare
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(
        new ApiError("pending", 409, "STUDENT_CARD_BATCH_PENDING", {
          batchId: BATCH_ID,
          status: "prepared",
          classCode: "CLS-1",
          expiresAt: "2026-10-23T18:00:00.000Z",
          secretsRecoverable: true,
          publicIds: ["pubidvalue"],
          cardToken: TOKEN,
        }),
      );
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole("button", { name: "Préparer les cartes" }));
    expect(await screen.findByText(/Aucune nouvelle émission automatique/)).toBeInTheDocument();
    await waitFor(() => expect(batchApi.prepare).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Contrôler le lot" }));
    expect(await screen.findByText("pubidvalue")).toBeInTheDocument();
    expect(screen.getByText(/ne sont pas récupérables/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(batchApi.prepare).toHaveBeenCalledTimes(2);
    expect(batchApi.activate).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("active seulement après sauvegarde vérifiée, confirmation et preuve de possession", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    batchApi.prepare.mockResolvedValue({
      ok: true,
      nonce: "nonce-value",
      secrets: [{ studentId: "student-new", publicId: "pubidvalue", cardToken: TOKEN, secret: SECRET }],
      view: publicView,
    });
    batchApi.receiptTechnical.mockResolvedValue({ ...publicView, status: "received" });
    batchApi.receiptSaved.mockResolvedValue({ ...publicView, status: "saved" });
    batchApi.activate.mockResolvedValue({
      ...publicView,
      status: "activated",
      counts: { activated: 1, skippedActive: 1 },
    });
    const user = userEvent.setup();
    const { saveDocument } = renderDialog();
    await user.click(await screen.findByRole("button", { name: "Préparer les cartes" }));
    expect(await screen.findByRole("button", { name: "Enregistrer le document CR80" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activer les cartes" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(batchApi.receiptSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Enregistrer le document CR80" }));
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    const savedFile = String(saveDocument.mock.calls[0][0]);
    expect(savedFile).toContain("85.60mm");
    expect(savedFile).toContain("53.98mm");
    expect(savedFile).toContain(TOKEN);
    expect(savedFile).not.toContain("student-active");
    expect(String(saveDocument.mock.calls[0][1])).toMatch(/\.html$/);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeEnabled();
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Confirmer la sauvegarde" }));
    await waitFor(() => expect(batchApi.receiptSaved).toHaveBeenCalledTimes(1));
    expect(batchApi.activate).not.toHaveBeenCalled();
    expect(batchApi.receiptSaved.mock.calls[0][2]).toEqual([
      { studentId: "student-new", publicId: "pubidvalue", cardToken: TOKEN, secret: SECRET },
    ]);

    await user.click(await screen.findByRole("button", { name: "Activer les cartes" }));
    await waitFor(() => expect(batchApi.activate).toHaveBeenCalledTimes(1));
    expect(batchApi.prepare).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("intègre le logo et la photo au document CR80, et signale les éléments manquants", async () => {
    batchApi.prepare.mockResolvedValue({
      ok: true,
      nonce: "nonce-value",
      secrets: [
        { studentId: "student-new", publicId: "pubidvalue", cardToken: TOKEN, secret: SECRET },
        { studentId: "student-two", publicId: "pubidsecond", cardToken: `pubidsecond.${SECRET}2`, secret: `${SECRET}2` },
      ],
      view: publicView,
    });
    batchApi.receiptTechnical.mockResolvedValue({ ...publicView, status: "received" });
    const school = { code: "CD-1", hasLogo: true, logoSource: "school_upload", logoUploadedAt: "2026-10-01T10:00:00.000Z" };
    const logo: CardVisual = { state: "embedded", src: testPngDataUrl(32, 32, [200, 30, 40]) };
    const loadSchoolLogo = vi.fn(async () => logo);
    const user = userEvent.setup();
    const { saveDocument } = renderDialog(
      "CLS-1",
      [
        { ...printIdentity, photo: { state: "embedded", src: TEST_PHOTO_JPEG_DATA_URL } },
        { ...printIdentity, studentId: "student-two", displayName: "Jean ILUNGA", photo: { state: "unavailable" }, photoIssue: "forbidden" },
      ],
      { school, loadSchoolLogo },
    );
    await user.click(await screen.findByRole("button", { name: "Préparer les cartes" }));
    await user.click(await screen.findByRole("button", { name: "Enregistrer le document CR80" }));
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    expect(loadSchoolLogo).toHaveBeenCalledWith(school);
    const savedFile = String(saveDocument.mock.calls[0][0]);
    expect(savedFile).toContain('class="scf-band"');
    expect(savedFile).toContain('data-testid="student-card-logo"');
    expect(savedFile).toContain('data-testid="student-card-photo"');
    expect(savedFile).toContain(">JI</span>");
    expect(savedFile).toContain("somafrik-card-batch-print-v2");
    expect(await screen.findByTestId("card-batch-visual-notice")).toHaveTextContent(
      "1 photo non intégrée : initiales imprimées",
    );
    expect(screen.getByTestId("card-batch-visual-notice")).toHaveTextContent("Causes : 1 non lisible avec vos droits");
    expect(String(saveDocument.mock.calls[0][0])).not.toContain("forbidden");
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("réessaie l'activation sans nouvelle préparation si la réponse est perdue", async () => {
    batchApi.prepare.mockResolvedValue({
      ok: true,
      nonce: "nonce-value",
      secrets: [{ studentId: "student-new", publicId: "pubidvalue", cardToken: TOKEN, secret: SECRET }],
      view: publicView,
    });
    batchApi.receiptTechnical.mockResolvedValue({ ...publicView, status: "received" });
    batchApi.receiptSaved.mockResolvedValue({ ...publicView, status: "saved" });
    batchApi.activate.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({
      ...publicView,
      status: "activated",
      counts: { activated: 1, skippedActive: 0 },
    });
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole("button", { name: "Préparer les cartes" }));
    await user.click(await screen.findByRole("button", { name: "Enregistrer le document CR80" }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Confirmer la sauvegarde" }));
    await user.click(await screen.findByRole("button", { name: "Activer les cartes" }));
    expect(await screen.findByText(/Aucune nouvelle émission automatique/)).toBeInTheDocument();
    expect(batchApi.prepare).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Réessayer l'activation" }));
    await waitFor(() => expect(batchApi.activate).toHaveBeenCalledTimes(2));
    expect(batchApi.prepare).toHaveBeenCalledTimes(1);
  });

  it("n'affiche pas les élèves d'un autre établissement", async () => {
    batchApi.preflight.mockResolvedValueOnce({
      classCode: "CLS-A",
      className: "Classe A",
      counts: { issueCandidates: 1, alreadyActive: 0, ineligible: 0 },
      entries: [{ studentId: "student-school-a", decision: "issue_candidate", reason: null }],
    });
    const { rerender } = renderDialog("CLS-A");
    expect(await screen.findByText("student-school-a")).toBeInTheDocument();
    batchApi.preflight.mockRejectedValueOnce(
      new ApiError("absente", 404, "STUDENT_CARD_CLASS_NOT_FOUND", {
        students: [{ id: "other-school-student", cardToken: TOKEN }],
      }),
    );
    rerender(
      <StudentCardBatchDialog open classCode="CLS-B" className="Classe B" onClose={vi.fn()} />,
    );
    expect(await screen.findByText("Introuvable pour l'établissement courant.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("student-school-a");
    expect(document.body.textContent).not.toContain("other-school-student");
    expect(document.body.textContent).not.toContain(SECRET);
    expect(batchApi.prepare).not.toHaveBeenCalled();
  });

  it("n'active pas si le document CR80 ne peut pas être produit", async () => {
    const user = userEvent.setup();
    const { saveDocument } = renderDialog("CLS-1", [{ ...printIdentity, holderKind: null }]);
    batchApi.prepare.mockResolvedValue({
      ok: true,
      nonce: "nonce-value",
      secrets: [{ studentId: "student-new", publicId: "pubidvalue", cardToken: TOKEN, secret: SECRET }],
      view: publicView,
    });
    batchApi.receiptTechnical.mockResolvedValue({ ...publicView, status: "received" });
    await user.click(await screen.findByRole("button", { name: "Préparer les cartes" }));
    await user.click(await screen.findByRole("button", { name: "Enregistrer le document CR80" }));
    expect(await screen.findByText(/ne seront pas activées/)).toBeInTheDocument();
    expect(saveDocument).not.toHaveBeenCalled();
    expect(batchApi.receiptSaved).not.toHaveBeenCalled();
    expect(batchApi.activate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Activer les cartes" })).not.toBeInTheDocument();
  });

  it("refuse l'administrateur plateforme sans liste d'élèves", async () => {
    batchApi.preflight.mockRejectedValue(
      new ApiError("plateforme", 403, "PLATFORM_PERSONAL_DATA_DENIED", { studentId: "hidden-student" }),
    );
    renderDialog();
    expect(await screen.findByText(/administrateur plateforme/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("hidden-student");
    expect(screen.queryByRole("button", { name: "Préparer les cartes" })).not.toBeInTheDocument();
  });
});
