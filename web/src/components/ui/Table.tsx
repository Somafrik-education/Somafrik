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

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  emptyLabel?: string;
  onRowClick?: (row: T) => void;
  /** Active le tri par clic sur les en-têtes de colonnes (WEB-ME-002). */
  sortable?: boolean;
  /** Active la pagination client avec la taille de page indiquée (WEB-ME-002). */
  pageSize?: number;
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

export function Table<T>({
  columns,
  rows,
  rowKey,
  emptyLabel = "Aucune donnée à afficher.",
  onRowClick,
  sortable = false,
  pageSize,
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

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              {columns.map((col) => {
                const canSort = sortable && col.sortable !== false;
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={canSort ? () => toggleSort(col) : undefined}
                    className={`px-4 py-3 font-semibold ${alignClass(col.align)} ${
                      canSort ? "cursor-pointer select-none hover:text-ink" : ""
                    } ${col.className ?? ""}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {canSort ? (
                        <span className="text-[10px] text-muted">
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
                    <td key={col.key} className={`px-4 py-3 text-ink ${alignClass(col.align)} ${col.className ?? ""}`}>
                      {col.render ? col.render(row) : ((row as Record<string, unknown>)[col.key] as ReactNode) ?? "—"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
