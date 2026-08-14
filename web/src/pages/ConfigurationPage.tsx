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
  Textarea,
  useToast,
} from "../design-system";
import { SchoolEducationActivationPanel } from "../components/SchoolEducationActivationPanel";
import { EvaluationTypesPanel } from "../components/EvaluationTypesPanel";
import {
  DEFAULT_CLASS_NAMES,
  getAllSchoolSubjects,
  getSchoolAcademicLists,
  parseListLines,
  resolveSubjectsByClass,
} from "../lib/academicConfig";
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

type SavingSection =
  | "periods"
  | "evaluations"
  | "levels"
  | "tracks"
  | "classNames"
  | "subjects"
  | null;

/** Domaine de configuration affiché (hub Paramètres). Non défini = tout afficher. */
export type ConfigurationSection = "annee-scolaire" | "structure" | "roles-droits";

export function ConfigurationPage({ section }: { section?: ConfigurationSection } = {}) {
  const { session } = useAuth();
  const { state, update } = useData();
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
  const [selectedSubjectClass, setSelectedSubjectClass] = useState("");
  const [assignableRoles, setAssignableRoles] = useState<EstablishmentRole[]>([]);
  const [selectedCatalogueRoleId, setSelectedCatalogueRoleId] = useState("");
  const [rolesLoading, setRolesLoading] = useState(false);

  const settingsPermissions = useFeaturePermissions("Paramètres Établissement");
  const canConfigure = canManageEstablishmentSettings(ctx);
  const canReadSettings = settingsPermissions.canRead || canConfigure;
  const canDesignBulletins = isSuperAdminRole(user?.role);
  const selectedCatalogueRole = useMemo(
    () => assignableRoles.find((role) => role.id === selectedCatalogueRoleId) ?? assignableRoles[0] ?? null,
    [assignableRoles, selectedCatalogueRoleId],
  );

  const resolvedPeriodRows = useMemo(() => applySystemActivePeriod(periodRows), [periodRows]);
  const classNamesForSubjects = useMemo(() => {
    if (isBulkConfiguration) return DEFAULT_CLASS_NAMES;
    return getSchoolAcademicLists(state, configTarget).classNames;
  }, [isBulkConfiguration, state.academicConfigs, configTarget]);
  const subjectsByClass = useMemo(
    () => resolveSubjectsByClass(academicConfig, classNamesForSubjects),
    [academicConfig, classNamesForSubjects, academicFormKey],
  );
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
    if (!selectedSubjectClass && classNamesForSubjects.length) {
      setSelectedSubjectClass(classNamesForSubjects[0]);
    } else if (selectedSubjectClass && !classNamesForSubjects.includes(selectedSubjectClass)) {
      setSelectedSubjectClass(classNamesForSubjects[0] ?? "");
    }
  }, [classNamesForSubjects, selectedSubjectClass]);

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

  async function saveAcademicPartial(
    section: Exclude<SavingSection, null>,
    partial: Record<string, unknown>,
    successMessage: string,
  ) {
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

    setSavingSection(section);
    try {
      const existing = (state.academicConfigs?.[effectiveSchoolCode] ?? {}) as Record<string, unknown>;
      const nextConfig = {
        ...(typeof existing === "object" ? existing : {}),
        schoolCode: effectiveSchoolCode,
        ...partial,
      };
      await update({ academicConfigs: { [effectiveSchoolCode]: nextConfig } }, { schoolCode: effectiveSchoolCode });
      showToast(successMessage, "success");
      setAcademicFormKey((current) => current + 1);
    } catch {
      showToast("Échec de l'enregistrement", "error");
    } finally {
      setSavingSection(null);
    }
  }

  async function handlePeriodsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const periods = serializePeriods(periodRows, periodMode);
    if (!periods.length) {
      showToast("Ajoutez au moins une sous-période", "error");
      return;
    }
    await saveAcademicPartial(
      "periods",
      {
        periodMode,
        periods,
        defaultScale: Number(form.get("defaultScale") ?? 20),
        ...(canDesignBulletins
          ? { reportCardMode: String(form.get("reportMode") ?? "period") }
          : {}),
      },
      "Périodes et barème enregistrés",
    );
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

  async function handleClassNamesSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextClassNames = parseListLines(String(form.get("classNames") ?? ""));
    const currentByClass = resolveSubjectsByClass(academicConfig, classNamesForSubjects);
    const nextByClass: Record<string, string[]> = {};
    nextClassNames.forEach((className) => {
      nextByClass[className] = currentByClass[className] ?? [];
    });
    await saveAcademicPartial(
      "classNames",
      {
        classNames: nextClassNames,
        subjectsByClass: nextByClass,
        subjects: getAllSchoolSubjects(nextByClass),
      },
      "Classes enregistrées",
    );
  }

  async function handleSubjectsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBulkConfiguration || isAllSchoolsSelection(configTarget)) {
      showToast(
        "Sélectionnez un établissement précis. L'enregistrement multi-établissements n'est pas disponible sur cette API.",
        "error",
      );
      return;
    }
    const effectiveSchoolCode = String(configTarget ?? activeSchoolCode ?? "").trim();
    if (!canConfigure || !effectiveSchoolCode || !selectedSubjectClass) {
      if (!canConfigure) {
        showToast("Vous n'avez pas les droits pour modifier cette configuration.", "error");
      } else {
        showToast("Sélectionnez d'abord une classe", "error");
      }
      return;
    }
    const form = new FormData(event.currentTarget);
    const className = String(form.get("subjectClass") ?? selectedSubjectClass);
    const subjects = parseListLines(String(form.get("subjects") ?? ""));

    setSavingSection("subjects");
    try {
      const existing = (state.academicConfigs?.[effectiveSchoolCode] ?? {}) as Record<string, unknown>;
      const classNames = getSchoolAcademicLists(state, effectiveSchoolCode).classNames;
      const currentByClass = resolveSubjectsByClass(existing, classNames);
      const nextByClass = {
        ...currentByClass,
        [className]: subjects,
      };
      const nextConfig = {
        ...(typeof existing === "object" ? existing : {}),
        schoolCode: effectiveSchoolCode,
        subjectsByClass: nextByClass,
        subjects: getAllSchoolSubjects(nextByClass),
      };
      await update({ academicConfigs: { [effectiveSchoolCode]: nextConfig } }, { schoolCode: effectiveSchoolCode });
      showToast(`Matières enregistrées pour ${className}`, "success");
      setAcademicFormKey((current) => current + 1);
    } catch {
      showToast("Échec de l'enregistrement", "error");
    } finally {
      setSavingSection(null);
    }
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
                    defaultValue={String(academicConfig.defaultScale ?? 20)}
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

              <Button type="submit" disabled={savingSection === "periods"}>
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
              description="Une classe par ligne. Utilisées dans les listes déroulantes (élèves, matières, affectations)."
            />
            <form onSubmit={handleClassNamesSubmit} className="mt-4 space-y-4">
              <FormField label="Classes">
                <Textarea
                  name="classNames"
                  rows={4}
                  defaultValue={(academicConfig.classNames as string[] | undefined)?.join("\n") ?? DEFAULT_CLASS_NAMES.join("\n")}
                />
              </FormField>
              <Button type="submit" disabled={savingSection === "classNames"}>
                Enregistrer
              </Button>
            </form>
          </Card>

          <Card key={`subjects-${academicFormKey}-${selectedSubjectClass}`} className="p-6">
            <SectionHeader
              title="Matières"
              description="Sélectionnez une classe, puis saisissez les matières enseignées (une par ligne)."
            />
            {classNamesForSubjects.length ? (
              <form onSubmit={handleSubjectsSubmit} className="mt-4 space-y-4">
                <FormField label="Classe">
                  <Select
                    name="subjectClass"
                    value={selectedSubjectClass}
                    onChange={(e) => setSelectedSubjectClass(e.target.value)}
                    options={classNamesForSubjects.map((className) => ({
                      value: className,
                      label: className,
                    }))}
                  />
                </FormField>
                <FormField label="Matières de la classe">
                  <Textarea
                    name="subjects"
                    rows={6}
                    key={`subjects-text-${selectedSubjectClass}-${academicFormKey}`}
                    defaultValue={(subjectsByClass[selectedSubjectClass] ?? []).join("\n")}
                    placeholder={"Mathématiques\nFrançais\nSciences"}
                  />
                </FormField>
                <Button type="submit" disabled={savingSection === "subjects" || !selectedSubjectClass}>
                  Enregistrer
                </Button>
              </form>
            ) : (
              <EmptyState
                className="mt-4"
                title="Aucune classe configurée"
                description="Enregistrez d'abord la liste des classes pour configurer les matières par classe."
              />
            )}
          </Card>
        </>
      ) : null}
    </div>
      </FormLayout.Content>
    </FormLayout>
  );
}
