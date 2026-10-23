import { describe, expect, it, vi } from "vitest";
import { classStudentsApi, type ClassStudent } from "./classStudentsApi";
import { studentCardsApi } from "./studentCardsApi";
import {
  assembleBatchPrintDocument,
  convertBatchPrintDocument,
  loadBatchPrintIdentities,
  readBatchPrintDocument,
  type BatchPrintIdentity,
} from "./studentCardBatchPrintable";

vi.mock("./classStudentsApi", () => ({
  classStudentsApi: { list: vi.fn() },
}));

vi.mock("./studentCardsApi", () => ({
  studentCardsApi: { list: vi.fn() },
}));

const SECRET = "supersecretvalue";
const TOKEN = `pubidvalue.${SECRET}`;
const QR = "data:image/png;base64,AAAA";

const identity = {
  studentId: "student-new",
  holderKind: "eleve" as const,
  displayName: "Awa DIOP",
  studentCode: "MAT-1",
  classLabel: "6ème A",
  schoolName: "Institut Nuru",
};

function documentFor(identities: BatchPrintIdentity[] = [identity]) {
  return assembleBatchPrintDocument(
    { batchId: "11111111-1111-4111-8111-111111111111", classCode: "CLS-1", className: "6ème A", expiresAt: null },
    [{ studentId: "student-new", publicId: "pubidvalue", cardToken: TOKEN, secret: SECRET }],
    identities,
  );
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
    const visible = printable.value.replace(/<script[\s\S]*<\/script>/, "");
    expect(visible).not.toContain(SECRET);
    const restored = readBatchPrintDocument(printable.value);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
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
      },
    ]);
  });
});
