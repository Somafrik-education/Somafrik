import { useMemo, useRef, useState } from "react";
import { Database, DatabaseBackup, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { canManageEstablishmentSettings } from "../../lib/permissions";
import { getScopedEntityRows, type SchoolEntityKey } from "../../lib/entityModules";
import { rowsToCsv, downloadCsv } from "../../lib/csv";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import type { BackOfficeState } from "../../types";

type Row = Record<string, unknown>;

const BACKUP_VERSION = 1;

interface DatasetConfig {
  key: SchoolEntityKey;
  label: string;
}

const DATASETS: DatasetConfig[] = [
  { key: "students", label: "Élèves" },
  { key: "teachers", label: "Enseignants" },
  { key: "classes", label: "Classes" },
  { key: "courses", label: "Matières" },
  { key: "assignments", label: "Affectations" },
  { key: "payments", label: "Paiements" },
  { key: "notes", label: "Notes" },
  { key: "presences", label: "Présences" },
  { key: "bulletins", label: "Bulletins" },
  { key: "documents", label: "Documents" },
];

/** Aplati les valeurs non primitives (objets/tableaux) pour un rendu CSV lisible. */
function toCsvValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return value as string | number | boolean;
}

/** Construit un jeu de colonnes générique à partir des clés présentes dans les lignes. */
function buildGenericExport(rows: Row[]): { rows: Row[]; columns: { key: string; header: string }[] } {
  const keys = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => keys.add(key)));
  const orderedKeys = Array.from(keys);
  const columns = orderedKeys.map((key) => ({ key, header: key }));
  const flatRows = rows.map((row) => {
    const flat: Row = {};
    orderedKeys.forEach((key) => {
      flat[key] = toCsvValue(row[key]);
    });
    return flat;
  });
  return { rows: flatRows, columns };
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Paramètres Données & sauvegarde — aperçu, export CSV, sauvegarde et restauration JSON. */
export function SettingsDataPage() {
  const { state, update } = useData();
  const { session } = useAuth();
  const ctx = usePermissionContext();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const canManage = canManageEstablishmentSettings(ctx);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const user = session?.user ?? null;
  const schoolCode = user?.schoolCode && user.schoolCode !== "*" ? user.schoolCode : "";

  const datasetRows = useMemo(() => {
    const map = new Map<SchoolEntityKey, Row[]>();
    DATASETS.forEach((dataset) => {
      map.set(dataset.key, getScopedEntityRows(dataset.key, user, state) as Row[]);
    });
    return map;
  }, [state, user]);

  function handleExportCsv(dataset: DatasetConfig) {
    const rows = datasetRows.get(dataset.key) ?? [];
    if (!rows.length) {
      showToast(`Aucune donnée à exporter pour « ${dataset.label} ».`, "error");
      return;
    }
    const { rows: flatRows, columns } = buildGenericExport(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`${dataset.key}-${stamp}`, rowsToCsv(flatRows, columns));
    showToast(`${rows.length} ligne(s) exportée(s).`, "success");
  }

  function handleBackup() {
    const backup = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      schoolCode: schoolCode || "*",
      exportedBy: user?.identifier ?? user?.firstName ?? "—",
      data: state,
    };
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadJson(`somafrik-sauvegarde-${schoolCode || "global"}-${stamp}`, backup);
    showToast("Sauvegarde JSON téléchargée.", "success");
  }

  function triggerRestore() {
    fileInputRef.current?.click();
  }

  async function handleRestoreFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      showToast("Fichier JSON invalide ou illisible.", "error");
      return;
    }

    const container = parsed as { data?: unknown; version?: number } | null;
    const candidate =
      container && typeof container === "object" && "data" in container ? container.data : parsed;

    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      showToast("Ce fichier ne correspond pas à une sauvegarde Somafrik.", "error");
      return;
    }

    const restoreState = candidate as Partial<BackOfficeState>;
    const summary = DATASETS.map((dataset) => {
      const rows = restoreState[dataset.key as keyof BackOfficeState];
      const count = Array.isArray(rows) ? rows.length : 0;
      return `${dataset.label} : ${count}`;
    }).join(" · ");

    const confirmed = await confirm({
      title: "Restaurer cette sauvegarde ?",
      description: `Les données actuelles seront remplacées par celles du fichier.\n\n${summary}\n\nCette action est irréversible.`,
      confirmLabel: "Restaurer",
      cancelLabel: "Annuler",
      tone: "danger",
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      await update(restoreState, { partial: false });
      showToast("Sauvegarde restaurée avec succès.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de la restauration.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand">
            <Database className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <div>
            <h2 className="text-lg font-bold text-ink">Aperçu des données</h2>
            <p className="text-sm text-muted">
              Volume de données{schoolCode ? ` de l'établissement ${schoolCode}` : ""}.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {DATASETS.map((dataset) => (
            <div key={dataset.key} className="rounded-xl border border-line bg-slate-50 p-4">
              <p className="text-2xl font-black text-ink">
                {(datasetRows.get(dataset.key) ?? []).length}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
                {dataset.label}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title="Exports Excel / CSV"
          description="Téléchargez chaque jeu de données au format CSV (compatible Excel)."
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {DATASETS.map((dataset) => {
            const count = (datasetRows.get(dataset.key) ?? []).length;
            return (
              <Button
                key={dataset.key}
                type="button"
                variant="secondary"
                onClick={() => handleExportCsv(dataset)}
                disabled={count === 0}
              >
                <FileSpreadsheet className="h-4 w-4" />
                {dataset.label} ({count})
              </Button>
            );
          })}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title="Sauvegarde & restauration"
          description="Exportez une sauvegarde complète au format JSON, ou restaurez un fichier existant."
        />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-5">
            <div className="flex items-center gap-2 text-brand">
              <DatabaseBackup className="h-5 w-5" strokeWidth={1.8} />
              <h3 className="text-sm font-black uppercase tracking-wide">Sauvegarde</h3>
            </div>
            <p className="mt-2 text-sm text-muted">
              Génère un fichier JSON horodaté contenant l'ensemble des données accessibles à votre
              compte. Conservez-le en lieu sûr.
            </p>
            <Button type="button" className="mt-4" onClick={handleBackup}>
              <Download className="h-4 w-4" />
              Télécharger la sauvegarde
            </Button>
          </div>

          <div className="rounded-xl border border-line p-5">
            <div className="flex items-center gap-2 text-danger">
              <Upload className="h-5 w-5" strokeWidth={1.8} />
              <h3 className="text-sm font-black uppercase tracking-wide">Restauration</h3>
            </div>
            <p className="mt-2 text-sm text-muted">
              Importez un fichier de sauvegarde Somafrik pour remplacer les données actuelles. Action
              irréversible, réservée à l'administrateur.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void handleRestoreFile(event)}
            />
            <Button
              type="button"
              variant="danger"
              className="mt-4"
              onClick={triggerRestore}
              disabled={!canManage || busy}
            >
              <Upload className="h-4 w-4" />
              {busy ? "Restauration…" : "Restaurer une sauvegarde"}
            </Button>
            {!canManage ? (
              <p className="mt-2 text-xs text-muted">
                Seul l'Admin School peut restaurer une sauvegarde.
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}
