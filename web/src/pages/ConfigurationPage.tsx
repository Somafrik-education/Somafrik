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
import { platformApi } from "../lib/platformApi";
import { SchoolEducationActivationPanel } from "../components/SchoolEducationActivationPanel";
import {
  DEFAULT_CLASS_NAMES,
  DEFAULT_USER_ROLES,
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
import { isPlatformBackOfficeRole, isSuperAdminRole } from "../lib/orgHierarchy";
import { scopedUsers } from "../lib/scope";
import { isAllSchoolsSelection, resolveTargetSchoolCodes } from "../lib/activeSchool";
import { buildSchoolSelectOptions } from "../lib/superadminCrudPath";
import { canAccessSchoolBackOffice, canManageEstablishmentSettings } from "../lib/permissions";
import { useFeaturePermissions, usePermissionContext } from "../lib/usePermissionContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { isSchoolAdminRole, displayRoleName, normalize } from "../lib/format";
import {
  applyRoleRenames,
  canDelegateSchoolPermission,
  detectRoleRenames,
  getDelegableActionsForFeature,
  getDelegableSchoolFeatures,
  getSchoolPilotageRoles,
  mergeLocalRolePermissions,
  readRolePermissions,
  resolveRolePermissionKey,
} from "../lib/schoolPilotage";

type SavingSection =
  | "userRoles"
  | "rolePilotage"
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
  const { state, update, refresh } = useData();
  const ctx = usePermissionContext();
  const { showToast } = useToast();
  const user = session?.user ?? null;
  const {
    activeSchoolCode,
    activeSchool,
    availableSchools,
    requiresSelection,
    scopedUser,
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
  const [selectedPilotageRole, setSelectedPilotageRole] = useState("");
  const [selectedPilotageFeature, setSelectedPilotageFeature] = useState("");
  const [rolePermissionDraft, setRolePermissionDraft] = useState<Record<string, string[]> | null>(null);
  const [selectedSubjectClass, setSelectedSubjectClass] = useState("");

  const users = scopedUsers(scopedUser, state);
  const settingsPermissions = useFeaturePermissions("Paramètres Établissement");
  const canConfigure = canManageEstablishmentSettings(ctx);
  const canReadSettings = settingsPermissions.canRead || canConfigure;
  const showRolePilotage = isSchoolAdminRole(user?.role);
  const canDesignBulletins = isSuperAdminRole(user?.role);
  const configuredUserRoles = useMemo(
    () => getSchoolPilotageRoles(state, isBulkConfiguration ? undefined : configTarget).filter(
      (role) => !isPlatformBackOfficeRole(role),
    ),
    [state.academicConfigs, configTarget, isBulkConfiguration],
  );
  const delegableFeatures = useMemo(() => getDelegableSchoolFeatures(ctx), [ctx]);
  const effectiveRolePermissions = rolePermissionDraft ?? state.rolePermissions;
  const selectedRolePermissions = useMemo(
    () => new Set(readRolePermissions(selectedPilotageRole, configuredUserRoles, effectiveRolePermissions)),
    [configuredUserRoles, effectiveRolePermissions, selectedPilotageRole],
  );
  const delegableActions = useMemo(
    () => getDelegableActionsForFeature(ctx, selectedPilotageFeature),
    [ctx, selectedPilotageFeature],
  );
  const pilotageDirty = rolePermissionDraft !== null;

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
    setRolePermissionDraft(null);
  }, [configTarget]);

  useEffect(() => {
    const mode = coercePeriodMode(academicConfig.periodMode);
    setPeriodMode(mode);
    setPeriodRows(normalizeStoredPeriods(academicConfig.periods, mode));
  }, [academicFormKey, configTarget]);

  useEffect(() => {
    if (!selectedPilotageRole && configuredUserRoles.length) {
      setSelectedPilotageRole(configuredUserRoles[0]);
    } else if (selectedPilotageRole && !configuredUserRoles.includes(selectedPilotageRole)) {
      setSelectedPilotageRole(configuredUserRoles[0] ?? "");
    }
  }, [configuredUserRoles, selectedPilotageRole]);

  useEffect(() => {
    if (!selectedPilotageFeature && delegableFeatures.length) {
      setSelectedPilotageFeature(delegableFeatures[0]);
    } else if (selectedPilotageFeature && !delegableFeatures.includes(selectedPilotageFeature)) {
      setSelectedPilotageFeature(delegableFeatures[0] ?? "");
    }
  }, [delegableFeatures, selectedPilotageFeature]);

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

  async function handleEvaluationsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await saveAcademicPartial(
      "evaluations",
      {
        evaluationTypes: String(form.get("evaluationTypes") ?? "")
          .split(/\r?\n|,/)
          .map((item) => item.trim())
          .filter(Boolean),
      },
      "Types d'évaluation enregistrés",
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

  async function handleUserRolesSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBulkConfiguration || isAllSchoolsSelection(configTarget)) {
      showToast(
        "Sélectionnez un établissement précis. L'enregistrement multi-établissements n'est pas disponible sur cette API.",
        "error",
      );
      return;
    }
    const effectiveSchoolCode = String(configTarget ?? activeSchoolCode ?? "").trim();
    if (!canConfigure || !effectiveSchoolCode) {
      if (!canConfigure) {
        showToast("Vous n'avez pas les droits pour modifier cette configuration.", "error");
      }
      return;
    }
    const form = new FormData(event.currentTarget);
    const newRoles = parseListLines(String(form.get("userRoles") ?? "")).filter(
      (role) => !isPlatformBackOfficeRole(role),
    );

    setSavingSection("userRoles");
    try {
      const existing = (state.academicConfigs?.[effectiveSchoolCode] ?? {}) as Record<string, unknown>;
      let nextUsers = state.users;
      let nextRolePermissions = state.rolePermissions;
      let renamedLabels = "";

      const oldRoles =
        Array.isArray(existing.userRoles) && (existing.userRoles as string[]).length
          ? (existing.userRoles as string[])
          : DEFAULT_USER_ROLES;
      const migrations = detectRoleRenames(oldRoles, newRoles);
      if (Object.keys(migrations).length) {
        const renamed = applyRoleRenames(
          {
            ...state,
            academicConfigs: {
              ...state.academicConfigs,
              [effectiveSchoolCode]: existing,
            },
            users: nextUsers,
            rolePermissions: nextRolePermissions,
          },
          migrations,
        );
        nextUsers = renamed.users;
        nextRolePermissions = renamed.rolePermissions;
        renamedLabels = Object.entries(migrations)
          .map(([from, to]) => `« ${from} » → « ${to} »`)
          .join(", ");
      }

      const nextConfig = {
        ...(typeof existing === "object" ? existing : {}),
        schoolCode: effectiveSchoolCode,
        userRoles: newRoles,
      };

      await update(
        {
          academicConfigs: { [effectiveSchoolCode]: nextConfig },
          ...(nextUsers !== state.users ? { users: nextUsers } : {}),
        },
        { schoolCode: effectiveSchoolCode },
      );
      if (nextRolePermissions !== state.rolePermissions) {
        await platformApi.replaceRolePermissions(nextRolePermissions);
      }
      await refresh();
      setRolePermissionDraft(null);
      if (renamedLabels) {
        showToast(`Rôles enregistrés (${renamedLabels})`, "success");
      } else {
        showToast("Rôles enregistrés", "success");
      }
      setAcademicFormKey((current) => current + 1);
    } catch {
      showToast("Échec de l'enregistrement", "error");
    } finally {
      setSavingSection(null);
    }
  }

  function togglePilotagePermission(permission: string, enabled: boolean) {
    if (!canDelegateSchoolPermission(ctx, permission) || !selectedPilotageRole) return;
    setRolePermissionDraft((current) => {
      const base = current ?? state.rolePermissions;
      const legacyKey = resolveRolePermissionKey(selectedPilotageRole, configuredUserRoles, base);
      const rolePerms = new Set(
        base[selectedPilotageRole] ?? base[legacyKey] ?? [],
      );
      if (enabled) rolePerms.add(permission);
      else rolePerms.delete(permission);
      const next = {
        ...base,
        [selectedPilotageRole]: [...rolePerms].sort((a, b) => a.localeCompare(b, "fr")),
      };
      if (legacyKey !== selectedPilotageRole && next[legacyKey]) {
        delete next[legacyKey];
      }
      return next;
    });
  }

  async function saveRolePilotage() {
    if (!rolePermissionDraft) return;
    setSavingSection("rolePilotage");
    try {
      const nextRolePermissions = mergeLocalRolePermissions(
        state.rolePermissions,
        rolePermissionDraft,
        configuredUserRoles,
      );
      const nextUsers = state.users.map((account) =>
        account.role && nextRolePermissions[account.role]
          ? { ...account, permissions: nextRolePermissions[account.role] }
          : account,
      );
      await platformApi.replaceRolePermissions(nextRolePermissions);
      await update({ users: nextUsers });
      await refresh();
      setRolePermissionDraft(null);
      showToast("Pilotage des rôles enregistré", "success");
    } catch {
      showToast("Échec de l'enregistrement", "error");
    } finally {
      setSavingSection(null);
    }
  }

  const showAcademicConfig = canConfigure || canReadSettings;
  const inSection = (target: ConfigurationSection) => !section || section === target;
  const hasRolesAccess = canConfigure || showRolePilotage;

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

      {canConfigure && inSection("roles-droits") ? (
        <Card key={`userRoles-${academicFormKey}`} className="p-6">
          <SectionHeader
            title="Rôles"
            description="Un rôle par ligne pour votre établissement (secrétaire, préfet, enseignant…). Les droits se pilotent ci-dessous. Admin Pays et Admin School sont gérés par le Superadmin dans Droits par rôle."
          />
          <form onSubmit={handleUserRolesSubmit} className="mt-4 space-y-4">
            <FormField label="Rôles">
              <Textarea
                name="userRoles"
                rows={6}
                defaultValue={(academicConfig.userRoles as string[] | undefined)?.join("\n") ?? DEFAULT_USER_ROLES.join("\n")}
              />
            </FormField>
            <Button type="submit" disabled={savingSection === "userRoles"}>
              Enregistrer
            </Button>
          </form>
        </Card>
      ) : null}

      {showRolePilotage && delegableFeatures.length && configuredUserRoles.length && inSection("roles-droits") ? (
        <Card className="p-6">
          <SectionHeader
            title="Pilotage des rôles de l'établissement"
            description="Définissez les droits des rôles locaux de l'établissement, dans la limite de vos propres autorisations."
            actions={
              <Button
                size="sm"
                disabled={!pilotageDirty || savingSection === "rolePilotage"}
                onClick={() => void saveRolePilotage()}
              >
                Enregistrer
              </Button>
            }
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FormField label="Rôle">
              <Select
                value={selectedPilotageRole}
                onChange={(e) => setSelectedPilotageRole(e.target.value)}
                options={configuredUserRoles.map((role) => ({ value: role, label: displayRoleName(role) }))}
              />
            </FormField>
            <FormField label="Fonctionnalité">
              <Select
                value={selectedPilotageFeature}
                onChange={(e) => setSelectedPilotageFeature(e.target.value)}
                options={delegableFeatures.map((feature) => ({ value: feature, label: feature }))}
              />
            </FormField>
          </div>

          <div className="mt-4 rounded-xl border border-line bg-slate-50/60 p-4">
            <p className="text-sm font-bold text-ink">{selectedPilotageFeature}</p>
            <p className="text-xs text-muted">
              {displayRoleName(selectedPilotageRole)} •{" "}
              {users.filter((account) => account.role === selectedPilotageRole && account.status !== "Suspendu").length}{" "}
              compte(s) actif(s)
            </p>
            <div className="mt-4 space-y-3">
              {delegableActions.length ? (
                delegableActions.map((action) => {
                  const permission = `${selectedPilotageFeature}:${action.key}`;
                  const enabled = selectedRolePermissions.has(permission);
                  return (
                    <label
                      key={permission}
                      className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 ${
                        enabled ? "border-brand/30 bg-brand-50" : "border-line bg-white"
                      }`}
                    >
                      <div>
                        <p className="text-sm font-semibold text-ink">{action.label}</p>
                        <p className="text-xs text-muted">{enabled ? "Accordé" : "Refusé"}</p>
                      </div>
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-brand"
                        checked={enabled}
                        onChange={(e) => togglePilotagePermission(permission, e.target.checked)}
                      />
                    </label>
                  );
                })
              ) : (
                <p className="text-sm text-muted">
                  Aucun droit délégable pour cette fonctionnalité dans votre périmètre.
                </p>
              )}
            </div>
          </div>
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

          <Card key={`evaluations-${academicFormKey}`} className="p-6">
            <SectionHeader
              title="Types d'évaluation"
              description="Liste des types proposés lors de la saisie des notes."
            />
            <form onSubmit={handleEvaluationsSubmit} className="mt-4 space-y-4">
              <FormField label="Types d'évaluation">
                <Textarea
                  name="evaluationTypes"
                  rows={4}
                  defaultValue={(academicConfig.evaluationTypes as string[] | undefined)?.join("\n") ?? "Interrogation\nDevoir\nExamen"}
                />
              </FormField>
              <Button type="submit" disabled={savingSection === "evaluations"}>
                Enregistrer
              </Button>
            </form>
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
