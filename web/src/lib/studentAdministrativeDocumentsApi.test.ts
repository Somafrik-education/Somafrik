import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  request: vi.fn(),
  requestBlob: vi.fn(),
}));

vi.mock("../api/client", () => ({
  request: api.request,
  requestBlob: api.requestBlob,
}));

import { studentAdministrativeDocumentsApi } from "./studentAdministrativeDocumentsApi";

describe("DOC-02 — transport Web authentifié", () => {
  beforeEach(() => {
    api.request.mockReset();
    api.requestBlob.mockReset();
    api.request.mockResolvedValue({ id: "doc-test", status: "submitted" });
  });

  it("envoie le fichier brut et la catégorie autorisée avec en-têtes ASCII", async () => {
    const file = new File(["%PDF test"], "Acte élève.pdf", { type: "application/pdf" });
    await studentAdministrativeDocumentsApi.upload("CD-TEST 1", "BIRTH_CERTIFICATE", file);
    expect(api.request).toHaveBeenCalledWith(
      "/students/CD-TEST%201/documents",
      expect.objectContaining({
        method: "POST",
        body: file,
        headers: {
          "Content-Type": "application/pdf",
          "X-Filename": "Acte _l_ve.pdf",
          "X-Document-Type": "BIRTH_CERTIFICATE",
        },
      }),
    );
  });

  it("ne lance aucun HTTP pour un fichier interdit", async () => {
    const file = new File(["MZ"], "virus.exe", { type: "application/octet-stream" });
    await expect(studentAdministrativeDocumentsApi.upload("CD", "OTHER", file)).rejects.toThrow(/PDF, JPEG et PNG/);
    expect(api.request).not.toHaveBeenCalled();
  });

  it("verrouille les identifiants dans le chemin des mutations et du téléchargement", async () => {
    await studentAdministrativeDocumentsApi.verify("s/1", "doc/1");
    await studentAdministrativeDocumentsApi.archive("s/1", "doc/1");
    await studentAdministrativeDocumentsApi.download("s/1", "doc/1");
    expect(api.request).toHaveBeenNthCalledWith(1, "/students/s%2F1/documents/doc%2F1/verify", { method: "POST" });
    expect(api.request).toHaveBeenNthCalledWith(2, "/students/s%2F1/documents/doc%2F1/archive", { method: "POST" });
    expect(api.requestBlob).toHaveBeenCalledWith("/students/s%2F1/documents/doc%2F1/file");
  });
});
