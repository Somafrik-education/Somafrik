import { Navigate, useParams } from "react-router-dom";
import { EntityPage } from "../EntityPage";

/**
 * D3.2c — Membres / élèves d’une classe (métier).
 *
 * Consommatrice de l’infrastructure D2.7 (même modèle que D3.1b / D3.2b / D3.3) :
 * `EntityPage` compose `EntityListShell` → `ListLayout`,
 * `EntityListSearch`, `EntityListTable`, `EntityListForbidden`, `InlineAlert`, `EmptyState`.
 *
 * Spécificité : `classScope` filtre les élèves de la classe et expose
 * l’orientation « ← Retour aux classes » (DO-024) — logique déjà portée par EntityPage.
 *
 * Aucune logique métier ici — délégation stricte à
 * `EntityPage entity="students" classScope={…}`.
 */
export function ClassStudentsPage() {
  const { className = "" } = useParams();
  const decoded = decodeURIComponent(className).trim();

  if (!decoded) {
    return <Navigate to="/etablissement/classes" replace />;
  }

  return <EntityPage entity="students" classScope={decoded} />;
}
