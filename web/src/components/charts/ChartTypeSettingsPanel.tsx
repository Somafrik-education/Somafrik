import { useEffect, useMemo, useState } from "react";
import { useData } from "../../context/DataContext";
import { Button } from "../ui/Button";
import { Card, SectionHeader } from "../ui/Card";
import { Field, Select } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { platformApi } from "../../lib/platformApi";
import {
  EMPTY_DASHBOARD_CHART_CONFIG,
  ESTABLISHMENT_CHART_CATALOG,
  PLATFORM_CHART_CATALOG,
  SUPERADMIN_CHART_TYPE_OPTIONS,
  formatChartTypeLabel,
  normalizeChartType,
  type ChartType,
  type DashboardChartConfig,
} from "../../lib/chartTypes";

function cloneConfig(config?: DashboardChartConfig): DashboardChartConfig {
  return {
    platform: { ...(config?.platform ?? {}) },
    establishment: { ...(config?.establishment ?? {}) },
  };
}

function CatalogSection({
  title,
  description,
  catalog,
  overrides,
  onChange,
}: {
  title: string;
  description: string;
  catalog: typeof PLATFORM_CHART_CATALOG;
  overrides: Record<string, ChartType>;
  onChange: (chartId: string, value: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-black text-ink">{title}</p>
        <p className="mt-1 text-xs font-semibold text-muted">{description}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {catalog.map((entry) => {
          const selected = overrides[entry.id] ?? "";
          const selectOptions = [
            { value: "", label: `Par défaut (${formatChartTypeLabel(entry.defaultType)})` },
            ...SUPERADMIN_CHART_TYPE_OPTIONS.map((option) => ({
              value: option.value,
              label: `${option.emoji} ${option.label}`,
            })),
          ];
          if (entry.defaultType === "gauge") {
            selectOptions.push({ value: "gauge", label: "⏱ Jauge (par défaut)" });
          }
          if (entry.defaultType === "bar-horizontal") {
            selectOptions.push({ value: "bar-horizontal", label: "📊 Barres horizontales (par défaut)" });
          }

          return (
            <Field key={entry.id} label={entry.title} htmlFor={`chart-type-${entry.id}`}>
              <Select
                id={`chart-type-${entry.id}`}
                value={selected}
                onChange={(event) => onChange(entry.id, event.target.value)}
                options={selectOptions}
              />
            </Field>
          );
        })}
      </div>
    </div>
  );
}

export function ChartTypeSettingsPanel() {
  const { state, refresh } = useData();
  const { showToast } = useToast();
  const [draft, setDraft] = useState(() => cloneConfig(state.dashboardChartConfig));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(cloneConfig(state.dashboardChartConfig));
  }, [state.dashboardChartConfig]);

  const hasChanges = useMemo(() => {
    const current = state.dashboardChartConfig ?? EMPTY_DASHBOARD_CHART_CONFIG;
    return JSON.stringify(current) !== JSON.stringify(draft);
  }, [draft, state.dashboardChartConfig]);

  function updateScope(scope: keyof DashboardChartConfig, chartId: string, rawValue: string) {
    setDraft((prev) => {
      const next = cloneConfig(prev);
      if (!rawValue) {
        delete next[scope][chartId];
        return next;
      }
      const normalized = normalizeChartType(rawValue);
      if (!normalized) return next;
      next[scope][chartId] = normalized;
      return next;
    });
  }

  async function handleSave() {
    setBusy(true);
    try {
      await platformApi.saveDashboardChartConfig(draft as unknown as Record<string, unknown>);
      await refresh();
      showToast("Types de graphiques enregistrés", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de l'enregistrement", "error");
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setDraft(cloneConfig(state.dashboardChartConfig));
  }

  function handleClearAll() {
    setDraft(cloneConfig(EMPTY_DASHBOARD_CHART_CONFIG));
  }

  return (
    <Card className="p-6">
      <SectionHeader
        title="Paramétrage des graphiques"
        description="Types de visualisation pour les tableaux de bord plateforme (/tableau-de-bord) et établissement (/etablissement)."
      />

      <div className="mt-6 space-y-8">
        <CatalogSection
          title="Tableau de bord plateforme"
          description="Graphiques visibles sur /tableau-de-bord (Super Admin, Admin Pays)."
          catalog={PLATFORM_CHART_CATALOG}
          overrides={draft.platform}
          onChange={(chartId, value) => updateScope("platform", chartId, value)}
        />

        <CatalogSection
          title="Tableau de bord établissement"
          description="Graphiques visibles sur /etablissement selon le profil du rôle connecté."
          catalog={ESTABLISHMENT_CHART_CATALOG}
          overrides={draft.establishment}
          onChange={(chartId, value) => updateScope("establishment", chartId, value)}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button type="button" onClick={() => void handleSave()} disabled={!hasChanges || busy}>
          {busy ? "Enregistrement…" : "Enregistrer les types"}
        </Button>
        <Button type="button" variant="secondary" onClick={handleReset} disabled={!hasChanges || busy}>
          Annuler
        </Button>
        <Button type="button" variant="ghost" onClick={handleClearAll} disabled={busy}>
          Réinitialiser tout
        </Button>
      </div>
    </Card>
  );
}
