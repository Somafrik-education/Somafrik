import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { CRUD_ACTIONS } from "../lib/constants";
import {
  canManageRolePermissions,
  getSuperadminManagedRoles,
  mergeSuperadminRolePermissions,
} from "../lib/permissions";
import {
  COUNTRY_ADMIN_ROLE,
  ROLE_GOVERNANCE_NOTES,
  SCHOOL_ADMIN_ROLE,
  getSuperadminPathModulesForRole,
  normalizeManagedRolePermissions,
} from "../lib/roleGovernance";
import {
  formatCountryOption,
  formatSchoolOption,
  schoolsForCountry,
} from "../lib/superadminCrudPath";
import { scopedCountries, scopedSchools } from "../lib/scope";
import { usePermissionContext } from "../lib/usePermissionContext";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { Field, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";

type SuperadminDraftRole = typeof COUNTRY_ADMIN_ROLE | typeof SCHOOL_ADMIN_ROLE;

function cloneRolePermissionDrafts(rolePermissions: Record<string, string[]>) {
  return {
    [COUNTRY_ADMIN_ROLE]: new Set(rolePermissions[COUNTRY_ADMIN_ROLE] ?? []),
    [SCHOOL_ADMIN_ROLE]: new Set(rolePermissions[SCHOOL_ADMIN_ROLE] ?? []),
  } as Record<SuperadminDraftRole, Set<string>>;
}

const ROLE_HINTS: Record<SuperadminDraftRole, string> = {
  [COUNTRY_ADMIN_ROLE]: "Périmètre pays : Pays, Établissements, Abonnements, Utilisateurs.",
  [SCHOOL_ADMIN_ROLE]: "Périmètre établissement : scolarité, finance, communication…",
};

export function PermissionsPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const ctx = usePermissionContext();
  const { showToast } = useToast();

  const canManage = canManageRolePermissions(ctx);
  const user = session?.user ?? null;
  const managedRoles = useMemo(() => getSuperadminManagedRoles(), []);

  const countries = scopedCountries(user, state);
  const allSchools = scopedSchools(user, state);

  const [countryCode, setCountryCode] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [selectedRole, setSelectedRole] = useState<SuperadminDraftRole | "">("");
  const [selectedModule, setSelectedModule] = useState("");
  const [draftByRole, setDraftByRole] = useState(() => cloneRolePermissionDrafts(state.rolePermissions));
  const [busy, setBusy] = useState(false);

  const countryOptions = useMemo(
    () => [{ value: "", label: "Choisir un pays…" }, ...countries.map(formatCountryOption)],
    [countries],
  );

  const schoolsInCountry = useMemo(
    () => schoolsForCountry(allSchools, countryCode),
    [allSchools, countryCode],
  );

  const schoolOptions = useMemo(
    () => [
      { value: "", label: countryCode ? "Choisir un établissement…" : "Sélectionnez d'abord un pays" },
      ...schoolsInCountry.map(formatSchoolOption),
    ],
    [countryCode, schoolsInCountry],
  );

  const roleOptions = useMemo(
    () => [
      {
        value: "",
        label: schoolCode ? "Choisir le rôle cible…" : "Sélectionnez d'abord un établissement",
      },
      ...managedRoles.map((role) => ({ value: role, label: role })),
    ],
    [managedRoles, schoolCode],
  );

  const modulesForRole = useMemo(
    () => (selectedRole ? getSuperadminPathModulesForRole(selectedRole) : []),
    [selectedRole],
  );

  const moduleOptions = useMemo(
    () => [
      {
        value: "",
        label: selectedRole ? "Choisir un module fonctionnel…" : "Sélectionnez d'abord un rôle",
      },
      ...modulesForRole.map((module) => ({ value: module, label: module })),
    ],
    [modulesForRole, selectedRole],
  );

  const selectedCountry = countries.find((country) => country.code === countryCode);
  const selectedSchool = schoolsInCountry.find((school) => school.code === schoolCode);
  const pathComplete = Boolean(countryCode && schoolCode && selectedRole && selectedModule);
  const activeDraft = selectedRole ? draftByRole[selectedRole] : new Set<string>();
  const hasAllPrivileges = selectedRole ? activeDraft.has("ALL_PRIVILEGES") : false;

  useEffect(() => {
    setDraftByRole(cloneRolePermissionDrafts(state.rolePermissions));
  }, [state.rolePermissions]);

  useEffect(() => {
    setSchoolCode("");
    setSelectedRole("");
    setSelectedModule("");
  }, [countryCode]);

  useEffect(() => {
    setSelectedRole("");
    setSelectedModule("");
  }, [schoolCode]);

  useEffect(() => {
    setSelectedModule("");
  }, [selectedRole]);

  function toggle(module: string, action: string) {
    if (!canManage || !selectedRole) return;
    const key = `${module}:${action}`;
    setDraftByRole((current) => {
      const nextRoleSet = new Set(current[selectedRole]);
      if (nextRoleSet.has(key)) nextRoleSet.delete(key);
      else nextRoleSet.add(key);
      return { ...current, [selectedRole]: nextRoleSet };
    });
  }

  async function save() {
    setBusy(true);
    try {
      await update({
        rolePermissions: mergeSuperadminRolePermissions(state.rolePermissions, {
          ...state.rolePermissions,
          [COUNTRY_ADMIN_ROLE]: normalizeManagedRolePermissions(
            COUNTRY_ADMIN_ROLE,
            draftByRole[COUNTRY_ADMIN_ROLE],
          ),
          [SCHOOL_ADMIN_ROLE]: normalizeManagedRolePermissions(
            SCHOOL_ADMIN_ROLE,
            draftByRole[SCHOOL_ADMIN_ROLE],
          ),
        }),
      });
      showToast("Permissions enregistrées", "success");
    } catch {
      showToast("Échec de l'enregistrement", "error");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDraftByRole(cloneRolePermissionDrafts(state.rolePermissions));
  }

  return (
    <Card className="p-6">
      <SectionHeader
        title="Droits par rôle"
        description={
          canManage
            ? "Parcours : pays → établissement → rôle (Admin Pays / Admin School) → module → droits CRUD."
            : "Consultation des droits plateforme (Admin Pays, Admin School)."
        }
        actions={
          <>
            <PrintButton documentTitle="Droits par rôle — Somafrik" />
            {canManage ? (
              <>
                <Button variant="secondary" size="sm" onClick={reset} disabled={busy}>
                  Réinitialiser
                </Button>
                <Button size="sm" onClick={() => void save()} disabled={busy}>
                  Enregistrer
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="mt-4 space-y-2 rounded-xl border border-line bg-slate-50/80 p-4 text-sm text-muted">
        <p>
          <span className="font-semibold text-ink">Niveaux hiérarchiques</span> (Pays, Établissement) ≠ rôles
          métier.
        </p>
        <p>{ROLE_GOVERNANCE_NOTES.superadminMatrix}</p>
        <p>{ROLE_GOVERNANCE_NOTES.localOperational}</p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Pays" hint="Code et nom du pays (périmètre Admin Pays)">
          <Select
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
            options={countryOptions}
          />
        </Field>

        <Field label="Établissement" hint="Code et nom de l'école">
          <Select
            value={schoolCode}
            onChange={(event) => setSchoolCode(event.target.value)}
            options={schoolOptions}
            disabled={!countryCode}
          />
        </Field>

        <Field label="Rôle cible" hint="Admin Pays ou Admin School">
          <Select
            value={selectedRole}
            onChange={(event) => setSelectedRole(event.target.value as SuperadminDraftRole | "")}
            options={roleOptions}
            disabled={!schoolCode}
          />
        </Field>

        <Field label="Module fonctionnel" hint="Fonctionnalité à autoriser pour ce rôle">
          <Select
            value={selectedModule}
            onChange={(event) => setSelectedModule(event.target.value)}
            options={moduleOptions}
            disabled={!selectedRole}
          />
        </Field>
      </div>

      {selectedCountry && selectedSchool && selectedRole ? (
        <p className="mt-4 rounded-lg border border-line bg-white px-4 py-3 text-sm text-muted">
          Périmètre :{" "}
          <span className="font-semibold text-ink">
            {selectedCountry.code} — {selectedCountry.name}
          </span>
          {" → "}
          <span className="font-semibold text-ink">
            {selectedSchool.code} — {selectedSchool.name}
          </span>
          {" · Rôle "}
          <span className="font-semibold text-brand">{selectedRole}</span>
        </p>
      ) : null}

      {!pathComplete ? (
        <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          Sélectionnez un pays, un établissement, le rôle cible (Admin Pays ou Admin School), puis un module
          fonctionnel pour afficher les droits CRUD.
        </p>
      ) : null}

      {pathComplete && selectedRole ? (
        <>
          <p className="mt-4 rounded-lg bg-brand-50 px-4 py-3 text-sm font-medium text-brand">
            Module « {selectedModule} » — droits appliqués au rôle{" "}
            <span className="font-bold">{selectedRole}</span>. {ROLE_HINTS[selectedRole]}
          </p>

          {hasAllPrivileges ? (
            <p className="mt-4 rounded-lg bg-brand-50 px-4 py-3 text-sm font-medium text-brand">
              Ce rôle dispose de tous les privilèges (ALL_PRIVILEGES).
            </p>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-3 text-left font-semibold">Module</th>
                  {CRUD_ACTIONS.map((action) => (
                    <th key={action.key} className="px-3 py-3 text-center font-semibold">
                      {action.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-2.5 font-medium text-ink">{selectedModule}</td>
                  {CRUD_ACTIONS.map((action) => {
                    const key = `${selectedModule}:${action.key}`;
                    const checked = hasAllPrivileges || activeDraft.has(key);
                    return (
                      <td key={action.key} className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-brand disabled:cursor-not-allowed"
                          checked={checked}
                          disabled={!canManage || hasAllPrivileges}
                          onChange={() => toggle(selectedModule, action.key)}
                        />
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Card>
  );
}
