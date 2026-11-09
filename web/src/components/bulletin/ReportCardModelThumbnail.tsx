/**
 * BULLETIN-CATALOG-01 — vignette d'un modèle du catalogue.
 *
 * Rend le VRAI composant de présentation (même rendu que les bulletins publiés)
 * sur le bulletin d'exemple calculé par le serveur, réduit et non interactif.
 */
import { ReportCardPresentationTable } from "./ReportCardPresentationTable";
import type { ReportCardPresentation } from "../../lib/reportCardManagementApi";

export function ReportCardModelThumbnail({ view, label }: { view: ReportCardPresentation | null; label: string }) {
  if (!view) {
    return (
      <div className="flex h-52 items-center justify-center bg-slate-50 text-sm text-muted" role="img" aria-label={label}>
        Aperçu indisponible
      </div>
    );
  }
  return (
    <div
      className="relative h-52 overflow-hidden border-b border-line bg-slate-50"
      role="img"
      aria-label={label}
      data-testid="catalog-model-thumbnail"
    >
      <div className="pointer-events-none absolute left-3 top-3 w-[200%] origin-top-left scale-50 select-none" aria-hidden="true">
        <ReportCardPresentationTable view={view} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-slate-50 to-transparent" />
    </div>
  );
}
