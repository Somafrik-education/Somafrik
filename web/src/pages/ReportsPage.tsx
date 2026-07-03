import { MVP_COVERAGE } from "../lib/constants";
import { Card, SectionHeader } from "../components/ui/Card";
import { Badge, StatusBadge } from "../components/ui/Badge";
import { Table, type Column } from "../components/ui/Table";

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
      <Card className="p-6">
        <SectionHeader
          title="Conformité MVP"
          description="Couverture fonctionnelle de référence de la plateforme Somafrik."
        />
        <div className="mt-4">
          <Table columns={columns} rows={rows} rowKey={(r) => r.module} />
        </div>
      </Card>
    </div>
  );
}
