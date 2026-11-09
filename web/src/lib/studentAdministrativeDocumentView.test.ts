import { describe, expect, it } from "vitest";
import { buildCanonicalStudentDocumentsView } from "./studentAdministrativeDocumentView";
import { validateStudentFile, type StudentStoredDocument } from "./studentAdministrativeDocumentsApi";

function documentRow(overrides: Partial<StudentStoredDocument> = {}): StudentStoredDocument {
  return {
    id: "d-1", studentId: "stu-1", documentType: "BIRTH_CERTIFICATE",
    title: "Acte de naissance", status: "submitted", fileName: "naissance.pdf",
    mimeType: "application/pdf", fileSize: 1200, createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z", verifiedAt: null, ...overrides,
  };
}

describe("FICHE-DOC-02 — affichage canonique Web", () => {
  it("conserve les exigences de pièces lorsqu'aucun fichier réel n'existe", () => {
    const model = buildCanonicalStudentDocumentsView("stu-1", []);
    expect(model.summary.missing).toBeGreaterThanOrEqual(3);
    expect(model.summary.verified).toBe(0);
    expect(model.documents.some(x => x.label === "Acte de naissance" && x.status === "MISSING")).toBe(true);
  });
  it("un fichier déposé n'est pas automatiquement validé", () => {
    const model = buildCanonicalStudentDocumentsView("stu-1", [documentRow()]);
    expect(model.summary.pending).toBe(1);
    expect(model.summary.verified).toBe(0);
    expect(model.documents.find(x => x.id === "d-1")?.status).toBe("SUBMITTED");
  });
  it("une vérification PostgreSQL recalcule la conformité", () => {
    const model = buildCanonicalStudentDocumentsView("stu-1", [
      documentRow({ status: "verified", verifiedAt: "2026-10-12T01:00:00Z" }),
    ]);
    expect(model.summary.verified).toBe(1);
    expect(model.summary.complianceRate).toBeGreaterThan(0);
    expect(model.documents.find(x => x.id === "d-1")?.status).toBe("VERIFIED");
  });
  it("une archive ne satisfait plus une exigence", () => {
    const model = buildCanonicalStudentDocumentsView("stu-1", [
      documentRow({ status: "archived" }),
    ]);
    expect(model.summary.verified).toBe(0);
    expect(model.documents.find(x => x.id === "d-1")).toBeUndefined();
  });
  it("les fichiers illégaux ou trop volumineux sont refusés avant la requête HTTP", () => {
    expect(validateStudentFile(new File(["MZ"], "virus.exe", { type: "application/octet-stream" }), "OTHER")).toMatch(/PDF/);
    expect(validateStudentFile(new File(["%PDF"], "portrait.pdf", { type: "application/pdf" }), "PHOTO")).toMatch(/image/);
    expect(validateStudentFile(new File(["x"], "naissance.pdf", { type: "application/pdf" }), "BIRTH_CERTIFICATE")).toBeNull();
  });
});
