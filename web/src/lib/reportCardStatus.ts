/**
 * BULLETIN-UX-02 — libellés français des statuts de bulletin, PAR SOURCE.
 *
 * Deux systèmes coexistent et n'ont pas le même contrat :
 *  - « legacy » : table `report_cards` (GET /api/report-cards, module Bulletins
 *    historique) — contrainte SQL `draft | generated | published | archived`.
 *    `generated` signifie « généré », JAMAIS « publié ».
 *  - « canonical » : snapshots officiels (`verification_status`) —
 *    `ACTIVE | SUPERSEDED | REVOKED` ; ACTIVE = bulletin publié en vigueur.
 *  - « draft » : état d'un brouillon calculé (aperçu) — `COMPLETE | INCOMPLETE`.
 *
 * Affichage uniquement : la valeur Backend n'est jamais réécrite (exports,
 * filtres et API gardent le statut métier d'origine). Une valeur inconnue est
 * affichée telle quelle plutôt que traduite arbitrairement.
 */

export type ReportCardStatusSource = "legacy" | "canonical" | "draft";

const LABELS: Record<ReportCardStatusSource, Record<string, string>> = {
  legacy: {
    draft: "Brouillon",
    generated: "Généré",
    published: "Publié",
    archived: "Archivé",
  },
  canonical: {
    ACTIVE: "Publié",
    SUPERSEDED: "Remplacé",
    REVOKED: "Révoqué",
  },
  draft: {
    COMPLETE: "Complet",
    INCOMPLETE: "Incomplet",
  },
};

export function reportCardStatusLabel(source: ReportCardStatusSource, status: unknown): string {
  const raw = String(status ?? "").trim();
  if (!raw) return "—";
  const table = LABELS[source];
  const key = source === "legacy" ? raw.toLowerCase() : raw.toUpperCase();
  return table[key] ?? raw;
}
