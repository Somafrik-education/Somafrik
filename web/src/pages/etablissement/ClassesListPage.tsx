import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  EmptyState,
  EntityListForbidden,
  EntityListSearch,
  EntityListShell,
  EntityListTable,
  InlineAlert,
  Modal,
} from "@/design-system";
import { Field, Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { ApiError } from "../../api/client";
import { classesApi, type ClassStatus, type SchoolClass } from "../../lib/classesApi";
import { academicYearsApi } from "../../lib/academicYearsApi";
import { educationReferenceApi, type EducationSchoolCatalog } from "../../lib/educationReferenceApi";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { getEntityFeaturePermissions } from "../../lib/permissions";

type ClassFormState = {
  academicYearId: string;
  levelId: string;
  streamId: string;
  groupId: string;
  status: ClassStatus;
};

const EMPTY_FORM: ClassFormState = {
  academicYearId: "",
  levelId: "",
  streamId: "",
  groupId: "",
  status: "active",
};

type AcademicYearOption = {
  id: string;
  name: string;
  schoolCode?: string;
  isCurrent?: boolean;
};

/**
 * Compatibilité d'affichage pour les classes historiques dont class_name contient
 * encore le code technique de groupe en suffixe (ex. "1ère A CD02").
 * Les nouvelles écritures backend n'incluent plus ce code dans le nom.
 */
export function getClassDisplayName(row: Pick<SchoolClass, "name" | "groupCode">): string {
  const name = String(row.name ?? "").trim();
  const groupCode = String(row.groupCode ?? "").trim();
  if (!name || !groupCode) return name;
  const suffix = ` ${groupCode}`;
  return name.toLocaleLowerCase("fr").endsWith(suffix.toLocaleLowerCase("fr"))
    ? name.slice(0, -suffix.length).trim()
    : name;
}

/**
 * Gestion métier des classes — CRUD via /api/classes (PostgreSQL).
 * Conserve le chrome D2.7 (EntityListShell) sans passer par backoffice/state.
 */
export function ClassesListPage() {
  const { showToast } = useToast();
  const permissionCtx = usePermissionContext();
  const permissions = getEntityFeaturePermissions(permissionCtx, "classes", "Classes");
  const { activeSchoolCode } = useActiveSchool();

  const [rows, setRows] = useState<SchoolClass[]>([]);
  const [years, setYears] = useState<AcademicYearOption[]>([]);
  const [catalog, setCatalog] = useState<EducationSchoolCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | ClassStatus>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolClass | null>(null);
  const [form, setForm] = useState<ClassFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [classes, academicYears, schoolCatalog] = await Promise.all([
        classesApi.list(),
        academicYearsApi.list().catch(() => []),
        educationReferenceApi.getSchoolCatalog().catch(() => null),
      ]);
      setRows(Array.isArray(classes) ? classes : []);
      const scopedYears = (Array.isArray(academicYears) ? academicYears : []).filter((year) => {
        if (!activeSchoolCode || activeSchoolCode === "*") return true;
        return !year.schoolCode || year.schoolCode === activeSchoolCode;
      });
      setYears(scopedYears);
      setCatalog(schoolCatalog);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Impossible de charger les classes.";
      setError(message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeSchoolCode]);

  useEffect(() => {
    if (!permissions.canRead) {
      setLoading(false);
      return;
    }
    void load();
  }, [load, permissions.canRead]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (!q) return true;
      return [
        getClassDisplayName(row),
        row.level,
        row.track,
        row.groupCode,
        row.status,
        row.academicYearName,
        row.classCode,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, statusFilter]);

  const activeLevels = (catalog?.levels ?? []).filter((row) => row.schoolActive);
  const activeStreams = (catalog?.streams ?? []).filter((row) => {
    if (!row.schoolActive) return false;
    if (!form.levelId || !row.levelId) return true;
    return row.levelId === form.levelId;
  });
  const activeGroups = (catalog?.groups ?? []).filter((row) => row.schoolActive);
  const selectedLevel = activeLevels.find((row) => row.id === form.levelId);
  const selectedStream = activeStreams.find((row) => row.id === form.streamId);
  const previewName = [selectedLevel?.name, selectedStream?.name].filter(Boolean).join(" ");
  const labels = catalog?.labels ?? { levelLabel: "Niveau", trackLabel: "Filière", groupLabel: "Groupe" };

  function openCreate() {
    const current = years.find((year) => year.isCurrent);
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      academicYearId: current?.id ?? years[0]?.id ?? "",
      levelId: activeLevels[0]?.id ?? "",
      groupId: activeGroups[0]?.id ?? "",
    });
    setModalOpen(true);
  }

  function openEdit(row: SchoolClass) {
    setEditing(row);
    setForm({
      academicYearId: row.academicYearId,
      levelId: row.levelId ?? "",
      streamId: row.streamId ?? "",
      groupId: row.groupId ?? "",
      status: row.status === "inactive" ? "inactive" : "active",
    });
    setModalOpen(true);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      if (editing) {
        const updated = await classesApi.update(editing.classCode, {
          status: form.status,
          ...(form.levelId
            ? { levelId: form.levelId, streamId: form.streamId || null, groupId: form.groupId }
            : {}),
        });
        setRows((current) =>
          current.map((row) => (row.classCode === updated.classCode ? updated : row)),
        );
        showToast("Classe mise à jour.", "success");
      } else {
        const created = await classesApi.create({
          academicYearId: form.academicYearId,
          levelId: form.levelId,
          streamId: form.streamId || null,
          groupId: form.groupId,
          status: form.status,
        });
        setRows((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name, "fr")));
        showToast("Classe créée.", "success");
      }
      setModalOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Enregistrement impossible.";
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  const deactivate = useCallback(async (row: SchoolClass) => {
    try {
      const updated = await classesApi.update(row.classCode, { status: "inactive" });
      setRows((current) =>
        current.map((item) => (item.classCode === updated.classCode ? updated : item)),
      );
      showToast("Classe désactivée.", "success");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Désactivation impossible.";
      showToast(message, "error");
    }
  }, [showToast]);

  const columns = useMemo(
    () => [
      { key: "name", header: "Nom", render: (row: SchoolClass) => getClassDisplayName(row) },
      { key: "level", header: labels.levelLabel, render: (row: SchoolClass) => row.level || "—" },
      { key: "track", header: labels.trackLabel, render: (row: SchoolClass) => row.track || "—" },
      { key: "groupCode", header: labels.groupLabel, render: (row: SchoolClass) => row.groupCode || "—" },
      {
        key: "academicYearName",
        header: "Année",
        render: (row: SchoolClass) => row.academicYearName || "—",
      },
      { key: "students", header: "Effectif", render: (row: SchoolClass) => Number(row.students ?? 0) },
      { key: "status", header: "Statut" },
      {
        key: "actions",
        header: "Actions",
        sortable: false,
        render: (row: SchoolClass) => (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="text-sm underline"
              to={`/etablissement/classes/${encodeURIComponent(row.classCode)}/eleves`}
            >
              Élèves
            </Link>
            {permissions.canUpdate ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => openEdit(row)}>
                Modifier
              </Button>
            ) : null}
            {permissions.canUpdate && row.status === "active" ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void deactivate(row)}
              >
                Désactiver
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [permissions.canUpdate, deactivate, labels.groupLabel, labels.levelLabel, labels.trackLabel],
  );

  if (!permissions.canRead) {
    return <EntityListForbidden moduleLabel="Classes" />;
  }

  return (
    <>
      <EntityListShell
        title="Classes"
        description="Organisation des classes de l'établissement (persistance PostgreSQL)."
        alerts={
          error ? (
            <InlineAlert tone="danger" title="Erreur">
              {error}
            </InlineAlert>
          ) : null
        }
        filters={
          <div className="flex flex-wrap items-center gap-3">
            <EntityListSearch
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher dans classes"
              aria-label="Rechercher dans classes"
            />
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value === "active" || event.target.value === "inactive" ? event.target.value : "")
              }
              aria-label="Filtrer les classes par statut"
              className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
            >
              <option value="">Tous les statuts</option>
              <option value="active">Actives</option>
              <option value="inactive">Inactives</option>
            </select>
          </div>
        }
        primaryActions={
          permissions.canCreate ? (
            <Button type="button" onClick={openCreate}>
              Ajouter
            </Button>
          ) : null
        }
        secondaryActions={
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
            Actualiser
          </Button>
        }
      >
        {loading ? (
          <p className="text-sm text-muted">Chargement des classes…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Liste vide"
            description="Aucun élément à afficher dans classes."
          />
        ) : (
          <EntityListTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.classCode}
          />
        )}
      </EntityListShell>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Modifier la classe" : "Ajouter une classe"}
      >
        <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
          <Field label="Année scolaire" htmlFor="class-year">
            <Select
              id="class-year"
              value={form.academicYearId}
              disabled={Boolean(editing) || years.length === 0}
              onChange={(event) =>
                setForm((current) => ({ ...current, academicYearId: event.target.value }))
              }
              required
              options={[
                { value: "", label: "Choisir une année" },
                ...years.map((year) => ({ value: year.id, label: year.name })),
              ]}
            />
          </Field>
          {!editing && years.length === 0 ? (
            <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-950">
                Aucune année scolaire n'est configurée.
              </p>
              <p className="text-sm text-amber-900">
                Créez-la dans{" "}
                <Link className="underline" to="/parametres/annee-scolaire">
                  Paramètres → Année scolaire
                </Link>{" "}
                avant d'ajouter une classe. Classes ne fait que sélectionner une année existante.
              </p>
            </div>
          ) : null}
          {!editing && years.length > 0 && activeLevels.length === 0 ? (
            <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-950">
                Aucun {labels.levelLabel.toLowerCase()} n'est activé pour cet établissement.
              </p>
              <p className="text-sm text-amber-900">
                Activez l'offre pédagogique dans{" "}
                <Link className="underline" to="/configuration">
                  Paramètres / Référentiel
                </Link>{" "}
                avant de créer une classe.
              </p>
            </div>
          ) : null}
          {!editing && years.length > 0 && activeLevels.length > 0 && activeGroups.length === 0 ? (
            <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-950">
                Aucun {labels.groupLabel.toLowerCase()} n'est configuré pour cet établissement.
              </p>
              <p className="text-sm text-amber-900">
                Configurez le catalogue pays puis activez les groupes dans{" "}
                <Link className="underline" to="/configuration">
                  Paramètres / Référentiel
                </Link>
                . Aucun groupe A–E n'est proposé par défaut.
              </p>
            </div>
          ) : null}
          <Field label={labels.levelLabel} htmlFor="class-level">
            <Select
              id="class-level"
              value={form.levelId}
              disabled={Boolean(editing) && !form.levelId}
              onChange={(event) =>
                setForm((current) => ({ ...current, levelId: event.target.value, streamId: "" }))
              }
              required={!editing}
              options={[
                { value: "", label: `Choisir un ${labels.levelLabel.toLowerCase()}` },
                ...activeLevels.map((level) => ({ value: level.id, label: level.name })),
              ]}
            />
          </Field>
          <Field label={`${labels.trackLabel} (optionnel)`} htmlFor="class-track">
            <Select
              id="class-track"
              value={form.streamId}
              onChange={(event) => setForm((current) => ({ ...current, streamId: event.target.value }))}
              options={[
                { value: "", label: `Sans ${labels.trackLabel.toLowerCase()}` },
                ...activeStreams.map((stream) => ({ value: stream.id, label: stream.name })),
              ]}
            />
          </Field>
          <Field label={labels.groupLabel} htmlFor="class-group">
            <Select
              id="class-group"
              value={form.groupId}
              onChange={(event) => setForm((current) => ({ ...current, groupId: event.target.value }))}
              required
              options={[
                { value: "", label: `Choisir un ${labels.groupLabel.toLowerCase()}` },
                ...activeGroups.map((group) => ({ value: group.id, label: group.name || group.code })),
              ]}
            />
          </Field>
          {previewName ? (
            <p className="text-sm text-muted">Nom généré : {previewName}</p>
          ) : null}
          <Field label="Statut" htmlFor="class-status">
            <Select
              id="class-status"
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  status: event.target.value === "inactive" ? "inactive" : "active",
                }))
              }
              options={[
                { value: "active", label: "active" },
                { value: "inactive", label: "inactive" },
              ]}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={saving || (!editing && (years.length === 0 || activeLevels.length === 0 || activeGroups.length === 0))}
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
