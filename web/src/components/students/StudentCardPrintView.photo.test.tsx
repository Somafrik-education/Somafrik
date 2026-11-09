import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../../api/client";
import { StudentCardPrintView } from "./StudentCardPrintView";
import type { StudentCardHolder } from "../../lib/studentCardsApi";

/**
 * CARTE-PHOTO-02 — la carte individuelle affiche la vraie photo (pièce PHOTO du dossier),
 * les initiales sinon, et n'expose jamais le jeton de carte ni le JWT.
 */

const requestBlob = vi.hoisted(() => vi.fn());
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return { ...actual, requestBlob };
});
vi.mock("qrcode", () => ({
  default: { toDataURL: async (value: string) => `data:image/png;base64,len-${value.length}` },
}));

const TOKEN = "CARD-A.TOKEN-1";
const ELEVE: StudentCardHolder = { kind: "eleve", source: "school_type" };
const identity = {
  displayName: "Kabila Onesphore",
  classLabel: "6ème A",
  studentCode: "CD-IN-KO-26-00009",
  schoolName: "Lycée Test",
  photoUrl: null,
  publicId: "PUBLIC-ID-ABCDEF",
};

function view(studentRef: string, scope = "CD-IN-26-001") {
  return (
    <StudentCardPrintView
      cardToken={TOKEN}
      holder={ELEVE}
      identity={identity}
      school={null}
      photoStudentRef={studentRef}
      photoScope={scope}
      onClose={() => undefined}
    />
  );
}

describe("StudentCardPrintView — CARTE-PHOTO-02", () => {
  let objectUrls = 0;
  beforeEach(() => {
    requestBlob.mockReset();
    objectUrls = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:card-photo-${(objectUrls += 1)}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.className = "";
  });

  it("affiche la photo réelle du dossier et n'autorise l'impression CR80 qu'une fois chargée", async () => {
    let resolve!: (blob: Blob) => void;
    requestBlob.mockReturnValue(new Promise<Blob>((done) => { resolve = done; }));
    render(view("CD-IN-KO-26-00009"));
    expect(requestBlob).toHaveBeenCalledWith("/students/CD-IN-KO-26-00009/photo");
    expect(await screen.findByTestId("student-card-qr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeDisabled();
    expect(screen.getByTestId("student-card-initials")).toBeInTheDocument();

    await act(async () => resolve(new Blob([new Uint8Array([137, 80])], { type: "image/png" })));
    const photo = await screen.findByTestId("student-card-photo");
    expect(photo).toHaveAttribute("src", "blob:card-photo-1");
    expect(screen.queryByTestId("student-card-initials")).not.toBeInTheDocument();
    expect(screen.getByTestId("student-card-sheet")).toContainElement(photo);
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeEnabled();
    expect(document.body.classList.contains("somafrik-print-student-card")).toBe(true);
    expect(screen.queryByTestId("student-card-photo-notice")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toMatch(/Bearer|access_token|token=/);
  });

  it("élève sans photo : initiales, sans message d'erreur", async () => {
    requestBlob.mockRejectedValue(new ApiError("Aucune photo", 404, "STUDENT_PHOTO_ABSENT"));
    render(view("CD-IN-AN-26-00010"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Imprimer" })).toBeEnabled());
    expect(screen.getByTestId("student-card-initials")).toHaveTextContent("KO");
    expect(screen.queryByTestId("student-card-photo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("student-card-photo-notice")).not.toBeInTheDocument();
  });

  it("accès interdit ou fichier disparu : aucune image, initiales et diagnostic non sensible", async () => {
    for (const [failure, text] of [
      [new ApiError("Refusé", 403, "STUDENT_DOC_DENIED"), "vos droits"],
      [new ApiError("Non authentifié", 401), "vos droits"],
      [new ApiError("Fichier", 404, "STUDENT_PHOTO_FILE_MISSING"), "introuvable sur le serveur"],
    ] as const) {
      requestBlob.mockReset();
      requestBlob.mockRejectedValue(failure);
      const rendered = render(view("CD-IN-KO-26-00009"));
      expect(await screen.findByTestId("student-card-photo-notice")).toHaveTextContent(text);
      expect(screen.queryByTestId("student-card-photo")).not.toBeInTheDocument();
      expect(screen.getByTestId("student-card-initials")).toBeInTheDocument();
      expect(screen.getByTestId("student-card-photo-notice").textContent).not.toMatch(/CD-IN|\/api\/|storage/);
      rendered.unmount();
    }
  });

  it("changement d'établissement : l'ancienne photo disparaît immédiatement et l'URL locale est révoquée", async () => {
    requestBlob.mockResolvedValueOnce(new Blob([new Uint8Array([137])], { type: "image/png" }));
    requestBlob.mockReturnValueOnce(new Promise<Blob>(() => undefined));
    const rendered = render(view("CD-IN-KO-26-00009", "CD-IN-26-001"));
    expect(await screen.findByTestId("student-card-photo")).toHaveAttribute("src", "blob:card-photo-1");
    rendered.rerender(view("CD-IN-KO-26-00009", "BI-BUJ-26-001"));
    expect(screen.queryByTestId("student-card-photo")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:card-photo-1");
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeDisabled();
    rendered.unmount();
  });
});
