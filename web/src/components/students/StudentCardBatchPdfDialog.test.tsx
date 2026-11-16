import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CARD_PDF_UNRECOGNIZED } from "../../lib/studentCardBatchPdf";
import { StudentCardBatchPdfDialog } from "./StudentCardBatchPdfDialog";

const convertBatchPrintFileToPdf = vi.hoisted(() => vi.fn());
const batchApi = vi.hoisted(() => ({
  preflight: vi.fn(),
  prepare: vi.fn(),
  activate: vi.fn(),
  abort: vi.fn(),
  receiptTechnical: vi.fn(),
  receiptSaved: vi.fn(),
}));

vi.mock("../../lib/studentCardBatchPdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/studentCardBatchPdf")>();
  return { ...actual, convertBatchPrintFileToPdf };
});

vi.mock("../../lib/studentCardBatchApi", () => ({
  studentCardBatchApi: batchApi,
}));

describe("dialogue PDF A4", () => {
  beforeEach(() => {
    convertBatchPrintFileToPdf.mockReset();
    Object.values(batchApi).forEach((method) => method.mockReset());
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:card-pdf");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.mocked(URL.createObjectURL).mockClear();
    vi.mocked(URL.revokeObjectURL).mockClear();
  });

  it("télécharge le PDF sans émission et sans conserver le jeton à l'écran", async () => {
    const secret = "supersecretvalue";
    convertBatchPrintFileToPdf.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([37, 80, 68, 70]),
      pageCount: 2,
      cardCount: 11,
      cardsPerPage: 10,
      classCode: "CLS-1",
    });
    const user = userEvent.setup();
    render(<StudentCardBatchPdfDialog open onClose={vi.fn()} />);
    const input = screen.getByLabelText("Document CR80");
    expect(input).toHaveAttribute("accept", ".html,text/html");
    await user.upload(input, new File([`<html>${secret}</html>`], "cartes-cr80-CLS-1.html", { type: "text/html" }));
    expect(await screen.findByText(/PDF A4 produit : 11 cartes, 2 pages/)).toBeInTheDocument();
    expect(convertBatchPrintFileToPdf).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:card-pdf");
    expect(document.body.textContent?.includes(secret)).toBe(false);
    expect(batchApi.prepare).not.toHaveBeenCalled();
    expect(batchApi.activate).not.toHaveBeenCalled();
    expect(batchApi.preflight).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("signale qu'un document v1 est réimprimé sans logo ni photo, sans réémission", async () => {
    convertBatchPrintFileToPdf.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([37, 80, 68, 70]),
      pageCount: 1,
      cardCount: 2,
      cardsPerPage: 10,
      classCode: "CLS-1",
      visuals: { logo: "not_in_source", photos: { embedded: 0, absent: 0, unavailable: 0, not_in_source: 2 } },
    });
    const user = userEvent.setup();
    render(<StudentCardBatchPdfDialog open onClose={vi.fn()} />);
    await user.upload(screen.getByLabelText("Document CR80"), new File(["<html></html>"], "ancien.html", { type: "text/html" }));
    expect(await screen.findByText(/produit avant l’intégration du logo et des photos/)).toBeInTheDocument();
    expect(screen.getByText(/Aucune carte n’est réémise ni remplacée/)).toBeInTheDocument();
    expect(batchApi.prepare).not.toHaveBeenCalled();
  });

  it("affiche le refus sans reprendre le contenu du fichier", async () => {
    const secret = "supersecretvalue";
    convertBatchPrintFileToPdf.mockResolvedValue({ ok: false, message: CARD_PDF_UNRECOGNIZED });
    const user = userEvent.setup();
    render(<StudentCardBatchPdfDialog open onClose={vi.fn()} />);
    await user.upload(
      screen.getByLabelText("Document CR80"),
      new File([secret], "cartes-cr80-CLS-1.html", { type: "text/html" }),
    );
    expect(await screen.findByText(CARD_PDF_UNRECOGNIZED)).toBeInTheDocument();
    expect(document.body.textContent?.includes(secret)).toBe(false);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await waitFor(() => expect(convertBatchPrintFileToPdf).toHaveBeenCalledTimes(1));
  });
});
