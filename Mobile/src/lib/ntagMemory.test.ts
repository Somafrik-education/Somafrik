import assert from "node:assert/strict";
import test from "node:test";
import { NTAG_DATA_BYTES, parseCapabilityContainer, readNtagNdefArea, type NtagModel } from "./ntagMemory";

const TOTAL_PAGES: Record<NtagModel, number> = { NTAG213: 45, NTAG216: 231 };

/** Mémoire NTAG complète : pages 0-2 (UID/verrous), page 3 = CC, zone de données dès la page 4. */
function memory(model: NtagModel, data: number[], cc = [0xe1, 0x10, model === "NTAG213" ? 0x12 : 0x6d, 0x00]) {
  const bytes: number[] = Array.from({ length: TOTAL_PAGES[model] * 4 }, (_, i) => (i < 12 ? 0x04 : 0x00));
  bytes.splice(12, 4, ...cc);
  data.forEach((b, i) => { bytes[16 + i] = b; });
  const reads: number[] = [];
  // READ 30h : 16 octets à partir de la page demandée, avec retour circulaire en fin de mémoire.
  const read = async (page: number) => {
    reads.push(page);
    return Array.from({ length: 16 }, (_, i) => bytes[(page * 4 + i) % bytes.length]);
  };
  return { read, reads };
}
const message = (n: number) => Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);
const ndefTlv = (m: number[]) => (m.length < 0xff ? [0x03, m.length, ...m, 0xfe] : [0x03, 0xff, m.length >> 8, m.length & 0xff, ...m, 0xfe]);

test("puce vierge d'usine (CC E1 10 12 00, TLV 03 00 FE) : message vide, deux lectures", async () => {
  const chip = memory("NTAG213", [0x03, 0x00, 0xfe]);
  const area = await readNtagNdefArea(chip.read, "NTAG213");
  assert.deepEqual(area.message, []);
  assert.deepEqual(area.cc, { dataBytes: 144, readOnly: false });
  assert.deepEqual(chip.reads, [3, 4]);
});

test("message de carte Somafrik (≈ 90 octets) sur NTAG213 : octets exacts, lectures successives de 4 pages", async () => {
  const m = message(90);
  const chip = memory("NTAG213", ndefTlv(m));
  const area = await readNtagNdefArea(chip.read, "NTAG213");
  assert.deepEqual(area.message, m);
  assert.deepEqual(chip.reads, [3, 4, 8, 12, 16, 20, 24]); // 2 + 90 octets → 6 blocs de 16 octets
});

test("longueur sur 3 octets (FF xx xx) sur NTAG216 et message proche de la capacité", async () => {
  for (const size of [255, 300, 872 - 5]) {
    const m = message(size);
    const chip = memory("NTAG216", ndefTlv(m));
    const area = await readNtagNdefArea(chip.read, "NTAG216");
    assert.deepEqual(area.message, m, `taille ${size}`);
    assert.ok(Math.max(...chip.reads) <= 4 + 872 / 4 - 1, "aucune lecture au-delà de la zone annoncée par le CC");
  }
});

test("TLV NULL, Lock Control, Memory Control et propriétaire ignorés avant le message NDEF", async () => {
  const m = message(20);
  const chip = memory("NTAG216", [0x00, 0x00, 0x01, 0x03, 0xa0, 0x0c, 0x34, 0x02, 0x03, 0x00, 0x00, 0x00, 0xfd, 0x01, 0x99, ...ndefTlv(m)]);
  assert.deepEqual((await readNtagNdefArea(chip.read, "NTAG216")).message, m);
});

test("terminateur sans message NDEF : puce vide", async () => {
  assert.deepEqual((await readNtagNdefArea(memory("NTAG213", [0xfe]).read, "NTAG213")).message, []);
});

test("longueurs et TLV hors zone de données refusés, sans lire les pages suivantes", async () => {
  const over = memory("NTAG213", [0x03, 0x90, ...message(10)]); // 144 octets annoncés après 2 octets d'en-tête
  await assert.rejects(readNtagNdefArea(over.read, "NTAG213"), { code: "NFC_FOREIGN" });
  assert.ok(Math.max(...over.reads) <= 39);
  const smallCc = memory("NTAG213", [0x03, 0x7f, ...message(0x7f)], [0xe1, 0x10, 0x10, 0x00]); // CC : 128 octets
  await assert.rejects(readNtagNdefArea(smallCc.read, "NTAG213"), { code: "NFC_FOREIGN" });
  await assert.rejects(readNtagNdefArea(memory("NTAG216", [0x03, 0xff, 0x00, 0x10]).read, "NTAG216"), { code: "NFC_FOREIGN" }, "forme longue < 255");
  await assert.rejects(readNtagNdefArea(memory("NTAG216", [0x42, 0x01, 0x00]).read, "NTAG216"), { code: "NFC_FOREIGN" }, "TLV inconnu");
});

test("zone de données entièrement NULL : puce vide, lecture bornée aux 36 pages de données NTAG213", async () => {
  const chip = memory("NTAG213", Array(144).fill(0x00));
  assert.deepEqual((await readNtagNdefArea(chip.read, "NTAG213")).message, []);
  assert.equal(Math.max(...chip.reads), 36); // READ 36 couvre les pages 36-39, dernière page de données
});

test("CC : non formatée, version inconnue, taille impossible, droits inconnus ; lecture seule détectée", () => {
  assert.throws(() => parseCapabilityContainer([0, 0, 0, 0], "NTAG216"), { code: "NFC_NDEF" });
  assert.throws(() => parseCapabilityContainer([0xe1, 0x20, 0x6d, 0], "NTAG216"), { code: "NFC_NDEF" });
  assert.throws(() => parseCapabilityContainer([0xe1, 0x10, 0x6d, 0], "NTAG213"), { code: "NFC_FOREIGN" });
  assert.throws(() => parseCapabilityContainer([0xe1, 0x10, 0x00, 0], "NTAG213"), { code: "NFC_FOREIGN" });
  assert.throws(() => parseCapabilityContainer([0xe1, 0x10, 0x12, 0x80], "NTAG213"), { code: "NFC_FOREIGN" });
  assert.deepEqual(parseCapabilityContainer([0xe1, 0x10, 0x12, 0x0f], "NTAG213"), { dataBytes: 144, readOnly: true });
  assert.deepEqual(parseCapabilityContainer([0xe1, 0x10, 0x6d, 0x00], "NTAG216"), { dataBytes: 872, readOnly: false });
  assert.ok(872 <= NTAG_DATA_BYTES.NTAG216);
});

test("réponse READ incomplète ou invalide : NFC_READBACK", async () => {
  await assert.rejects(readNtagNdefArea(async () => Array(15).fill(0), "NTAG213"), { code: "NFC_READBACK" });
  await assert.rejects(readNtagNdefArea(async () => Array(16).fill(256), "NTAG213"), { code: "NFC_READBACK" });
});
