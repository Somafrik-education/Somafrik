import { Table, type TableProps } from "../../data-display/Table";

/**
 * EntityListTable — defaults liste métier EntityPage (D2.7).
 * Tri + pagination client 25 (comportement historique EntityPage).
 * Aucune logique métier : colonnes / rows fournis par l’appelant.
 */
export type EntityListTableProps<T> = TableProps<T>;

export function EntityListTable<T>({
  sortable = true,
  pageSize = 25,
  emptyLabel = "Aucune donnée à afficher.",
  ...props
}: EntityListTableProps<T>) {
  return (
    <Table
      sortable={sortable}
      pageSize={pageSize}
      emptyLabel={emptyLabel}
      {...props}
    />
  );
}
