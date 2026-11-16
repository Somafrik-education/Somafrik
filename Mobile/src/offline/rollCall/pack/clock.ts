/**
 * NFC-PRES-LOCAL-PR2 — horloge de confiance (PR0 §4.5).
 *
 * `lastTrustedTime` = maximum des `issuedAt` des packs vérifiés et des en-têtes `Date` des réponses
 * HTTPS du serveur. Il ne recule jamais. Le téléphone ne recalcule aucune borne avec son fuseau : il
 * compare des instants UTC signés par le serveur.
 */

/** Tolérance de retard de l'horloge appareil par rapport au dernier instant de confiance. */
export const CLOCK_SKEW_TOLERANCE_MS = 10 * 60 * 1000;

const IMF_FIXDATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** En-tête HTTP `Date` (IMF-fixdate, RFC 9110) → millisecondes, ou null si mal formé. */
export function parseHttpDate(value: unknown): number | null {
  if (typeof value !== "string" || !IMF_FIXDATE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Instant ISO-8601 UTC strict → millisecondes, ou null. */
export function parseIsoInstant(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Nouveau `lastTrustedTime` : jamais inférieur à l'ancien (monotone). */
export function advanceTrustedTime(current: number | null, candidate: number | null): number | null {
  if (candidate == null || !Number.isFinite(candidate)) return current;
  if (current == null) return candidate;
  return Math.max(current, candidate);
}

/** Vrai si l'horloge appareil est en retard de plus de 10 minutes sur le dernier instant de confiance. */
export function isDeviceClockBehind(nowMs: number, lastTrustedTimeMs: number | null): boolean {
  return lastTrustedTimeMs != null && nowMs < lastTrustedTimeMs - CLOCK_SKEW_TOLERANCE_MS;
}
