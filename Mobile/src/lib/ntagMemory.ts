/**
 * CARTE-NFC-ONE-TAP-01 — lecture physique de la zone NDEF d'une NTAG213/216 par commandes READ
 * NfcA, sans dépendre du message NDEF mis en cache par Android au moment de la découverte.
 *
 * Mémoire NTAG21x (NXP NTAG213/215/216, §8.5) : pages de 4 octets. Pages 0-2 : UID et octets de
 * verrouillage statiques. Page 3 : Capability Container (CC) = E1h, version 1.x, taille de la zone
 * de données / 8, droits d'écriture (00h = lecture/écriture, 0Fh = lecture seule). Zone de données
 * à partir de la page 4 : NTAG213 = 144 octets (pages 4-39), NTAG216 = 888 octets (pages 4-225),
 * la taille annoncée par le CC (NTAG216 : 6Dh × 8 = 872) ne pouvant pas la dépasser.
 * READ (30h, page) renvoie 16 octets (4 pages consécutives) ; la lecture est bornée à la zone de
 * données pour ne jamais revenir sur les pages 0-3 ni lire les pages de configuration.
 * La zone de données contient des TLV (NFC Forum Type 2 Tag, §2.3) : 00h NULL (1 octet),
 * 01h Lock Control, 02h Memory Control, FDh propriétaire (ignorés), 03h NDEF Message, FEh fin.
 * Longueur sur 1 octet (00h-FEh) ou 3 octets (FFh puis 2 octets big-endian).
 */
import { nfcFailure } from "./studentCardNfcEncoding";

export const NTAG_READ = 0x30;
export const NTAG_PAGE_BYTES = 4;
export const NTAG_READ_BYTES = 16;
export const NTAG_FIRST_DATA_PAGE = 4;
export const NTAG_DATA_BYTES = { NTAG213: 144, NTAG216: 888 } as const;
export type NtagModel = keyof typeof NTAG_DATA_BYTES;

export type CapabilityContainer = { dataBytes: number; readOnly: boolean };
export type NtagNdefArea = { cc: CapabilityContainer; message: number[] };

/** CC de la page 3 ; toute valeur inattendue est refusée (puce non formatée NDEF ou étrangère). */
export function parseCapabilityContainer(page3: readonly number[], model: NtagModel): CapabilityContainer {
  if (page3.length < 4 || page3[0] !== 0xe1 || page3[1] >> 4 !== 1) throw nfcFailure("NFC_NDEF");
  const announced = page3[2] * 8;
  if (announced === 0 || announced > NTAG_DATA_BYTES[model]) throw nfcFailure("NFC_FOREIGN");
  if (page3[3] !== 0x00 && page3[3] !== 0x0f) throw nfcFailure("NFC_FOREIGN");
  return { dataBytes: announced, readOnly: page3[3] === 0x0f };
}

function length(bytes: (index: number) => Promise<number>, at: number): Promise<{ value: number; size: number }> {
  return bytes(at).then(async (first) => {
    if (first !== 0xff) return { value: first, size: 1 };
    const value = ((await bytes(at + 1)) << 8) | (await bytes(at + 2));
    if (value < 0xff) throw nfcFailure("NFC_FOREIGN"); // forme longue réservée aux longueurs ≥ 255
    return { value, size: 3 };
  });
}

/**
 * Lit la zone de données page par page (READ de 16 octets) et renvoie le message NDEF exact.
 * Seuls les octets nécessaires sont lus ; aucune lecture ne dépasse la zone annoncée par le CC.
 */
export async function readNtagNdefArea(read: (page: number) => Promise<number[]>, model: NtagModel): Promise<NtagNdefArea> {
  const checked = async (page: number) => {
    const block = await read(page);
    if (!Array.isArray(block) || block.length !== NTAG_READ_BYTES || block.some((b) => !Number.isInteger(b) || b < 0 || b > 0xff)) {
      throw nfcFailure("NFC_READBACK");
    }
    return block;
  };
  const cc = parseCapabilityContainer((await checked(3)).slice(0, 4), model);
  const data: number[] = [];
  async function byte(index: number): Promise<number> {
    if (index < 0 || index >= cc.dataBytes) throw nfcFailure("NFC_FOREIGN"); // TLV hors de la zone de données
    while (data.length <= index) {
      const block = await checked(NTAG_FIRST_DATA_PAGE + data.length / NTAG_PAGE_BYTES);
      data.push(...block.slice(0, Math.min(NTAG_READ_BYTES, cc.dataBytes - data.length)));
    }
    return data[index];
  }
  let offset = 0;
  while (offset < cc.dataBytes) {
    const type = await byte(offset);
    if (type === 0x00) { offset += 1; continue; }
    if (type === 0xfe) return { cc, message: [] }; // fin sans message NDEF : puce vide
    const size = await length(byte, offset + 1);
    const start = offset + 1 + size.size;
    if (start + size.value > cc.dataBytes) throw nfcFailure("NFC_FOREIGN");
    if (type === 0x03) {
      const message: number[] = [];
      for (let i = 0; i < size.value; i++) message.push(await byte(start + i));
      return { cc, message };
    }
    if (type !== 0x01 && type !== 0x02 && type !== 0xfd) throw nfcFailure("NFC_FOREIGN");
    offset = start + size.value;
  }
  return { cc, message: [] };
}
