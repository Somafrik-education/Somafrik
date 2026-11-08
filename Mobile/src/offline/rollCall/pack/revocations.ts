/**
 * NFC-PRES-LOCAL-PR2 — liste de révocation des clés de pack, monotone (PR0 §4.2, PR1b §6).
 *
 * La liste arrive avec chaque pack : `{ list: { contractVersion, sequence, revokedKeyIds, issuedAt },
 * signature }`, signée par la clé active avec l'étiquette `somafrik.rc-offline.revocations.v1\n`.
 *
 * Règles (anti-rollback) :
 *  - une clé révoquée reste révoquée : l'état conservé est l'UNION de tous les `keyId` vus ;
 *  - la séquence conservée est le maximum vu ; une liste de séquence inférieure est refusée ;
 *  - une liste signée par une clé inconnue, révoquée ou mal signée est refusée ;
 *  - un refus ne modifie jamais l'état conservé.
 */
import { CONTRACT_VERSION, revocationsSigningMessage, verifyEd25519 } from "../crypto/primitives";
import { PACK_KEY_ID, type PackKeyring } from "./keyring";

export type RevocationState = { sequence: number; revokedKeyIds: readonly string[] };
export const EMPTY_REVOCATION_STATE: RevocationState = Object.freeze({ sequence: 0, revokedKeyIds: Object.freeze([]) });

export const REVOCATION_ERROR = Object.freeze({
  SHAPE: "RC_REVOCATIONS_INVALID",
  KEY_UNKNOWN: "RC_REVOCATIONS_KEY_UNKNOWN",
  KEY_REVOKED: "RC_REVOCATIONS_KEY_REVOKED",
  SIGNATURE: "RC_REVOCATIONS_SIGNATURE_INVALID",
  ROLLBACK: "RC_REVOCATIONS_ROLLBACK",
});
export type RevocationErrorCode = (typeof REVOCATION_ERROR)[keyof typeof REVOCATION_ERROR];

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

/** Une clé est révoquée si le trousseau embarqué OU l'état conservé le dit. */
export function isKeyRevoked(keyring: PackKeyring, state: RevocationState, keyId: string): boolean {
  const entry = keyring.keys.find((key) => key.keyId === keyId);
  return entry?.status === "revoked" || state.revokedKeyIds.includes(keyId);
}

export function normalizeRevocationState(raw: unknown): RevocationState {
  const value = raw as { sequence?: unknown; revokedKeyIds?: unknown } | null;
  const sequence = Number.isSafeInteger(value?.sequence) && (value?.sequence as number) >= 0 ? (value?.sequence as number) : 0;
  const ids = Array.isArray(value?.revokedKeyIds)
    ? (value?.revokedKeyIds as unknown[]).filter((id): id is string => typeof id === "string" && PACK_KEY_ID.test(id))
    : [];
  return Object.freeze({ sequence, revokedKeyIds: Object.freeze([...new Set(ids)].sort()) });
}

/**
 * Vérifie une liste reçue et renvoie le nouvel état (union, maximum). En cas de refus, `state`
 * est renvoyé inchangé avec le code d'erreur : l'appelant doit alors refuser le pack associé.
 */
export function applyRevocations(
  envelope: unknown,
  keyring: PackKeyring,
  state: RevocationState,
): { ok: true; state: RevocationState } | { ok: false; code: RevocationErrorCode; state: RevocationState } {
  const refuse = (code: RevocationErrorCode) => ({ ok: false as const, code, state });
  if (!hasExactKeys(envelope, ["list", "signature"])) return refuse(REVOCATION_ERROR.SHAPE);
  const { list, signature } = envelope;
  if (!hasExactKeys(list, ["contractVersion", "sequence", "revokedKeyIds", "issuedAt"])) return refuse(REVOCATION_ERROR.SHAPE);
  if (!hasExactKeys(signature, ["alg", "keyId", "value"])) return refuse(REVOCATION_ERROR.SHAPE);
  if (list.contractVersion !== CONTRACT_VERSION) return refuse(REVOCATION_ERROR.SHAPE);
  if (!Number.isSafeInteger(list.sequence) || (list.sequence as number) < 0) return refuse(REVOCATION_ERROR.SHAPE);
  if (typeof list.issuedAt !== "string" || !ISO_INSTANT.test(list.issuedAt) || Number.isNaN(Date.parse(list.issuedAt))) {
    return refuse(REVOCATION_ERROR.SHAPE);
  }
  const ids = list.revokedKeyIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !PACK_KEY_ID.test(id))) return refuse(REVOCATION_ERROR.SHAPE);
  for (let i = 1; i < ids.length; i += 1) if (!(ids[i - 1] < ids[i])) return refuse(REVOCATION_ERROR.SHAPE);
  if (ids.length > 0 && (list.sequence as number) < 1) return refuse(REVOCATION_ERROR.SHAPE);
  if (signature.alg !== "Ed25519" || typeof signature.keyId !== "string") return refuse(REVOCATION_ERROR.SHAPE);

  const signer = keyring.keys.find((key) => key.keyId === signature.keyId);
  if (!signer) return refuse(REVOCATION_ERROR.KEY_UNKNOWN);
  if (isKeyRevoked(keyring, state, signer.keyId)) return refuse(REVOCATION_ERROR.KEY_REVOKED);
  let message: Uint8Array;
  try {
    message = revocationsSigningMessage(list);
  } catch {
    return refuse(REVOCATION_ERROR.SHAPE);
  }
  if (!verifyEd25519(signature.value, message, signer.publicKey)) return refuse(REVOCATION_ERROR.SIGNATURE);
  if ((list.sequence as number) < state.sequence) return refuse(REVOCATION_ERROR.ROLLBACK);
  // Une liste ne peut pas révoquer la clé qui la signe : ce serait une liste incohérente.
  if ((ids as string[]).includes(signer.keyId)) return refuse(REVOCATION_ERROR.KEY_REVOKED);

  const union = [...new Set([...state.revokedKeyIds, ...(ids as string[])])].sort();
  return {
    ok: true,
    state: Object.freeze({ sequence: Math.max(state.sequence, list.sequence as number), revokedKeyIds: Object.freeze(union) }),
  };
}
