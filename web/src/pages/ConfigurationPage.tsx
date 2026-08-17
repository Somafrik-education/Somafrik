import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ForbiddenState,
  FormField,
  FormLayout,
  Input,
  SectionHeader,
  Select,
  useToast,
} from "../design-system";
import { SchoolEducationActivationPanel } from "../components/SchoolEducationActivationPanel";
import { EvaluationTypesPanel } from "../components/EvaluationTypesPanel";
import { SchoolSubjectsPanel } from "../components/SchoolSubjectsPanel";
import { getSchoolAcademicLists } from "../lib/academicConfig";
import { ApiError } from "../api/client";
import { academicYearsApi, type AcademicYear } from "../lib/academicYearsApi";
import { schoolSettingsApi } from "../lib/schoolSettingsApi";
import {
  applySystemActivePeriod,
  coercePeriodMode,
  defaultPeriodsForMode,
  normalizeStoredPeriods,
  periodTypeLabel,
  serializePeriods,
  type AcademicPeriodRow,
  type PeriodMode,
} from "../lib/academicPeriods";
import { isSuperAdminRole } from "../lib/orgHierarchy";
import { isAllSchoolsSelection, resolveTargetSchoolCodes } from "../lib/activeSchool";
import { buildSchoolSelectOptions } from "../lib/superadminCrudPath";
import { canAccessSchoolBackOffice, canManageEstablishmentSettings } from "../lib/permissions";
import { useFeaturePermissions, usePermissionContext } from "../lib/usePermissionContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { displayRoleName, normalize } from "../lib/format";
import { establishmentRolesApi, type EstablishmentRole } from "../lib/establishmentRolesApi";

type SavingSection = "year" | "periods" | "evaluations" | "levels" | "tracks" | null;

/** Domaine de configuration affiché (hub Paramètres). Non défini = tout afficher. */
export type ConfigurationSection = "annee-scolaire" | "structure" | "roles-droits";

