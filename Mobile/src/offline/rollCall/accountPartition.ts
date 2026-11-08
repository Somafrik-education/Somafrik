/**
 * NFC-PR2 — account-scoped filename/key derivation.
 * Keystore and cryptographic hash are injected to keep this module testable.
 * Device salt MUST be 32 random bytes from SecureStore; never from Math.random.
 */
import { lp } from "./jcs";

export type Sha256Async = (bytes: Uint8Array) => Promise<Uint8Array>;
export type RollCallAccount = { environmentId: string; userId: string; schoolId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64url(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += ALPHABET[a >> 2];
    result += ALPHABET[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) result += ALPHABET[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) result += ALPHABET[c & 63];
  }
  return result;
}

function join(first: Uint8Array, second: Uint8Array): Uint8Array {
  const result = new Uint8Array(first.length + second.length);
  result.set(first, 0);
  result.set(second, first.length);
  return result;
}

export async function hmacSha256(
  key: Uint8Array, message: Uint8Array, sha256: Sha256Async,
): Promise<Uint8Array> {
  const normalized = key.length > 64 ? await sha256(key) : key;
  if (normalized.length > 64) throw new Error("RC_HMAC_KEY_INVALID");
  const block = new Uint8Array(64);
  block.set(normalized);
  const inner = block.map((v) => v ^ 0x36);
  const outer = block.map((v) => v ^ 0x5c);
  const innerHash = await sha256(join(inner, message));
  if (innerHash.length !== 32) throw new Error("RC_SHA256_INVALID");
  const digest = await sha256(join(outer, innerHash));
  if (digest.length !== 32) throw new Error("RC_SHA256_INVALID");
  return digest;
}

export async function resolveRollCallAccount(
  account: RollCallAccount, deviceSalt: Uint8Array, sha256: Sha256Async,
): Promise<{ accountId: string; fileName: string; keyName: string }> {
  if (!/^[a-z0-9-]{1,80}$/.test(account.environmentId) ||
      !UUID.test(account.userId) || !UUID.test(account.schoolId) ||
      deviceSalt.length !== 32) {
    throw new Error("RC_ACCOUNT_SCOPE_INVALID");
  }
  const digest = await hmacSha256(
    deviceSalt,
    lp(["somafrik.rc-offline.account.v1", account.environmentId, account.userId, account.schoolId]),
    sha256,
  );
  // PR0 §5.2 [0..22] = inclusive indices, 23 base64url characters.
  const accountId = base64url(digest).slice(0, 23);
  return {
    accountId,
    fileName: "somafrik-rollcall-v1-" + account.environmentId + "-" + accountId + ".db",
    keyName: "somafrik.rollCallDbKeyV1." + account.environmentId + "." + accountId,
  };
}
