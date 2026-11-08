/**
 * NFC-PRES-LOCAL-PR2 — acceptation et rechargement des packs, avec état conservé dans la base du compte.
 *
 * Téléchargement (`acceptDownloadedPack`) :
 *   1. l'en-tête `Date` de la réponse HTTPS fait avancer `lastTrustedTime` (jamais reculer) ;
 *   2. la liste de révocation livrée avec le pack est appliquée (monotone) et conservée ;
 *   3. le pack est vérifié (signature, clé, portée, horloge) ; refusé → rien n'est stocké ;
 *   4. accepté → le texte ORIGINAL de la réponse est stocké tel quel, `issuedAt` fait avancer
 *      `lastTrustedTime`.
 *
 * Un pack préchargé la veille (avant `notBefore`) peut être stocké ; il n'est utilisable qu'à partir
 * de `notBefore` (contrôle de `loadUsablePack`).
 *
 * Rechargement (`loadUsablePack`) : le texte stocké est re-vérifié intégralement à CHAQUE chargement
 * (corruption, révocation survenue entre-temps, expiration). Échec → pack supprimé, mode dégradé.
 */
import {
  loadLastTrustedTime,
  loadRevocationState,
  recordTrustedTime,
  saveRevocationState,
} from "../store/accountManager";
import { deletePack, readStoredPackText, storePack, type RcContext } from "../store/repository";
import { parseHttpDate } from "./clock";
import type { PackKeyring } from "./keyring";
import {
  parsePackEnvelopeText,
  verifyDownloadedPack,
  verifyPackEnvelope,
  type PackErrorCode,
  type PackExpectation,
  type VerifiedPack,
} from "./verifyPack";

export type PackAcceptance = { ok: true; verified: VerifiedPack } | { ok: false; code: PackErrorCode };

export async function acceptDownloadedPack(
  ctx: RcContext,
  input: { keyring: PackKeyring; envelopeText: string; expected: PackExpectation; httpDateHeader?: string | null },
): Promise<PackAcceptance> {
  const lastTrusted = await recordTrustedTime(ctx, parseHttpDate(input.httpDateHeader ?? null));
  const parsed = parsePackEnvelopeText(input.envelopeText);
  if (!parsed.ok) return parsed;
  const storedRevocations = await loadRevocationState(ctx);
  const { result, revocations } = verifyDownloadedPack(parsed.envelope, {
    keyring: input.keyring,
    revocations: storedRevocations,
    expected: input.expected,
    nowMs: ctx.nowMs(),
    lastTrustedTimeMs: lastTrusted,
    purpose: "store",
  });
  if (revocations !== storedRevocations) await saveRevocationState(ctx, revocations);
  if (!result.ok) return result;
  const pack = result.verified.pack;
  await storePack(ctx, { packId: pack.packId, classId: pack.classId, date: pack.date, expiresAt: pack.expiresAt, envelopeText: input.envelopeText });
  await recordTrustedTime(ctx, result.verified.issuedAtMs);
  return result;
}

export async function loadUsablePack(
  ctx: RcContext,
  input: { keyring: PackKeyring; packId: string; expected: PackExpectation },
): Promise<PackAcceptance> {
  const text = await readStoredPackText(ctx, input.packId);
  if (text == null) return { ok: false, code: "RC_PACK_JSON_INVALID" };
  const parsed = parsePackEnvelopeText(text);
  const result = parsed.ok
    ? verifyPackEnvelope(parsed.envelope, {
        keyring: input.keyring,
        revocations: await loadRevocationState(ctx),
        expected: input.expected,
        nowMs: ctx.nowMs(),
        lastTrustedTimeMs: await loadLastTrustedTime(ctx),
        purpose: "use",
      })
    : parsed;
  if (!result.ok) {
    await deletePack(ctx, input.packId);
    return result;
  }
  return result;
}
