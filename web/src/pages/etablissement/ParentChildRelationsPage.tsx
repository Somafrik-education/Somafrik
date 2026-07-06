import { EntityPage } from "../EntityPage";

/** Liaisons parent → élève dans Mon établissement. */
export function ParentChildRelationsPage() {
  return <EntityPage entity="relations" mode="parentChildRelations" />;
}
