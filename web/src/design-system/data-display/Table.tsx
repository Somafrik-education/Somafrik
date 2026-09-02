import { useMemo, useState, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  /** Désactive le tri sur cette colonne (si le tableau est triable). */
  sortable?: boolean;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  emptyLabel?: string;
  onRowClick?: (row: T) => void;
  /** Active le tri par clic sur les en-têtes de colonnes. */
  sortable?: boolean;
  /** Active la pagination client avec la taille de page indiquée. */
  pageSize?: number;
  /** Cartes empilées sous `md` (listes Finance / petits viewports). */
  stackOnMobile?: boolean;
}

function alignClass(align?: "left" | "right" | "center") {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

function compareValues(a: unknown, b: unknown): number {
  const av = a ?? "";
  const bv = b ?? "";
  const an = Number(av);
  const bn = Number(bv);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && String(av).trim() !== "" && String(bv).trim() !== "") {
    return an - bn;
  }
  return String(av).localeCompare(String(bv), "fr", { numeric: true });
}

/**
 * Table — collection tabulaire (P-002).
 * Parité API avec `components/ui/Table` (coexistence via re-export).
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  emptyLabel = "Aucune donnée à afficher.",
  onRowClick,
  sortable = false,
  pageSize,
  stackOnMobile = false,
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const sortedRows = useMemo(() => {
    if (!sortable || !sortKey) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      const result = compareValues(av, bv);
      return sortDir === "asc" ? result : -result;
    });
    return copy;
  }, [rows, sortable, sortKey, sortDir]);

  const totalPages = pageSize ? Math.max(1, Math.ceil(sortedRows.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = pageSize
    ? sortedRows.slice(safePage * pageSize, safePage * pageSize + pageSize)
    : sortedRows;

  function toggleSort(col: Column<T>) {
    if (!sortable || col.sortable === false) return;
    if (sortKey === col.key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("asc");
    }
    setPage(0);
  }

  const table = (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
          {columns.map((col) => {
            const canSort = sortable && col.sortable !== false;
            const active = sortKey === col.key;
            return (
              <th
                key={col.key}
                scope="col"
                onClick={canSort ? () => toggleSort(col) : undefined}
                aria-sort={
                  canSort && active ? (sortDir === "asc" ? "ascending" : "descending") : undefined
                }
                className={`px-4 py-3 font-semibold ${alignClass(col.align)} ${
                  canSort ? "cursor-pointer select-none hover:text-ink" : ""
                } ${col.className ?? ""}`}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {canSort ? (
                    <span className="text-[10px] text-muted" aria-hidden>
                      {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  ) : null}
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {pagedRows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="px-4 py-10 text-center text-muted">
              {emptyLabel}
            </td>
          </tr>
        ) : (
          pagedRows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-line/70 last:border-0 ${
                onRowClick ? "cursor-pointer hover:bg-brand-50/40" : ""
              }`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-4 py-3 text-ink ${alignClass(col.align)} ${col.className ?? ""}`}
                >
                  {col.render
                    ? col.render(row)
                    : (((row as Record<string, unknown>)[col.key] as ReactNode) ?? "—")}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  const cards =
    stackOnMobile && pagedRows.length ? (
      <div className="space-y-3 md:hidden">
        {pagedRows.map((row, index) => (
          <article
            key={rowKey(row, index)}
            className={`rounded-xl border border-line bg-white p-4 ${
              onRowClick ? "cursor-pointer hover:bg-brand-50/40" : ""
            }`}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            <dl className="space-y-2 text-sm">
              {columns
                .filter((col) => col.key !== "actions")
                .map((col) => (
                  <div key={col.key} className="flex items-start justify-between gap-3">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {col.header}
                    </dt>
                    <dd className={`min-w-0 text-right font-semibold text-ink ${col.className ?? ""}`}>
                      {col.render
                        ? col.render(row)
                        : (((row as Record<string, unknown>)[col.key] as ReactNode) ?? "—")}
                    </dd>
                  </div>
                ))}
            </dl>
            {columns.some((col) => col.key === "actions") ? (
              <div className="mt-3 border-t border-line/70 pt-3">
                {columns.find((col) => col.key === "actions")?.render?.(row)}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    ) : null;

  return (
    <div className="space-y-3">
      {cards}
      <div className={stackOnMobile ? "hidden overflow-x-auto md:block" : "overflow-x-auto"}>{table}</div>
      {stackOnMobile && pagedRows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted md:hidden">{emptyLabel}</p>
      ) : null}

      {pageSize && sortedRows.length > pageSize ? (
        <div className="no-print flex items-center justify-between px-1 text-sm text-muted">
          <span>
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sortedRows.length)} sur{" "}
            {sortedRows.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-lg border border-line px-3 py-1 font-semibold text-ink disabled:opacity-40"
            >
              Précédent
            </button>
            <span className="text-xs">
              Page {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="rounded-lg border border-line px-3 py-1 font-semibold text-ink disabled:opacity-40"
            >
              Suivant
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
