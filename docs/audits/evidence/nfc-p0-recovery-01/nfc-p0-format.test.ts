// NFC-P0-RECOVERY-01 — contrat format écrit / format lu, et refus de modèle.
// Nécessite Mobile/node_modules (react-native-nfc-manager@4.0.0-beta.10).
// Exécution (depuis Mobile/) : npx --yes tsx --test ../docs/audits/evidence/nfc-p0-recovery-01/nfc-p0-format.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { extractNfcCardTokenFromTag } from "../../../../Mobile/src/lib/studentCardNfc";
import { identifyNtag, ndefForCard } from "../../../../Mobile/src/lib/studentCardNfcEncoding";

const ndef = createRequire(new URL("../../../../Mobile/package.json", import.meta.url))("react-native-nfc-manager/dist/ndef-lib");

test("F-01 octets écrits par l'encodeur = contrat du lecteur ; taille compatible NTAG213", () => {
  const token = `${"A".repeat(22)}.${"B".repeat(43)}`;
  const bytes = ndef.encodeMessage([ndef.textRecord(ndefForCard(token), "en")]);
  assert.equal(bytes.length, 87);
  assert.ok(bytes.length + 3 <= 144); // TLV 03 len … FE dans 144 octets utilisateur
  assert.deepEqual(extractNfcCardTokenFromTag({ id: "04112233445566", ndefMessage: ndef.decodeMessage(bytes) }), { ok: true, token });
});

test("F-02 NTAG215, UID non NXP et GET_VERSION non NXP sont refusés NFC_FOREIGN", () => {
  assert.throws(() => identifyNtag("04112233445566", [0, 4, 4, 2, 1, 0, 0x11, 3]), { code: "NFC_FOREIGN" });
  assert.throws(() => identifyNtag("1D112233445566", [0, 4, 4, 2, 1, 0, 0x0f, 3]), { code: "NFC_FOREIGN" });
  assert.throws(() => identifyNtag("04112233445566", [0, 0x53, 4, 2, 1, 0, 0x0f, 3]), { code: "NFC_FOREIGN" });
});
