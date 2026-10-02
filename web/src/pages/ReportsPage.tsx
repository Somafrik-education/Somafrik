import { useEffect, useState } from "react";
import { MVP_COVERAGE } from "../lib/constants";
import { useAuth } from "../context/AuthContext";
import { isSuperAdminRole } from "../lib/orgHierarchy";
import { getPlatformCompliance, type PlatformCompliancePayload } from "../lib/platformComplianceApi";
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
import { ErrorState, LoadingState } from "@/design-system";

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

type PlatformLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: PlatformCompliancePayload };

function configuredLabel(configured: boolean, feminine = true): string {
  if (!configured) return "non confirmé";
  return feminine ? "configurée" : "configuré";
}

function protectionLabel(denied: boolean, whenDenied: string): string {
  return denied ? whenDenied : "Protection non confirmée";
}

function SchoolMvpCoverageFacade() {
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

function CapabilityRow({ label, configured, feminine = true }: { label: string; configured: boolean; feminine?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="text-sm font-semibold text-muted">{configuredLabel(configured, feminine)}</p>
    </div>
  );
}

function ProtectionRow({ denied, label }: { denied: boolean; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <p className="text-sm font-medium text-ink">{protectionLabel(denied, label)}</p>
    </div>
  );
}

function PlatformComplianceDashboard() {
  const [state, setState] = useState<PlatformLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getPlatformCompliance()
      .then((data) => {
        if (!cancelled) setState({ status: "success", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error && error.message
            ? error.message
            : "La conformité plateforme est temporairement indisponible.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-1.5">
          <CardTitle className="text-lg">Conformité plateforme</CardTitle>
          <CardDescription>
            Santé de gouvernance globale, sans donnée personnelle ni établissement.
          </CardDescription>
        </CardHeader>
      </Card>

      {state.status === "loading" ? (
        <LoadingState message="Chargement de la conformité plateforme…" />
      ) : null}

      {state.status === "error" ? (
        <ErrorState
          title="Impossible de charger la conformité plateforme"
          message={state.message}
        />
      ) : null}

      {state.status === "success" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Demandes d’effacement</CardTitle>
              <CardDescription>Comptages globaux uniquement, sans liste nominative.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Metric label="Total" value={state.data.privacyRequests.total} />
              <Metric label="En attente" value={state.data.privacyRequests.pending} />
              <Metric label="Traitées" value={state.data.privacyRequests.processed} />
              <Metric label="Rejetées" value={state.data.privacyRequests.rejected} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Confidentialité</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <CapabilityRow
                label="Politique confidentialité"
                configured={state.data.capabilities.privacyPolicy.configured}
              />
              <CapabilityRow
                label="Suppression de compte"
                configured={state.data.capabilities.accountDeletionPage.configured}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Droits des utilisateurs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <CapabilityRow
                label="Demande d’effacement"
                configured={state.data.capabilities.erasureRequestIntake.configured}
              />
              <CapabilityRow
                label="Auto-effacement"
                configured={state.data.capabilities.selfErasure.configured}
                feminine={false}
              />
              <CapabilityRow
                label="Export établissement"
                configured={state.data.capabilities.schoolDataExport.configured}
                feminine={false}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Protection des données établissement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <ProtectionRow
                denied={state.data.protections.auditLogsPlatformDenied}
                label="Journal établissement inaccessible plateforme"
              />
              <ProtectionRow
                denied={state.data.protections.schoolPrivacyRequestsPlatformDenied}
                label="Détail demandes inaccessible plateforme"
              />
              <ProtectionRow
                denied={state.data.protections.schoolPrivacyExecutionPlatformDenied}
                label="Exécution effacement école inaccessible plateforme"
              />
              <ProtectionRow
                denied={state.data.protections.schoolDataExportPlatformDenied}
                label="Export école inaccessible plateforme"
              />
              <ProtectionRow
                denied={state.data.protections.advancedReportsPlatformDenied}
                label="Rapports avancés école inaccessible plateforme"
              />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-black text-ink">{value}</p>
    </div>
  );
}

export function ReportsPage() {
  const { session } = useAuth();
  if (isSuperAdminRole(session?.user?.role)) {
    return <PlatformComplianceDashboard />;
  }
  return <SchoolMvpCoverageFacade />;
}