export function ConfigurationPage({ section }: { section?: ConfigurationSection } = {}) {
  const { session } = useAuth();
  const { state, invalidateDomains, ensureDomains } = useData();
  const ctx = usePermissionContext();
  const { showToast } = useToast();
  const user = session?.user ?? null;
  const {
    activeSchoolCode,
    activeSchool,
    availableSchools,
    requiresSelection,
  } = useActiveSchool();

  const [configTarget, setConfigTarget] = useState(
    () => activeSchoolCode || availableSchools[0]?.code || "",
  );

  useEffect(() => {
    if (!requiresSelection) return;
    setConfigTarget((current) => {
      if (isAllSchoolsSelection(current)) return current;
      const fallback = activeSchoolCode || availableSchools[0]?.code || "";
      if (!fallback) return current;
      if (!current || !availableSchools.some((item) => normalize(item.code) === normalize(current))) {
        return fallback;
      }
      return current;
    });
  }, [activeSchoolCode, availableSchools, requiresSelection]);

  const configSchool = isAllSchoolsSelection(configTarget)
    ? null
    : availableSchools.find((item) => normalize(item.code) === normalize(configTarget)) ?? null;

  const targetSchoolCodes = useMemo(
    () => resolveTargetSchoolCodes(configTarget, availableSchools.map((item) => item.code)),
    [configTarget, availableSchools],
  );
  const isBulkConfiguration = isAllSchoolsSelection(configTarget) && targetSchoolCodes.length >= 2;
  const academicConfig = (
    isBulkConfiguration ? {} : (state.academicConfigs?.[configTarget ?? ""] ?? {})
  ) as Record<string, unknown>;

  const [savingSection, setSavingSection] = useState<SavingSection>(null);
  const [academicFormKey, setAcademicFormKey] = useState(0);
  const [periodMode, setPeriodMode] = useState<PeriodMode>(() => coercePeriodMode(academicConfig.periodMode));
  const [periodRows, setPeriodRows] = useState<AcademicPeriodRow[]>(() =>
    normalizeStoredPeriods(academicConfig.periods, coercePeriodMode(academicConfig.periodMode)),
  );
  const [assignableRoles, setAssignableRoles] = useState<EstablishmentRole[]>([]);
  const [selectedCatalogueRoleId, setSelectedCatalogueRoleId] = useState("");
  const [rolesLoading, setRolesLoading] = useState(false);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [yearsLoading, setYearsLoading] = useState(false);
  const [yearDraft, setYearDraft] = useState({
    name: "",
    startDate: "",
    endDate: "",
    isCurrent: true,
  });

  const settingsPermissions = useFeaturePermissions("Paramètres Établissement");
  const yearPermissions = useFeaturePermissions("Années Académiques");
  const subjectPermissions = useFeaturePermissions("Matières");
  const canConfigure = canManageEstablishmentSettings(ctx);
  const canReadSettings = settingsPermissions.canRead || canConfigure;
  const canReadYears = yearPermissions.canRead || canReadSettings;
  const canCreateYears = yearPermissions.canCreate;
  const canUpdateYears = yearPermissions.canUpdate;
  const canDesignBulletins = isSuperAdminRole(user?.role);
  const selectedCatalogueRole = useMemo(
    () => assignableRoles.find((role) => role.id === selectedCatalogueRoleId) ?? assignableRoles[0] ?? null,
    [assignableRoles, selectedCatalogueRoleId],
  );

  const resolvedPeriodRows = useMemo(() => applySystemActivePeriod(periodRows), [periodRows]);
  const classNamesForSubjects = useMemo(() => {
    if (isBulkConfiguration) return [];
    return getSchoolAcademicLists(state, configTarget).classNames;
  }, [isBulkConfiguration, state.academicConfigs, configTarget]);
  useEffect(() => {
    setAcademicFormKey((current) => current + 1);
  }, [configTarget]);

  useEffect(() => {
    if (section && section !== "roles-droits") return;
    let cancelled = false;
    setRolesLoading(true);
    void establishmentRolesApi
      .listAssignable()
      .then((response) => {
        if (cancelled) return;
        const roles = Array.isArray(response.roles) ? response.roles : [];
        setAssignableRoles(roles);
        setSelectedCatalogueRoleId((current) => current || roles[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setAssignableRoles([]);
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, configTarget]);

  useEffect(() => {
    const mode = coercePeriodMode(academicConfig.periodMode);
    setPeriodMode(mode);
    setPeriodRows(normalizeStoredPeriods(academicConfig.periods, mode));
  }, [academicFormKey, configTarget]);

  useEffect(() => {
    if (!selectedCatalogueRoleId && assignableRoles.length) {
      setSelectedCatalogueRoleId(assignableRoles[0].id);
    } else if (
      selectedCatalogueRoleId &&
      assignableRoles.length &&
      !assignableRoles.some((role) => role.id === selectedCatalogueRoleId)
    ) {
      setSelectedCatalogueRoleId(assignableRoles[0]?.id ?? "");
    }
  }, [assignableRoles, selectedCatalogueRoleId]);

  useEffect(() => {
    if (section && section !== "annee-scolaire") return;
    if (!canReadYears) return;
    if (isAllSchoolsSelection(configTarget)) {
      setAcademicYears([]);
      return;
    }
    let cancelled = false;
    setYearsLoading(true);
    void academicYearsApi
      .list()
      .then((rows) => {
        if (cancelled) return;
        const scoped = (Array.isArray(rows) ? rows : []).filter((year) => {
          if (!configTarget) return true;
          return !year.schoolCode || year.schoolCode === configTarget;
        });
        setAcademicYears(scoped);
      })
      .catch(() => {
        if (!cancelled) setAcademicYears([]);
      })
      .finally(() => {
        if (!cancelled) setYearsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, configTarget, canReadYears, academicFormKey]);

  if (!canAccessSchoolBackOffice(user?.role)) {
    return (
      <Card className="p-6">
        <p className="text-sm font-semibold text-muted">
          La configuration établissement est réservée aux comptes internes d'une école.
        </p>
      </Card>
    );
  }

  if (requiresSelection && !configTarget && !availableSchools.length) {
    return (
      <Card className="p-6">
        <p className="text-sm font-semibold text-muted">
          Aucun établissement disponible dans votre périmètre. Créez ou validez un établissement avant de
          configurer.
        </p>
      </Card>
    );
  }

  function formatSettingsHttpError(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 400) return error.message || "Requête invalide.";
      if (error.status === 403) return "Vous n'avez pas le droit de modifier les paramètres d'établissement.";
      if (error.status === 404) return "Établissement ou période introuvable.";
      if (error.status === 409) return error.message || "Conflit : une période est encore utilisée.";
      if (error.status >= 500) return "Erreur serveur. Réessayez plus tard.";
      return error.message;
    }
    return error instanceof Error ? error.message : "Erreur inattendue.";
  }

  function scopedSettingsSchoolCode() {
    return isSuperAdminRole(user?.role) ? configTarget : undefined;
  }

  async function reloadAcademicYears() {
    const rows = await academicYearsApi.list();
    const scoped = (Array.isArray(rows) ? rows : []).filter((year) => {
      if (!configTarget) return true;
      return !year.schoolCode || year.schoolCode === configTarget;
    });
    setAcademicYears(scoped);
    return scoped;
  }

  async function handleCreateAcademicYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBulkConfiguration || isAllSchoolsSelection(configTarget)) {
      showToast("Sélectionnez un établissement précis avant de créer une année.", "error");
      return;
    }
    if (!canCreateYears) {
      showToast("Vous n'avez pas le droit de créer une année scolaire.", "error");
      return;
    }
    const name = yearDraft.name.trim();
    const startDate = yearDraft.startDate.trim();
    const endDate = yearDraft.endDate.trim();
    if (!name || !startDate || !endDate) {
      showToast("Nom, date de début et date de fin sont requis.", "error");
      return;
    }
    setSavingSection("year");
    try {
      await academicYearsApi.create({
        schoolCode: scopedSettingsSchoolCode(),
        name,
        startDate,
        endDate,
        isCurrent: yearDraft.isCurrent,
      });
      await reloadAcademicYears();
      setYearDraft({ name: "", startDate: "", endDate: "", isCurrent: true });
      setAcademicFormKey((current) => current + 1);
      showToast("Année scolaire créée.", "success");
    } catch (error) {
      showToast(formatSettingsHttpError(error), "error");
    } finally {
      setSavingSection(null);
    }
  }

  async function handleSetCurrentAcademicYear(yearId: string) {
    if (!canUpdateYears) {
      showToast("Vous n'avez pas le droit de modifier l'année courante.", "error");
      return;
    }
    setSavingSection("year");
    try {
      await academicYearsApi.update(yearId, { isCurrent: true });
      await reloadAcademicYears();
      setAcademicFormKey((current) => current + 1);
      showToast("Année courante mise à jour.", "success");
    } catch (error) {
      showToast(formatSettingsHttpError(error), "error");
    } finally {
      setSavingSection(null);
    }
  }

  async function handlePeriodsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBulkConfiguration || isAllSchoolsSelection(configTarget)) {
      showToast(
        "Sélectionnez un établissement précis. L'enregistrement multi-établissements n'est pas disponible sur cette API.",
        "error",
      );
      return;
    }
    const effectiveSchoolCode = String(configTarget ?? activeSchoolCode ?? "").trim();
    if (!effectiveSchoolCode || isAllSchoolsSelection(effectiveSchoolCode)) {
      showToast("Sélectionnez un établissement actif avant d'enregistrer.", "error");
      return;
    }
    if (!canConfigure) {
      showToast("Vous n'avez pas les droits pour modifier cette configuration.", "error");
      return;
    }
    if (!academicYears.length) {
      showToast("Créez une année scolaire avant d'enregistrer les périodes.", "error");
      return;
    }
    const form = new FormData(event.currentTarget);
    const periods = serializePeriods(periodRows, periodMode);
    if (!periods.length) {
      showToast("Ajoutez au moins une sous-période", "error");
      return;
    }
    const defaultScale = Number(form.get("defaultScale"));
    setSavingSection("periods");
    try {
      const schoolCode = scopedSettingsSchoolCode();
      await schoolSettingsApi.patch(
        {
          periodMode,
          defaultScale,
          ...(canDesignBulletins ? { reportCardMode: String(form.get("reportMode") ?? "period") } : {}),
        },
        schoolCode,
      );
      await schoolSettingsApi.replacePeriods(periods, schoolCode);
      invalidateDomains(["academicConfigs"], { schoolCode: effectiveSchoolCode });
      await ensureDomains(["academicConfigs"], { schoolCode: effectiveSchoolCode, force: true });
      showToast("Périodes et barème enregistrés", "success");
      setAcademicFormKey((current) => current + 1);
    } catch (error) {
      showToast(formatSettingsHttpError(error), "error");
    } finally {
      setSavingSection(null);
    }
  }

  function handlePeriodModeChange(nextMode: PeriodMode) {
    setPeriodMode(nextMode);
    setPeriodRows(defaultPeriodsForMode(nextMode));
  }

  function updatePeriodRow(index: number, patch: Partial<AcademicPeriodRow>) {
    setPeriodRows((current) => {
      const next = current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
      if (patch.startDate !== undefined || patch.endDate !== undefined) {
        return applySystemActivePeriod(next);
      }
      return next;
    });
  }

  function addCustomPeriod() {
    setPeriodRows((current) =>
      applySystemActivePeriod([
        ...current,
        {
          name: `${periodTypeLabel("periode")} ${current.length + 1}`,
          type: periodTypeLabel("periode"),
          startDate: "",
          endDate: "",
          active: false,
          order: current.length + 1,
        },
      ]),
    );
  }

  function removeCustomPeriod(index: number) {
    setPeriodRows((current) =>
      applySystemActivePeriod(
        current
          .filter((_, rowIndex) => rowIndex !== index)
          .map((row, rowIndex) => ({ ...row, order: rowIndex + 1 })),
      ),
    );
  }

  const showAcademicConfig = canConfigure || canReadSettings;
  const inSection = (target: ConfigurationSection) => !section || section === target;
  const hasRolesAccess = canReadSettings || canConfigure;

  if (section === "roles-droits" && !hasRolesAccess) {
    return (
      <ForbiddenState
        title="Accès non autorisé"
        message="Vous n'avez pas les droits nécessaires pour configurer les rôles et habilitations."
      />
    );
  }

  if ((section === "annee-scolaire" || section === "structure") && !showAcademicConfig) {
    return (
      <ForbiddenState
        title="Accès non autorisé"
        message="Vous n'avez pas les droits nécessaires pour accéder à la configuration de l'établissement."
      />
    );
  }

  if (!section && !showAcademicConfig && !hasRolesAccess) {
    return (
      <ForbiddenState
        title="Accès non autorisé"
        message="Vous n'avez pas les droits nécessaires pour accéder à la configuration de l'établissement."
      />
    );
  }

  return (
    <FormLayout>
      <FormLayout.Content>
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-slate-800 to-brand p-6 text-white">
        <p className="text-sm font-semibold text-white/75">Configuration</p>
        {requiresSelection && availableSchools.length >= 2 ? (
          <div className="mt-3 max-w-md">
            <FormField label="Établissement à configurer">
              <Select
                value={configTarget}
                onChange={(e) => setConfigTarget(e.target.value)}
                options={buildSchoolSelectOptions(availableSchools)}
              />
            </FormField>
          </div>
        ) : null}
        <h2 className="mt-3 text-2xl font-black">
          {isBulkConfiguration
            ? `Tous les établissements (${targetSchoolCodes.length})`
            : (configSchool?.name ?? activeSchool?.name ?? "Mon établissement")}
        </h2>
        <p className="mt-2 text-sm text-white/85">
          {isBulkConfiguration
            ? `Périmètre actif : ${targetSchoolCodes.length} établissement${targetSchoolCodes.length > 1 ? "s" : ""}`
            : configSchool
              ? `${configSchool.code} • ${configSchool.city ?? "Ville non renseignée"}`
              : "Code établissement : " + (configTarget ?? "—")}
        </p>
        <p className="mt-3 max-w-3xl text-sm text-white/80">
          {isBulkConfiguration
            ? "Chaque section enregistrée sera appliquée à tous les établissements de votre périmètre."
            : "Chaque section s'enregistre pour cet établissement uniquement. Modifiez puis cliquez sur Enregistrer."}
        </p>
      </Card>

      {hasRolesAccess && inSection("roles-droits") ? (
        <Card className="p-6">
          <SectionHeader
            title="Rôles affectables"
            description="Catalogue canonique géré par le Superadmin. Vous pouvez affecter ces rôles aux utilisateurs de votre établissement, sans modifier la politique globale."
          />
          {rolesLoading ? (
            <p className="mt-4 text-sm text-muted">Chargement du catalogue…</p>
          ) : assignableRoles.length ? (
            <div className="mt-4 space-y-4">
              <FormField label="Rôle">
                <Select
                  value={selectedCatalogueRole?.id ?? ""}
                  onChange={(e) => setSelectedCatalogueRoleId(e.target.value)}
                  options={assignableRoles.map((role) => ({
                    value: role.id,
                    label: displayRoleName(role.roleName),
                  }))}
                />
              </FormField>
              {selectedCatalogueRole ? (
                <div className="rounded-xl border border-line bg-slate-50/60 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-ink">{displayRoleName(selectedCatalogueRole.roleName)}</p>
                    <Badge tone="neutral">{selectedCatalogueRole.roleCode}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    Permissions accordées par le Superadmin (lecture seule).
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedCatalogueRole.permissions.length ? (
                      selectedCatalogueRole.permissions.map((permission) => (
                        <Badge key={permission} tone="info">
                          {permission}
                        </Badge>
                      ))
                    ) : (
                      <p className="text-sm text-muted">Aucune permission définie pour ce rôle.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState
              className="mt-4"
              title="Aucun rôle affectable"
              description="Le catalogue des rôles n'est pas encore disponible pour votre établissement."
            />
          )}
        </Card>
      ) : null}

      {showAcademicConfig && inSection("annee-scolaire") ? (
        <>
          <Card className="p-6">
            <SectionHeader
              title="Année scolaire / académique"
              description="Modèle unique academic_years. « Année scolaire » et « Année académique » sont des libellés d'écran, pas deux référentiels. La création se fait uniquement ici."
            />
            {yearsLoading ? (
              <p className="mt-4 text-sm text-muted">Chargement des années…</p>
            ) : academicYears.length ? (
              <ul className="mt-4 space-y-3">
                {academicYears.map((year) => (
                  <li
                    key={year.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-slate-50/60 p-4"
                  >
                    <div>
                      <p className="text-sm font-bold text-ink">{year.name}</p>
                      <p className="text-xs text-muted">
                        {year.startDate} → {year.endDate}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {year.isCurrent ? <Badge tone="info">Année courante</Badge> : <Badge tone="neutral">{year.status}</Badge>}
                      {canUpdateYears && !year.isCurrent ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={savingSection === "year"}
                          onClick={() => void handleSetCurrentAcademicYear(year.id)}
                        >
                          Définir comme courante
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                className="mt-4"
                title="Aucune année configurée"
                description="L'établissement n'a pas d'année scolaire. Créez-la ici avant les classes, les périodes, les notes et les bulletins. Aucune année n'est inventée automatiquement."
              />
            )}
            {canCreateYears && !isBulkConfiguration && !isAllSchoolsSelection(configTarget) ? (
              <form onSubmit={(event) => void handleCreateAcademicYear(event)} className="mt-6 space-y-4">
                <p className="text-sm font-bold text-ink">Créer une année</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <FormField label="Nom de l'année" htmlFor="academic-year-name">
                    <Input
                      id="academic-year-name"
                      value={yearDraft.name}
                      onChange={(e) => setYearDraft((current) => ({ ...current, name: e.target.value }))}
                      placeholder="2026-2027"
                      required
                    />
                  </FormField>
                  <FormField label="Début de l'année" htmlFor="academic-year-start">
                    <Input
                      id="academic-year-start"
                      type="date"
                      value={yearDraft.startDate}
                      onChange={(e) => setYearDraft((current) => ({ ...current, startDate: e.target.value }))}
                      required
                    />
                  </FormField>
                  <FormField label="Fin de l'année" htmlFor="academic-year-end">
                    <Input
                      id="academic-year-end"
                      type="date"
                      value={yearDraft.endDate}
                      onChange={(e) => setYearDraft((current) => ({ ...current, endDate: e.target.value }))}
                      required
                    />
                  </FormField>
                </div>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={yearDraft.isCurrent}
                    onChange={(e) => setYearDraft((current) => ({ ...current, isCurrent: e.target.checked }))}
                  />
                  Définir comme année courante
                </label>
                <Button type="submit" disabled={savingSection === "year"}>
                  {savingSection === "year" ? "Enregistrement…" : "Créer l'année"}
                </Button>
              </form>
            ) : null}
          </Card>

          <Card key={`periods-${academicFormKey}`} className="p-6">
            <SectionHeader
              title="Périodes et barème"
              description={
                canDesignBulletins
                  ? "Mode de période, sous-périodes, barème par défaut et mode de bulletin."
                  : "Mode de période, sous-périodes et barème par défaut."
              }
            />
            <form onSubmit={handlePeriodsSubmit} className="mt-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Mode de période">
                  <Select
                    value={periodMode}
                    onChange={(e) => handlePeriodModeChange(coercePeriodMode(e.target.value))}
                    options={[
                      { value: "trimestre", label: "Trimestre" },
                      { value: "semestre", label: "Semestre" },
                      { value: "periode", label: "Périodes personnalisées" },
                    ]}
                  />
                </FormField>
                <FormField label="Barème par défaut">
                  <Input
                    name="defaultScale"
                    type="number"
                    min={1}
                    defaultValue={academicConfig.defaultScale != null ? String(academicConfig.defaultScale) : ""}
                  />
                </FormField>
                {canDesignBulletins ? (
                  <FormField label="Mode bulletin">
                    <Select
                      name="reportMode"
                      defaultValue={String(academicConfig.reportCardMode ?? "period")}
                      options={[
                        { value: "period", label: "Par période" },
                        { value: "annual", label: "Annuel" },
                        { value: "custom", label: "Personnalisé" },
                      ]}
                    />
                  </FormField>
                ) : null}
              </div>

              <div className="rounded-xl border border-line bg-slate-50/60 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-ink">Sous-périodes</p>
                    <p className="text-xs text-muted">
                      {periodMode === "trimestre"
                        ? "3 trimestres par défaut — la période en cours s'active selon la date du jour."
                        : periodMode === "semestre"
                          ? "2 semestres par défaut — la période en cours s'active selon la date du jour."
                          : "Périodes personnalisées — activation automatique selon les dates saisies."}
                    </p>
                  </div>
                  {periodMode === "periode" ? (
                    <Button type="button" variant="secondary" size="sm" onClick={addCustomPeriod}>
                      Ajouter une sous-période
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {periodRows.map((row, index) => (
                    <div
                      key={`${periodMode}-${index}-${row.order}`}
                      className="grid gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                    >
                      <FormField label={`Nom (${periodTypeLabel(periodMode)} ${index + 1})`}>
                        <Input
                          value={row.name}
                          onChange={(e) => updatePeriodRow(index, { name: e.target.value })}
                          placeholder={`${periodTypeLabel(periodMode)} ${index + 1}`}
                        />
                      </FormField>
                      <FormField label="Date de début">
                        <Input
                          value={row.startDate}
                          onChange={(e) => updatePeriodRow(index, { startDate: e.target.value })}
                          placeholder="JJ-MM-AAAA"
                        />
                      </FormField>
                      <FormField label="Date de fin">
                        <Input
                          value={row.endDate}
                          onChange={(e) => updatePeriodRow(index, { endDate: e.target.value })}
                          placeholder="JJ-MM-AAAA"
                        />
                      </FormField>
                      <div className="flex items-end gap-2 pb-1">
                        {resolvedPeriodRows[index]?.active ? (
                          <Badge tone="info">En cours</Badge>
                        ) : (
                          <Badge tone="neutral">Inactive</Badge>
                        )}
                        {periodMode === "periode" && periodRows.length > 1 ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => removeCustomPeriod(index)}
                          >
                            Retirer
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {!academicYears.length ? (
                <p className="text-sm text-amber-900">
                  Impossible d'enregistrer les périodes tant qu'aucune année scolaire n'est configurée.
                </p>
              ) : null}
              <Button type="submit" disabled={savingSection === "periods" || !academicYears.length}>
                Enregistrer
              </Button>
            </form>
          </Card>

          <Card className="p-6">
            <SectionHeader
              title="Types d'évaluation"
              description="Catalogue PostgreSQL de l'établissement. Les types archivés ne sont plus proposés à la saisie."
            />
            <div className="mt-4">
              {configTarget && !isAllSchoolsSelection(configTarget) ? (
                <EvaluationTypesPanel
                  schoolCode={configTarget}
                  canConfigure={canConfigure}
                  userRole={user?.role}
                />
              ) : (
                <p className="text-sm text-muted">Sélectionnez un établissement pour gérer les types d'évaluation.</p>
              )}
            </div>
          </Card>
        </>
      ) : null}

      {showAcademicConfig && inSection("structure") ? (
        <>
          <Card className="p-6">
            <SectionHeader
              title="Niveaux et filières"
              description="Activez les éléments du référentiel national proposés par le Superadmin. La création libre n'est plus autorisée."
            />
            <div className="mt-4">
              {configTarget && !isAllSchoolsSelection(configTarget) ? (
                <SchoolEducationActivationPanel schoolCode={configTarget} canConfigure={canConfigure} />
              ) : (
                <p className="text-sm text-muted">Sélectionnez un établissement pour gérer l'activation.</p>
              )}
            </div>
          </Card>

          <Card key={`classNames-${academicFormKey}`} className="p-6">
            <SectionHeader
              title="Classes"
              description="Projection PostgreSQL des classes actives (référentiel /api/classes). Cette liste n'est plus une source de vérité locale."
            />
            {classNamesForSubjects.length ? (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink">
                {classNamesForSubjects.map((className) => (
                  <li key={className}>{className}</li>
                ))}
              </ul>
            ) : (
              <EmptyState
                className="mt-4"
                title="Aucune classe canonique"
                description="Créez les classes dans le module Classes. Elles apparaîtront ici par projection PostgreSQL."
              />
            )}
          </Card>

          <Card key={`subjects-${academicFormKey}`} className="p-6">
            <SchoolSubjectsPanel canCreate={canConfigure || subjectPermissions.canCreate} />
          </Card>
        </>
      ) : null}
    </div>
      </FormLayout.Content>
    </FormLayout>
  );
}
