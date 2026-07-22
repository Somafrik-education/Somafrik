import { EntityPage } from "../EntityPage";

/**
 * D3.2b — Liste des Classes (métier).
 *
 * Consommatrice officielle de l’infrastructure D2.7 :
 * `EntityPage` compose déjà `EntityListShell` → `ListLayout`,
 * `EntityListSearch`, `EntityListTable`, `EntityListForbidden`, `InlineAlert`.
 *
 * Aucune logique métier ici — délégation stricte à `EntityPage entity="classes"`.
 */
export function ClassesListPage() {
  return <EntityPage entity="classes" />;
}
