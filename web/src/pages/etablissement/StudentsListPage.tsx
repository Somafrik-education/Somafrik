import { EntityPage } from "../EntityPage";

/**
 * D3.1b — Liste des Élèves (métier).
 *
 * Consommatrice de l’infrastructure D2.7 (même modèle que D3.2b Classes / D3.3 Enseignants) :
 * `EntityPage` compose `EntityListShell` → `ListLayout`,
 * `EntityListSearch`, `EntityListTable`, `EntityListForbidden`, `InlineAlert`, `EmptyState`.
 *
 * Aucune logique métier ici — délégation stricte à `EntityPage entity="students"`.
 * La fiche / workspace (`StudentWorkspacePage`) reste hors périmètre (D3.1).
 */
export function StudentsListPage() {
  return <EntityPage entity="students" />;
}
