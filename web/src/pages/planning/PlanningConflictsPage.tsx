import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, SectionHeader } from "../../components/ui/Card";
import { PrintButton } from "../../components/ui/PrintButton";
import { DataTable } from "../../components/ui/DataTable";
import { pedagogyApi } from "../../lib/pedagogyApi";
import { PLANNING_WEEKDAYS } from "../../lib/coursePlanning";

function weekdayLabel(value: number): string {
  return PLANNING_WEEKDAYS.find((row) => row.value === value)?.label ?? "—";
}

interface ConflictRow {
  slotId: string;
  className: string;
  subject: string;
  when: string;
  kind: string;
  message: string;
}

const columns: ColumnDef<ConflictRow>[] = [
  { accessorKey: "className", header: "Classe" },
  { accessorKey: "subject", header: "Cours" },
  { accessorKey: "when", header: "Créneau" },
  {
    accessorKey: "kind",
    header: "Type",
    cell: ({ getValue }) => {
      const kind = String(getValue() ?? "");
      const labels: Record<string, string> = {
        class: "Conflit classe",
        teacher: "Conflit enseignant",
        room: "Conflit salle",
        substitute: "Conflit remplaçant",
        capacity: "Capacité insuffisante",
      };
      return labels[kind] || kind;
    },
  },
  {
    accessorKey: "message",
    header: "Anomalie",
    enableSorting: false,
    cell: ({ getValue, row }) => (
      <span className={`inline-flex items-start gap-2 ${row.original.kind === "capacity" ? "text-amber-900" : "text-red-900"}`}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        {getValue<string>()}
      </span>
    ),
  },
];

export function PlanningConflictsPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [rows, setRows] = useState<ConflictRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    pedagogyApi
      .listPlanningDiagnostics()
      .then((result) => {
        if (cancelled) return;
        const items = Array.isArray(result.items) ? result.items : [];
        setRows(
          items.map((item) => ({
            slotId: String(item.slotId ?? ""),
            className: String(item.className ?? "—"),
            subject: String(item.subject ?? "—"),
            when: `${weekdayLabel(Number(item.dayOfWeek))} ${String(item.startTime ?? "")}–${String(item.endTime ?? "")}`,
            kind: String(item.kind ?? ""),
            message: String(item.message ?? ""),
          })),
        );
        setStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const issues = rows;

  return (
    <Card className="p-6" data-testid="planning-conflicts-page">
      <SectionHeader
        title="Conflits & diagnostic du planning"
        description={
          issues.length
            ? `${issues.length} anomalie(s) — vue de diagnostic, PostgreSQL reste l'autorité`
            : "Aucune anomalie détectée"
        }
        actions={issues.length ? <PrintButton documentTitle="Conflits du planning — Somafrik" /> : null}
      />

      <div className="mt-4">
        {status === "loading" ? (
          <p className="text-sm text-muted">Analyse des collisions…</p>
        ) : issues.length ? (
          <DataTable
            columns={columns}
            data={rows}
            emptyLabel="Aucune anomalie."
            initialSorting={[{ id: "className", desc: false }]}
          />
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-16 text-center">
            <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-600" />
            <h3 className="text-lg font-black text-ink">Planning cohérent</h3>
            <p className="mt-1 max-w-md text-sm text-muted">
              Les collisions classe / enseignant / salle / remplaçant sont empêchées par PostgreSQL.
              Cette page n&apos;est qu&apos;un diagnostic.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
