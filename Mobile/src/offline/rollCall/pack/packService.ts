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
 * État local de sécurité (liste de révocation, horloge de confiance) absent ou illisible : refus
 * explicite (`RC_PACK_REVOCATIONS_STATE_CORRUPT`, `RC_TRUSTED_TIME_STATE_CORRUPT`), aucun état
 * vide de remplacement, aucune écriture.
 *
 * Rechargement (`loadUsablePack`) : le texte stocké est re-vérifié intégralement à CHAQUE chargement
 * (corruption, révocation survenue entre-temps, expiration). Échec → pack supprimé, mode dégradé.
 */
import {
  RC_LOCAL_STATE_ERROR,
  loadLastTrustedTime,
  loadRevocationState,
  recordTrustedTime,
  saveRevocationState,
} from "../store/accountManager";
import { deletePack, readStoredPackText, storePack, type RcContext } from "../store/repository";
import { parseHttpDate } from "./clock";
import type { PackKeyring } from "./keyring";
import {
  PACK_ERROR,
  parsePackEnvelopeText,
  verifyDownloadedPack,
  verifyPackEnvelope,
  type PackErrorCode,
  type PackExpectation,
  type VerifiedPack,
} from "./verifyPack";

export type PackAcceptance = { ok: true; verified: VerifiedPack } | { ok: false; code: PackErrorCode };

/**
 * État local de sécurité illisible (révocations, horloge de confiance) : refus explicite, jamais
 * de valeur par défaut. Les autres erreurs (disque, corruption SQLite…) remontent telles quelles.
 */
function localStateRefusal(error: unknown): PackAcceptance | null {
  const code = (error as { code?: string })?.code;
  if (code === RC_LOCAL_STATE_ERROR.REVOCATIONS_CORRUPT) return { ok: false, code: PACK_ERROR.REVOCATIONS_STATE_CORRUPT };
  if (code === RC_LOCAL_STATE_ERROR.TRUSTED_TIME_CORRUPT) return { ok: false, code: PACK_ERROR.TRUSTED_TIME_STATE_CORRUPT };
  return null;
}

async function failClosedOnLocalState(run: () => Promise<PackAcceptance>): Promise<PackAcceptance> {
  try {
    return await run();
  } catch (error) {
    const refusal = localStateRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}

export async function acceptDownloadedPack(
  ctx: RcContext,
  input: { keyring: PackKeyring; envelopeText: string; expected: PackExpectation; httpDateHeader?: string | null },
): Promise<PackAcceptance> {
  return failClosedOnLocalState(async () => {
    // Lecture stricte de l'état de sécurité AVANT toute écriture : état illisible → refus, rien d'écrit.
    const storedRevocations = await loadRevocationState(ctx);
    await loadLastTrustedTime(ctx);
    const lastTrusted = await recordTrustedTime(ctx, parseHttpDate(input.httpDateHeader ?? null));
    const parsed = parsePackEnvelopeText(input.envelopeText);
    if (!parsed.ok) return parsed;
    const { result, revocations } = verifyDownloadedPack(parsed.envelope, {
      keyring: input.keyring,
      revocations: storedRevocations,
      expected: input.expected,
      nowMs: ctx.nowMs(),
      lastTrustedTimeMs: lastTrusted,
      purpose: "store",
    });
    // Révocations d'abord (sens fail-closed si un arrêt survient avant le stockage du pack).
    if (revocations !== storedRevocations) await saveRevocationState(ctx, revocations);
    if (!result.ok) return result;
    const pack = result.verified.pack;
    await storePack(ctx, { packId: pack.packId, classId: pack.classId, date: pack.date, expiresAt: pack.expiresAt, envelopeText: input.envelopeText });
    await recordTrustedTime(ctx, result.verified.issuedAtMs);
    return result;
  });
}

export async function loadUsablePack(
  ctx: RcContext,
  input: { keyring: PackKeyring; packId: string; expected: PackExpectation },
): Promise<PackAcceptance> {
  return failClosedOnLocalState(async () => {
    // État de sécurité illisible : refus SANS supprimer le pack (le pack n'est pas en cause).
    const revocations = await loadRevocationState(ctx);
    const lastTrustedTimeMs = await loadLastTrustedTime(ctx);
    const text = await readStoredPackText(ctx, input.packId);
    if (text == null) return { ok: false, code: PACK_ERROR.JSON_INVALID };
    const parsed = parsePackEnvelopeText(text);
    const result = parsed.ok
      ? verifyPackEnvelope(parsed.envelope, {
          keyring: input.keyring,
          revocations,
          expected: input.expected,
          nowMs: ctx.nowMs(),
          lastTrustedTimeMs,
          purpose: "use",
        })
      : parsed;
    if (!result.ok) await deletePack(ctx, input.packId);
    return result;
  });
}
