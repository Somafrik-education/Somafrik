import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  emptyLabel?: string;
  onRowClick?: (row: T) => void;
}

function alignClass(align?: "left" | "right" | "center") {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  emptyLabel = "Aucune donnée à afficher.",
  onRowClick,
}: TableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            {columns.map((col) => (
              <th key={col.key} className={`px-4 py-3 font-semibold ${alignClass(col.align)} ${col.className ?? ""}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-muted">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
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
  );
}
