import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Table, type Column } from "../components/ui/Table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/shadcn/card";
import { ErrorState, LoadingState } from "@/design-system";
import { formatDateTimeForDisplay } from "../lib/dates";
import { canReadView, hasBackOfficePermission } from "../lib/permissions";
import { usePermissionContext } from "../lib/usePermissionContext";
import {
  executeSchoolErasureRequest,
  exportSchoolData,
  listSchoolErasureRequests,
  type SchoolErasureExecutionResult,
  type SchoolErasureRequest,
} from "../lib/schoolComplianceApi";

type PrivacyLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; rows: SchoolErasureRequest[] };

function statusLabel(status: string): string {
  if (status === "pending") return "En attente";
  if (status === "processed") return "Traitée";
  if (status === "rejected") return "Rejetée";
  return status || "—";
}

function statusTone(status: string): "warning" | "success" | "danger" | "neutral" {
  if (status === "pending") return "warning";
  if (status === "processed") return "success";
  if (status === "rejected") return "danger";
  return "neutral";
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function SchoolComplianceDashboard() {
  const ctx = usePermissionContext();
  const canListPrivacy = hasBackOfficePermission(ctx, "Utilisateurs", "READ");
  const canExecutePrivacy = hasBackOfficePermission(ctx, "Utilisateurs", "UPDATE");
  const canExportSchoolData = canReadView(ctx, "dataExport");

  const [privacyState, setPrivacyState] = useState<PrivacyLoadState>(
    canListPrivacy ? { status: "loading" } : { status: "idle" },
  );
  const [pendingRequest, setPendingRequest] = useState<SchoolErasureRequest | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<SchoolErasureExecutionResult | null>(null);
  const [executionError, setExecutionError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportSuccess, setExportSuccess] = useState("");
  const executingRef = useRef(false);
  const exportingRef = useRef(false);

  const loadPrivacy = useCallback(async () => {
    if (!canListPrivacy) {
      setPrivacyState({ status: "idle" });
      return;
    }
    setPrivacyState({ status: "loading" });
    try {
      const rows = await listSchoolErasureRequests();
      const listed = Array.isArray(rows) ? rows : [];
      listed.sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
      setPrivacyState({ status: "success", rows: listed });
    } catch (error: unknown) {
      setPrivacyState({
        status: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : "Impossible de charger les demandes d’effacement.",
      });
    }
  }, [canListPrivacy]);

  useEffect(() => {
    void loadPrivacy();
  }, [loadPrivacy]);

  async function confirmExecute() {
    if (!pendingRequest || executingRef.current || !canExecutePrivacy) return;
    executingRef.current = true;
    setExecuting(true);
    setExecutionError("");
    try {
      const result = await executeSchoolErasureRequest(pendingRequest.id);
      setExecutionResult(result);
      setPendingRequest(null);
      await loadPrivacy();
    } catch (error: unknown) {
      setExecutionError(
        error instanceof Error && error.message
          ? error.message
          : "L’exécution de l’effacement a échoué.",
      );
    } finally {
      executingRef.current = false;
      setExecuting(false);
    }
  }

  async function handleExport() {
    if (!canExportSchoolData || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError("");
    setExportSuccess("");
    try {
      const payload = await exportSchoolData();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJson(`somafrik-export-donnees-${stamp}.json`, payload);
      setExportSuccess("Export des données établissement téléchargé.");
    } catch (error: unknown) {
      setExportError(
        error instanceof Error && error.message
          ? error.message
          : "L’export des données a échoué.",
      );
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  const columns: Column<SchoolErasureRequest>[] = useMemo(
    () => [
      {
        key: "requestCode",
        header: "Référence",
        render: (row) => <span className="font-semibold">{row.requestCode || "—"}</span>,
      },
      { key: "identifier", header: "Identifiant", render: (row) => row.identifier || "—" },
      { key: "contactEmail", header: "Email de contact", render: (row) => row.contactEmail || "—" },
      { key: "roleLabel", header: "Rôle", render: (row) => row.roleLabel || "—" },
      {
        key: "status",
        header: "Statut",
        render: (row) => <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>,
      },
      {
        key: "createdAt",
        header: "Date de demande",
        render: (row) => formatDateTimeForDisplay(row.createdAt) || "—",
      },
      {
        key: "processedAt",
        header: "Date de traitement",
        render: (row) => formatDateTimeForDisplay(row.processedAt) || "—",
      },
      {
        key: "actions",
        header: "Action",
        render: (row) =>
          canExecutePrivacy && row.status === "pending" ? (
            <Button
              size="sm"
              variant="danger"
              disabled={executing}
              onClick={() => {
                setExecutionError("");
                setPendingRequest(row);
              }}
            >
              Exécuter l’effacement
            </Button>
          ) : (
            <span className="text-sm text-muted">—</span>
          ),
      },
    ],
    [canExecutePrivacy, executing],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-1.5">
          <CardTitle className="text-lg">Conformité établissement</CardTitle>
          <CardDescription>
            Demandes d’effacement et export des données de votre établissement uniquement.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Demandes d’effacement</CardTitle>
          <CardDescription>Demandes de votre établissement, sans accès cross-school.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canListPrivacy ? (
            <p className="text-sm text-muted">
              Vous n’avez pas le droit de consulter les demandes d’effacement.
            </p>
          ) : null}

          {privacyState.status === "loading" ? (
            <LoadingState message="Chargement des demandes d’effacement…" />
          ) : null}

          {privacyState.status === "error" ? (
            <ErrorState title="Impossible de charger les demandes d’effacement" message={privacyState.message} />
          ) : null}

          {privacyState.status === "success" && privacyState.rows.length === 0 ? (
            <p className="text-sm text-muted">Aucune demande d’effacement.</p>
          ) : null}

          {privacyState.status === "success" && privacyState.rows.length > 0 ? (
            <Table columns={columns} rows={privacyState.rows} rowKey={(row) => row.id || row.requestCode} />
          ) : null}

          {executionResult ? (
            <div className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink" role="status">
              <p className="font-semibold">Demande traitée.</p>
              {executionResult.accountAnonymized ? <p>Le compte a été anonymisé.</p> : null}
              <p>Les sessions ont été révoquées{` (${executionResult.sessionsRevoked}).`}</p>
              {executionResult.schoolRecordsRetained ? (
                <p>Les données scolaires réglementaires sont conservées.</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canExportSchoolData ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Export des données</CardTitle>
            <CardDescription>
              Télécharge un fichier JSON de votre établissement. L’export n’est pas chargé automatiquement.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="secondary" disabled={exporting} onClick={() => void handleExport()}>
              {exporting ? "Export en cours…" : "Exporter les données"}
            </Button>
            {exportSuccess ? <p className="text-sm text-ink">{exportSuccess}</p> : null}
            {exportError ? (
              <ErrorState title="Impossible d’exporter les données" message={exportError} />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Journaux d’audit</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">
            Les journaux d’audit établissement ne sont pas encore exposés dans ce module.
          </p>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(pendingRequest)}
        title="Confirmer l’effacement"
        description="Cette action est définitive pour le compte visé."
        onClose={() => {
          if (!executing) setPendingRequest(null);
        }}
        footer={
          <>
            <Button variant="secondary" disabled={executing} onClick={() => setPendingRequest(null)}>
              Annuler
            </Button>
            <Button variant="danger" disabled={executing} onClick={() => void confirmExecute()}>
              {executing ? "Exécution…" : "Confirmer l’effacement"}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-ink">
          <p>Le compte sera anonymisé.</p>
          <p>Les sessions seront révoquées.</p>
          <p>Le dossier scolaire réglementaire sera conservé.</p>
          {executionError ? <p className="text-danger">{executionError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
