import { EntityPage } from "../EntityPage";

/**
 * D3.3 — Liste des Enseignants (métier).
 *
 * Consommatrice de l’infrastructure D2.7 (même modèle que D3.2b Classes) :
 * `EntityPage` compose `EntityListShell` → `ListLayout`,
 * `EntityListSearch`, `EntityListTable`, `EntityListForbidden`, `InlineAlert`, `EmptyState`.
 *
 * Aucune logique métier ici — délégation stricte à `EntityPage entity="teachers"`.
 */
export function TeachersListPage() {
  return <EntityPage entity="teachers" />;
}
