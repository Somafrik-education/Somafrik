/**
 * NFC-PR2 — identifiants de fichier et de clé propres à un compte (PR0 §5.2).
 *
 * accountId = base64url(HMAC-SHA256(deviceSalt, LP("somafrik.rc-offline.account.v1",
 *                                                   environmentId, userId, schoolId)))[0..22]
 *
 * Convention déjà publiée sur cette PR et conservée : `[0..22]` est lu comme un intervalle INCLUSIF,
 * soit 23 caractères base64url (≈ 138 bits). Le sel d'appareil (32 octets aléatoires) vient de
 * SecureStore, jamais de Math.random. HMAC : @noble/hashes (même implémentation que les preuves),
 * plus de HMAC écrit à la main.
 */
import { base64urlEncode } from "./crypto/bytes";
import { UUID, hmacSha256 } from "./crypto/primitives";
import { lp } from "./jcs";
import { assertEnvironmentId, rcDbFileName, rcDbKeyName } from "./store/accountFiles";

export type RollCallAccount = { environmentId: string; userId: string; schoolId: string };

export const ACCOUNT_TAG = "somafrik.rc-offline.account.v1";
export const ACCOUNT_ID_LENGTH = 23;

function scopeError(): Error & { code: string } {
  return Object.assign(new Error("RC_ACCOUNT_SCOPE_INVALID"), { code: "RC_ACCOUNT_SCOPE_INVALID" });
}

export function deriveAccountId(deviceSalt: Uint8Array, account: RollCallAccount): string {
  if (!(deviceSalt instanceof Uint8Array) || deviceSalt.length !== 32) throw scopeError();
  try {
    assertEnvironmentId(account?.environmentId);
  } catch {
    throw scopeError();
  }
  if (typeof account.userId !== "string" || !UUID.test(account.userId)) throw scopeError();
  if (typeof account.schoolId !== "string" || !UUID.test(account.schoolId)) throw scopeError();
  const digest = hmacSha256(deviceSalt, lp([ACCOUNT_TAG, account.environmentId, account.userId, account.schoolId]));
  return base64urlEncode(digest).slice(0, ACCOUNT_ID_LENGTH);
}

export function resolveRollCallAccount(
  account: RollCallAccount,
  deviceSalt: Uint8Array,
): { accountId: string; fileName: string; keyName: string } {
  const accountId = deriveAccountId(deviceSalt, account);
  return {
    accountId,
    fileName: rcDbFileName(account.environmentId, accountId),
    keyName: rcDbKeyName(account.environmentId, accountId),
  };
}
