import { describe, expect, it } from "vitest";
import {
  assembleBatchPrintDocument,
  convertBatchPrintDocument,
  readBatchPrintDocument,
  type BatchPrintIdentity,
} from "./studentCardBatchPrintable";

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
});
