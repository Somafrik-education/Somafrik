/**
 * NFC-PRES-LOCAL-PR2 — trousseau PUBLIC des clés de pack, embarqué dans l'APK, par environnement.
 *
 * Contrat : PR0 §4.2 et docs/student-card/NFC-PRES-LOCAL-PR1b-cles-pack.md.
 *  - uniquement des clés PUBLIQUES (32 octets, base64url) : aucune clé privée dans l'application ;
 *  - préproduction et production sont distinctes : l'APK d'un environnement ne contient que les clés
 *    de son environnement, donc un pack signé pour un autre environnement a un `keyId` inconnu ;
 *  - dès la première version, deux clés : `active` (signe) et `standby` (secours).
 *
 * État de cette PR : les clés de préproduction et de production n'ont pas encore été générées
 * (opération d'exploitation, hors dépôt). Les trousseaux sont donc VIDES : tout pack est refusé
 * (clé inconnue) et le mode dégradé s'applique. C'est le comportement fail-closed attendu ; les clés
 * publiques seront ajoutées ici avant l'activation de PR3, sur nouveau GO CTO.
 */
import { base64urlDecode } from "../crypto/bytes";

export const PACK_KEY_STATUSES = ["active", "standby", "retired", "revoked"] as const;
export type PackKeyStatus = (typeof PACK_KEY_STATUSES)[number];
export type PackKeyringEntry = { keyId: string; publicKey: string; status: PackKeyStatus };
export type PackKeyring = { environment: string; keys: readonly PackKeyringEntry[] };

export const PACK_KEY_ID = /^rc-pack-[a-z0-9][a-z0-9-]{0,47}$/;
const PUBLIC_KEY_B64URL = /^[A-Za-z0-9_-]{43}$/;
const MAX_KEYS = 16;

/** Trousseaux embarqués. Profil de build → clés publiques de cet environnement uniquement. */
export const EMBEDDED_PACK_KEYRINGS: Readonly<Record<string, readonly PackKeyringEntry[]>> = Object.freeze({
  development: Object.freeze([]),
  preview: Object.freeze([]),
  preproduction: Object.freeze([]),
  production: Object.freeze([]),
});

export class PackKeyringError extends Error {
  readonly code = "RC_PACK_KEYRING_INVALID";
}

/** Validation stricte d'un trousseau (mêmes règles que `parseKeyring` du Backend, sans clé active imposée). */
export function validatePackKeyring(environment: string, keys: readonly PackKeyringEntry[]): PackKeyring {
  if (typeof environment !== "string" || !/^[a-z]+$/.test(environment)) throw new PackKeyringError("Environnement invalide.");
  if (!Array.isArray(keys) || keys.length > MAX_KEYS) throw new PackKeyringError("Trousseau invalide.");
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  let active = 0;
  const validated = keys.map((entry) => {
    const { keyId, publicKey, status } = entry ?? ({} as PackKeyringEntry);
    if (typeof keyId !== "string" || !PACK_KEY_ID.test(keyId) || seenIds.has(keyId)) throw new PackKeyringError("keyId invalide.");
    if (typeof publicKey !== "string" || !PUBLIC_KEY_B64URL.test(publicKey) || seenKeys.has(publicKey)) {
      throw new PackKeyringError("Clé publique invalide.");
    }
    let raw: Uint8Array;
    try {
      raw = base64urlDecode(publicKey);
    } catch {
      throw new PackKeyringError("Clé publique invalide.");
    }
    if (raw.length !== 32) throw new PackKeyringError("Clé publique invalide.");
    if (!(PACK_KEY_STATUSES as readonly string[]).includes(status)) throw new PackKeyringError("Statut invalide.");
    if (status === "active") active += 1;
    seenIds.add(keyId);
    seenKeys.add(publicKey);
    return Object.freeze({ keyId, publicKey, status });
  });
  if (active > 1) throw new PackKeyringError("Plusieurs clés actives.");
  return Object.freeze({ environment, keys: Object.freeze(validated) });
}

/** Trousseau embarqué du profil de build. Profil inconnu → erreur (jamais le trousseau d'un autre). */
export function embeddedPackKeyring(releaseProfile: string): PackKeyring {
  const keys = Object.prototype.hasOwnProperty.call(EMBEDDED_PACK_KEYRINGS, releaseProfile)
    ? EMBEDDED_PACK_KEYRINGS[releaseProfile]
    : null;
  if (!keys) throw new PackKeyringError("Profil de build sans trousseau.");
  return validatePackKeyring(releaseProfile, keys);
}
