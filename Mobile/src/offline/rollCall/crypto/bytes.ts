/**
 * NFC-PRES-LOCAL-PR2 — octets, UTF-8, hexadécimal et base64url sans `Buffer` ni `TextEncoder`.
 *
 * Hermes (moteur de l'APK) ne fournit ni `Buffer` ni `node:crypto`. Ces fonctions ne dépendent
 * d'aucune API de l'environnement : elles produisent les mêmes octets sous Node et sous Hermes.
 *
 * UTF-8 strict : une chaîne UTF-16 mal formée (surrogate isolé) est refusée. Sans ce refus,
 * "\ud800" et "�" donneraient les mêmes octets (`efbfbd`), donc la même empreinte (PR0 §3.2).
 * Aucune normalisation Unicode : les chaînes sont encodées telles quelles (vecteur J-2).
 */

export class RollCallBytesError extends TypeError {
  readonly code = "RC_OFFLINE_BYTES_INVALID";
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const HEX = "0123456789abcdef";

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0x0f];
  return out;
}

/** Hexadécimal minuscule strict, longueur paire. */
export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
    throw new RollCallBytesError("Hexadécimal invalide.");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64URL_INDEX: Record<string, number> = {};
for (let i = 0; i < B64URL.length; i += 1) B64URL_INDEX[B64URL[i]] = i;

/** base64url sans remplissage (RFC 4648 §5). */
export function base64urlEncode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63];
  }
  return out;
}

/**
 * Décodage base64url strict : alphabet URL uniquement, sans remplissage, et encodage canonique
 * (bits de remplissage nuls). Une seule forme textuelle est acceptée pour une valeur donnée.
 */
export function base64urlDecode(text: string): Uint8Array {
  if (typeof text !== "string" || text.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(text)) {
    throw new RollCallBytesError("base64url invalide.");
  }
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i += 1) {
    buffer = (buffer << 6) | B64URL_INDEX[text[i]];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }
  if (buffer !== 0) throw new RollCallBytesError("base64url non canonique.");
  const bytes = Uint8Array.from(out);
  if (base64urlEncode(bytes) !== text) throw new RollCallBytesError("base64url non canonique.");
  return bytes;
}

/** base64 standard (RFC 4648 §4, avec remplissage) : sert uniquement à lire l'en-tête d'un fichier. */
export function base64StdDecode(text: string): Uint8Array {
  const value = String(text ?? "").replace(/\s+/g, "");
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new RollCallBytesError("base64 invalide.");
  const unpadded = value.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < unpadded.length; i += 1) {
    buffer = (buffer << 6) | B64URL_INDEX[unpadded[i]];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

/** Comparaison à durée indépendante du contenu (longueurs publiques). */
export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}
