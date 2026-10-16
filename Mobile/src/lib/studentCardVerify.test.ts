import assert from "node:assert/strict";
import test from "node:test";
import { CARD_VERIFY_COPY, cardVerifyErrorMessage, describeCardVerification } from "./studentCardVerify";

test("carte invalide ou hors périmètre : aucune ligne d'information", () => {
  assert.deepEqual(describeCardVerification({ card: { valid: false }, scope: "none" }).rows, []);
  const outside = describeCardVerification({ card: { valid: true, medium: "qr" }, scope: "none" });
  assert.equal(outside.hint, CARD_VERIFY_COPY.outOfScope);
  assert.deepEqual(outside.rows, []);
});

test("seules les sections renvoyées par le serveur sont affichées", () => {
  const teacher = describeCardVerification({
    card: { valid: true }, scope: "class",
    student: { firstName: "Amina", lastName: "K", studentCode: "CD-1" },
    class: { className: "3e A" },
    attendance: { date: "2026-10-15", status: null },
  });
  assert.deepEqual(teacher.rows.map((row) => row.label), ["Élève", "Matricule", "Classe", "Présence du jour"]);
  assert.equal(teacher.rows[3].value, "Non pointé");
  const director = describeCardVerification({
    card: { valid: true }, scope: "school",
    student: { firstName: "Bao", lastName: "L" },
    finance: { code: "OVERDUE", label: "Impayé" },
    cardHistory: [{ status: "active" }, { status: "revoked" }],
    guardians: [{ name: "Mama", phone: "+243", isPrincipal: true }],
  });
  assert.deepEqual(director.rows, [
    { label: "Élève", value: "Bao L" },
    { label: "Situation financière", value: "Impayé" },
    { label: "Historique des cartes", value: "active, révoquée" },
    { label: "Responsable principal", value: "Mama · +243" },
  ]);
});

test("erreurs : messages sans détail interne", () => {
  assert.equal(cardVerifyErrorMessage({ status: 403, code: "CARD_VERIFY_FORBIDDEN" }), CARD_VERIFY_COPY.forbidden);
  assert.equal(cardVerifyErrorMessage({ status: 0, code: "NETWORK_UNAVAILABLE" }), CARD_VERIFY_COPY.offline);
  assert.equal(cardVerifyErrorMessage(new Error("boom")), CARD_VERIFY_COPY.failed);
});

test("garde-fous : aucun journal, aucun stockage, aucun droit déduit côté Mobile", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname ?? __dirname, "..");
  for (const file of ["lib/studentCardVerify.ts", "services/studentCardVerifyApi.ts", "components/StudentCardVerifyModal.tsx"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /console\.|safeLogger|AsyncStorage|SecureStore|SQLite/);
    assert.doesNotMatch(source, /permissions|roleKey|canRead|canManage/, `${file} : le filtrage est fait par le serveur`);
  }
});
