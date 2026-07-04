import { MVP_COVERAGE } from "../lib/constants";
import { Badge, StatusBadge } from "../components/ui/Badge";
import { PrintButton } from "../components/ui/PrintButton";
import { Table, type Column } from "../components/ui/Table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/shadcn/card";

interface CoverageRow {
  module: string;
  scope: string;
  status: string;
  priority: string;
}

const columns: Column<CoverageRow>[] = [
  { key: "module", header: "Module", render: (r) => <span className="font-semibold">{r.module}</span> },
  { key: "scope", header: "Portée" },
  {
    key: "priority",
    header: "Priorité",
    render: (r) => <Badge tone={r.priority === "P0" ? "danger" : "info"}>{r.priority}</Badge>,
  },
  { key: "status", header: "Statut", render: (r) => <StatusBadge status={r.status} /> },
];

export function ReportsPage() {
  const rows = MVP_COVERAGE as CoverageRow[];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-lg">Conformité MVP</CardTitle>
            <CardDescription>
              Couverture fonctionnelle de référence de la plateforme Somafrik.
            </CardDescription>
          </div>
          <PrintButton documentTitle="Conformité MVP — Somafrik" />
        </CardHeader>
        <CardContent>
          <Table columns={columns} rows={rows} rowKey={(r) => r.module} />
        </CardContent>
      </Card>
    </div>
  );
}
