import { DateInput } from "../../components/ui/DateInput";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
import { Field, Input, Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";
import { ApiError } from "../../api/client";
import { teachersApi, type SchoolTeacher } from "../../lib/teachersApi";
import { teacherAssignmentsApi, type TeacherAssignmentRecord } from "../../lib/teacherAssignmentsApi";
import { classesApi, type SchoolClass } from "../../lib/classesApi";
import { isArchivedSubjectStatus, subjectsApi, type SchoolSubject } from "../../lib/subjectsApi";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { getEntityFeaturePermissions } from "../../lib/permissions";
import { formatCaughtApiError } from "../../lib/apiErrors";

type TeacherFormState = {
  firstName: string;
  lastName: string;
  gender: string;
  birthDate: string;
  entryDate: string;
  phone: string;
  email: string;
  speciality: string;
  temporaryPassword: string;
};

type AssignFormState = {
  classCode: string;
  subjectCode: string;
};

type SubjectOption = SchoolSubject;

const EMPTY_FORM: TeacherFormState = {
  firstName: "",
  lastName: "",
  gender: "",
  birthDate: "",
  entryDate: "",
  phone: "",
  email: "",
  speciality: "",
  temporaryPassword: "",
};

function mapApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return err.message || "Accès refusé.";
    if (err.status === 404) return err.message || "Enseignant introuvable.";
    if (err.status === 409) {
      return err.message || "Conflit : cette identité enseignant est ambiguë ou déjà présente.";
    }
    if (err.status === 400) return err.message || "Données invalides.";
    if (err.status >= 500) return err.message || "Erreur serveur. Réessayez plus tard.";
    return err.message || fallback;
  }
  return fallback;
}

function toDateInputValue(value: string): string {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const fr = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  return "";
}

function teacherFormFromRow(row: SchoolTeacher): TeacherFormState {
  return {
    firstName: row.firstName ?? "",
    lastName: row.lastName ?? "",
    gender: row.gender ?? "",
    birthDate: toDateInputValue(row.birthDate),
    entryDate: toDateInputValue(row.entryDate),
    phone: row.phone ?? "",
    email: row.email ?? "",
    speciality: row.speciality || row.mainSubject || "",
    temporaryPassword: "",
  };
}

function formatAssignmentCell(row: SchoolTeacher): string {
  const items = (row.assignments ?? []).filter((item) => item.className || item.course);
  if (items.length === 1) {
    return [items[0].className, items[0].course].filter(Boolean).join(" · ") || "—";
  }
  if (items.length > 1) {
    return `${items.length} affectations`;
  }
  const classesLabel = (row.assignedClasses ?? []).filter(Boolean).join(", ");
  const coursesLabel = (row.courses ?? []).filter(Boolean).join(", ");
  if (!classesLabel && !coursesLabel) return "—";
  return [classesLabel, coursesLabel].filter(Boolean).join(" · ");
}

function logSubjectsCatalogFailure(err: unknown) {
  const status = err instanceof ApiError ? err.status : undefined;
  console.error(
    JSON.stringify({
      kind: "subjects_catalog_load_failure",
      status: status ?? null,
      message: err instanceof Error ? err.message : "unknown",
    }),
  );
}

/**
 * Liste et cycle de vie des enseignants via /api/teachers (PostgreSQL).
 * Affectations : POST /api/assignments exclusivement.
 */
export function TeachersListPage() {
  const { showToast } = useToast();
  const permissionCtx = usePermissionContext();
  const permissionsReady = permissionCtx.permissionsReady !== false;
  const permissions = getEntityFeaturePermissions(permissionCtx, "teachers", "Enseignants");
  const assignmentPermissions = getEntityFeaturePermissions(
    permissionCtx,
    "assignments",
    "Affectations",
  );

  const [rows, setRows] = useState<SchoolTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolTeacher | null>(null);
  const [form, setForm] = useState<TeacherFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<SchoolTeacher | null>(null);
  const [assignForm, setAssignForm] = useState<AssignFormState>({ classCode: "", subjectCode: "" });
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [subjectsCatalogError, setSubjectsCatalogError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SchoolTeacher | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [removingFor, setRemovingFor] = useState<SchoolTeacher | null>(null);
  const [removalRows, setRemovalRows] = useState<TeacherAssignmentRecord[]>([]);
  const [removalLoading, setRemovalLoading] = useState(false);
  const [removalSavingId, setRemovalSavingId] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<TeacherAssignmentRecord | null>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const teachers = await teachersApi.list();
      setRows(Array.isArray(teachers) ? teachers : []);
    } catch (err) {
      setError(mapApiError(err, "Impossible de charger les enseignants."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!permissions.canRead) {
      setLoading(false);
      return;
    }
    void load();
  }, [load, permissions.canRead]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [
        row.name,
        row.firstName,
        row.lastName,
        row.identifier,
        row.teacherCode,
        row.publicId,
        row.phone,
        row.email,
        row.speciality,
        row.mainSubject,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  function openEdit(row: SchoolTeacher) {
    setEditing(row);
    setForm(teacherFormFromRow(row));
    setFormError(null);
    setModalOpen(true);
  }

  async function openAssign(row: SchoolTeacher) {
    setAssigning(row);
    setConfirmingRemoval(null);
    setAssignForm({ classCode: "", subjectCode: "" });
    setAssignError(null);
    setSubjectsCatalogError(null);
    setSubjects([]);
    setRemovalRows([]);
    setRemovalError(null);
    setRemovalLoading(assignmentPermissions.canRead);
    try {
      const [classResult, subjectResult, assignmentResult] = await Promise.allSettled([
        classesApi.list(),
        subjectsApi.list(),
        assignmentPermissions.canRead ? teacherAssignmentsApi.list() : Promise.resolve([]),
      ]);
      if (classResult.status === "rejected") throw classResult.reason;
      if (subjectResult.status === "rejected") throw subjectResult.reason;
      const classRows = classResult.value;
      const subjectRows = subjectResult.value;
      if (assignmentResult.status === "rejected") {
        setRemovalError(mapApiError(assignmentResult.reason, "Impossible de charger les affectations."));
      } else {
        const code = String(row.teacherCode ?? "").trim();
        const assignmentRows = assignmentResult.value;
        setRemovalRows(
          code && Array.isArray(assignmentRows)
            ? assignmentRows.filter((item) =>
                Boolean(item.id) &&
                String(item.teacherId ?? "").trim() === code &&
                String(item.status ?? "active").toLowerCase() === "active",
              )
            : [],
        );
      }
      setClasses(
        Array.isArray(classRows)
          ? classRows.filter((item) => String(item.status ?? "active") === "active")
          : [],
      );
      setSubjects(subjectRows.filter((item) => !isArchivedSubjectStatus(item.status)));
    } catch (err) {
      logSubjectsCatalogFailure(err);
      const message = formatCaughtApiError(err, "Impossible de charger les classes, cours ou affectations.");
      setSubjectsCatalogError(message);
      setRemovalError(message);
    } finally {
      setRemovalLoading(false);
    }
  }

  async function openRemoveCourse(row: SchoolTeacher) {
    setRemovingFor(row);
    setConfirmingRemoval(null);
    setRemovalRows([]);
    setRemovalError(null);
    setRemovalLoading(true);
    try {
      const rows = await teacherAssignmentsApi.list();
      const code = String(row.teacherCode ?? "").trim();
      setRemovalRows(
        code && Array.isArray(rows)
          ? rows.filter((item) =>
              Boolean(item.id) &&
              String(item.teacherId ?? "").trim() === code &&
              String(item.status ?? "active").toLowerCase() === "active",
            )
          : [],
      );
    } catch (err) {
      setRemovalError(mapApiError(err, "Impossible de charger les affectations."));
    } finally {
      setRemovalLoading(false);
    }
  }

  async function onRemoveCourse(assignmentId: string) {
    if (removalSavingId || !assignmentId) return;
    setRemovalSavingId(assignmentId);
    setRemovalError(null);
    try {
      await teacherAssignmentsApi.remove(assignmentId);
      setRemovalRows((rows) => rows.filter((item) => item.id !== assignmentId));
      setConfirmingRemoval(null);
      showToast("Affectation retirée.", "success");
      try {
        await load();
      } catch {
        setRemovalError("Retrait effectué, mais actualisation impossible.");
      }
    } catch (err) {
      setRemovalError(mapApiError(err, "Retrait impossible."));
    } finally {
      setRemovalSavingId(null);
    }
  }

  function openDelete(row: SchoolTeacher) {
    setDeleting(row);
    setDeleteError(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      if (!editing) return;
      await teachersApi.update(editing.teacherCode || editing.publicId || editing.id, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        gender: form.gender || null,
        birthDate: form.birthDate,
        entryDate: form.entryDate || undefined,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        speciality: form.speciality.trim() || null,
      });
      setModalOpen(false);
      showToast("Enseignant modifié.", "success");
      await load();
    } catch (err) {
      const message = mapApiError(err, editing ? "Modification impossible." : "Création impossible.");
      setFormError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function onAssign(event: FormEvent) {
    event.preventDefault();
    if (!assigning || assignSaving) return;
    setAssignSaving(true);
    setAssignError(null);
    try {
      await teacherAssignmentsApi.create({
        teacherCode: assigning.teacherCode || assigning.publicId || assigning.id,
        classCode: assignForm.classCode,
        subjectCode: assignForm.subjectCode,
      });
      setAssigning(null);
      showToast("Affectation enregistrée.", "success");
      await load();
    } catch (err) {
      const message = formatCaughtApiError(err, "Affectation impossible.");
      setAssignError(message);
      showToast(message, "error");
    } finally {
      setAssignSaving(false);
    }
  }

  async function onDelete() {
    if (!deleting || deleteSaving) return;
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      await teachersApi.remove(deleting.teacherCode || deleting.publicId || deleting.id);
      setDeleting(null);
      showToast("Enseignant archivé. Le compte d'accès a été désactivé.", "success");
      await load();
    } catch (err) {
      const message = mapApiError(err, "Suppression impossible.");
      setDeleteError(message);
      showToast(message, "error");
    } finally {
      setDeleteSaving(false);
    }
  }

  const columns = useMemo(
    () => [
      {
        key: "lastName",
        header: "Nom",
        render: (row: SchoolTeacher) => row.lastName || row.name || "—",
      },
      {
        key: "firstName",
        header: "Prénom",
        render: (row: SchoolTeacher) => row.firstName || "—",
      },
      {
        key: "identifier",
        header: "Identifiant",
        render: (row: SchoolTeacher) => row.identifier || row.teacherCode || "—",
      },
      {
        key: "contact",
        header: "Contact",
        render: (row: SchoolTeacher) => row.phone || row.email || "—",
      },
      {
        key: "speciality",
        header: "Spécialité",
        render: (row: SchoolTeacher) => row.speciality || row.mainSubject || "—",
      },
      {
        key: "assignments",
        header: "Affectations",
        sortable: false,
        render: (row: SchoolTeacher) => formatAssignmentCell(row),
      },
      {
        key: "actions",
        header: "Actions",
        sortable: false,
        render: (row: SchoolTeacher) => (
          <div className="flex flex-wrap items-center gap-2">
            {permissions.canUpdate ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => openEdit(row)}>
                Modifier
              </Button>
            ) : null}
            {permissionsReady && assignmentPermissions.canCreate ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => void openAssign(row)}>
                Affecter un cours
              </Button>
            ) : null}
            {permissionsReady && assignmentPermissions.canRead ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!assignmentPermissions.canDelete}
                title={!assignmentPermissions.canDelete ? "Autorisation nécessaire : retirer les affectations" : undefined}
                onClick={() => void openRemoveCourse(row)}
              >
                Retirer un cours
              </Button>
            ) : null}
            {permissions.canDelete ? (
              <Button type="button" variant="danger" size="sm" onClick={() => openDelete(row)}>
                Supprimer
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [assignmentPermissions.canCreate, assignmentPermissions.canRead, assignmentPermissions.canDelete, permissions.canDelete, permissions.canUpdate, permissionsReady],
  );

  if (permissionCtx.permissionsBootstrap === "loading" || permissionCtx.permissionsBootstrap === "idle") {
    return (
      <EntityListShell title="Enseignants" description="Chargement des permissions effectives…">
        <p className="text-sm text-muted">Chargement des droits…</p>
      </EntityListShell>
    );
  }
  if (permissionCtx.permissionsBootstrap === "error") {
    return (
      <EntityListShell
        title="Enseignants"
        alerts={
          <InlineAlert tone="danger" title="Permissions indisponibles">
            {permissionCtx.permissionsBootstrapError ||
              "Les permissions effectives n'ont pas pu être chargées."}
          </InlineAlert>
        }
      >
        <p className="text-sm text-muted">La page reste indisponible tant que vos autorisations ne sont pas chargées.</p>
      </EntityListShell>
    );
  }

  if (!permissions.canRead) {
    return <EntityListForbidden moduleLabel="enseignants" />;
  }

  return (
    <>
      <EntityListShell
        title="Enseignants"
        description="Consultation, fiche, affectations et statut métier. La création d'identité se fait depuis Comptes utilisateurs."
        alerts={
          error ? (
            <InlineAlert tone="danger" title="Erreur">
              {error}
            </InlineAlert>
          ) : null
        }
        filters={
          <EntityListSearch
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher dans enseignants"
            aria-label="Rechercher dans enseignants"
          />
        }
        primaryActions={null}
        secondaryActions={
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
            Actualiser
          </Button>
        }
      >
        {loading ? (
          <p className="text-sm text-muted">Chargement des enseignants…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Liste vide"
            description="Aucun enseignant à afficher pour le moment."
          />
        ) : (
          <EntityListTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.teacherCode || row.publicId || row.id}
          />
        )}
      </EntityListShell>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Modifier l'enseignant"
      >
        <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
          {formError ? (
            <InlineAlert tone="danger" title="Erreur">
              {formError}
            </InlineAlert>
          ) : (
            <InlineAlert tone="info" title="Modifier un enseignant">
              Vous pouvez modifier les informations personnelles ici. Pour créer un nouvel enseignant, utilisez Comptes utilisateurs.
            </InlineAlert>
          )}
          <Field label="Prénom" htmlFor="teacher-first-name" required>
            <Input
              id="teacher-first-name"
              value={form.firstName}
              onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" htmlFor="teacher-last-name" required>
            <Input
              id="teacher-last-name"
              value={form.lastName}
              onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
              required
            />
          </Field>
          <Field label="Genre" htmlFor="teacher-gender">
            <Select
              id="teacher-gender"
              value={form.gender}
              onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))}
              options={[
                { value: "", label: "Non renseigné" },
                { value: "Masculin", label: "Masculin" },
                { value: "Féminin", label: "Féminin" },
                { value: "Autre", label: "Autre" },
              ]}
            />
          </Field>
          <Field label="Date de naissance" htmlFor="teacher-birth-date" hint="Format AAAA-MM-JJ" required>
            <DateInput
              id="teacher-birth-date"
              value={form.birthDate}
              onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))}
              required
            />
          </Field>
          <Field
            label="Date d'entrée"
            htmlFor="teacher-entry-date"
            hint="Optionnel — aujourd'hui par défaut. L'enseignant doit avoir 18 ans à cette date."
          >
            <DateInput
              id="teacher-entry-date"
              value={form.entryDate}
              onChange={(event) => setForm((current) => ({ ...current, entryDate: event.target.value }))}
            />
          </Field>
          <Field label="Téléphone" htmlFor="teacher-phone">
            <Input
              id="teacher-phone"
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            />
          </Field>
          <Field label="Email" htmlFor="teacher-email">
            <Input
              id="teacher-email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
          </Field>
          <Field label="Spécialité" htmlFor="teacher-speciality">
            <Input
              id="teacher-speciality"
              value={form.speciality}
              onChange={(event) =>
                setForm((current) => ({ ...current, speciality: event.target.value }))
              }
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(assigning)}
        onClose={() => setAssigning(null)}
        title={assigning ? `Affecter un cours — ${assigning.name || assigning.lastName}` : "Affecter un cours"}
      >
        <form className="space-y-3" onSubmit={(event) => void onAssign(event)}>
          {assignError ? (
            <InlineAlert tone="danger" title="Erreur">
              {assignError}
            </InlineAlert>
          ) : null}
          {assigning ? (
            <Field label="Enseignant" htmlFor="teacher-assign-name">
              <Input
                id="teacher-assign-name"
                value={assigning.name || `${assigning.firstName} ${assigning.lastName}`.trim()}
                readOnly
              />
            </Field>
          ) : null}
          {assigning && assignmentPermissions.canRead ? (
            <section aria-label="Affectations actuelles" className="space-y-2 rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-semibold">Affectations actuelles</p>
              {removalError ? <InlineAlert tone="danger" title="Affectations indisponibles">{removalError}</InlineAlert> : null}
              {removalLoading ? <p className="text-sm">Chargement des affectations…</p> : null}
              {!removalLoading && !removalError && removalRows.length === 0 ? (
                <p className="text-sm">Aucune affectation active.</p>
              ) : null}
              {!assignmentPermissions.canDelete && removalRows.length > 0 ? (
                <p className="text-sm text-muted">
                  Vous pouvez consulter ces cours, mais vous n&apos;avez pas l&apos;autorisation de les retirer. Demandez l&apos;accès à la gestion des affectations.
                </p>
              ) : null}
              {removalRows.map((assignment) => (
                <div key={assignment.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{assignment.className} · {assignment.course || assignment.subject}</span>
                  <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={!assignmentPermissions.canDelete || Boolean(removalSavingId)}
                      onClick={() => setConfirmingRemoval(assignment)}
                    >
                      {removalSavingId === assignment.id ? "Retrait…" : "Retirer"}
                    </Button>
                </div>
              ))}
              {confirmingRemoval && removalRows.some((item) => item.id === confirmingRemoval.id) ? (
                <div role="group" aria-label="Confirmer le retrait du cours" className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
                  <p className="text-sm font-semibold">Retirer ce cours ?</p>
                  <p className="text-sm">
                    {confirmingRemoval.className} · {confirmingRemoval.course || confirmingRemoval.subject}
                  </p>
                  <p className="text-sm">Les notes et les présences déjà enregistrées seront conservées.</p>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" size="sm" disabled={Boolean(removalSavingId)} onClick={() => setConfirmingRemoval(null)}>
                      Annuler le retrait
                    </Button>
                    <Button type="button" variant="danger" size="sm" disabled={Boolean(removalSavingId) || !assignmentPermissions.canDelete} onClick={() => void onRemoveCourse(confirmingRemoval.id)}>
                      {removalSavingId ? "Retrait…" : "Confirmer le retrait"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
          {classes.length === 0 ? (
            <InlineAlert tone="warning" title="Aucune classe">
              Aucune classe active n&apos;est disponible pour cet établissement.
            </InlineAlert>
          ) : null}
          {subjectsCatalogError ? (
            <InlineAlert tone="danger" title="Catalogue de cours indisponible">
              {subjectsCatalogError}
            </InlineAlert>
          ) : subjects.length === 0 ? (
            <InlineAlert tone="warning" title="Aucun cours">
              Aucun cours n&apos;est disponible pour cet établissement. Ajoutez-en dans Paramètres → Configuration.
            </InlineAlert>
          ) : null}
          <Field label="Classe" htmlFor="teacher-assign-class" required>
            <Select
              id="teacher-assign-class"
              value={assignForm.classCode}
              onChange={(event) =>
                setAssignForm((current) => ({ ...current, classCode: event.target.value }))
              }
              required
              options={[
                { value: "", label: "Sélectionner une classe" },
                ...classes.map((row) => ({
                  value: row.classCode,
                  label: row.name,
                })),
              ]}
            />
          </Field>
          <Field label="Cours" htmlFor="teacher-assign-subject" required>
            <Select
              id="teacher-assign-subject"
              value={assignForm.subjectCode}
              onChange={(event) =>
                setAssignForm((current) => ({ ...current, subjectCode: event.target.value }))
              }
              required
              options={[
                { value: "", label: "Sélectionner un cours" },
                ...subjects.map((row) => ({
                  value: row.code,
                  label: row.name,
                })),
              ]}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAssigning(null)}>
              Annuler
            </Button>
            <Button type="submit" disabled={assignSaving || !assignForm.classCode || !assignForm.subjectCode || classes.length === 0 || subjects.length === 0}>
              {assignSaving ? "Enregistrement…" : "Enregistrer l'affectation"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(removingFor)}
        onClose={() => { if (!removalSavingId) setRemovingFor(null); }}
        title={removingFor ? `Retirer un cours — ${removingFor.name || removingFor.lastName}` : "Retirer un cours"}
      >
        <div className="space-y-3">
          {removalError ? <InlineAlert tone="danger" title="Erreur">{removalError}</InlineAlert> : null}
          {removalLoading ? <p className="text-sm">Chargement des affectations…</p> : null}
          {!removalLoading && !removalError && removalRows.length === 0 ? (
            <p className="text-sm">Aucune affectation active à retirer.</p>
          ) : null}
          {!assignmentPermissions.canDelete && removalRows.length > 0 ? (
            <p className="text-sm text-muted">Vous n&apos;avez pas l&apos;autorisation de retirer ces cours. Demandez l&apos;accès à la gestion des affectations.</p>
          ) : null}
          {removalRows.map((assignment) => (
            <div key={assignment.id} className="flex items-center justify-between gap-3">
              <span className="text-sm">{assignment.className} · {assignment.course || assignment.subject}</span>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={!assignmentPermissions.canDelete || Boolean(removalSavingId)}
                onClick={() => setConfirmingRemoval(assignment)}
              >
                {removalSavingId === assignment.id ? "Retrait…" : "Retirer"}
              </Button>
            </div>
          ))}
          {confirmingRemoval && removalRows.some((item) => item.id === confirmingRemoval.id) ? (
            <div role="group" aria-label="Confirmer le retrait du cours" className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
              <p className="text-sm font-semibold">Retirer ce cours ?</p>
              <p className="text-sm">{confirmingRemoval.className} · {confirmingRemoval.course || confirmingRemoval.subject}</p>
              <p className="text-sm">Les notes et les présences déjà enregistrées seront conservées.</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={Boolean(removalSavingId)} onClick={() => setConfirmingRemoval(null)}>
                  Annuler le retrait
                </Button>
                <Button type="button" variant="danger" size="sm" disabled={Boolean(removalSavingId) || !assignmentPermissions.canDelete} onClick={() => void onRemoveCourse(confirmingRemoval.id)}>
                  {removalSavingId ? "Retrait…" : "Confirmer le retrait"}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button type="button" variant="secondary" disabled={Boolean(removalSavingId)} onClick={() => { setConfirmingRemoval(null); setRemovingFor(null); }}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Archiver l'enseignant"
      >
        <div className="space-y-3">
          {deleteError ? (
            <InlineAlert tone="danger" title="Erreur">
              {deleteError}
            </InlineAlert>
          ) : (
            <InlineAlert tone="warning" title="Compte d'accès">
              Cette action archive l&apos;enseignant et désactive son compte de connexion. Les notes,
              évaluations et présences historiques sont conservées.
            </InlineAlert>
          )}
          <p className="text-sm">
            Confirmer l&apos;archivage de{" "}
            <strong>{deleting?.name || `${deleting?.firstName ?? ""} ${deleting?.lastName ?? ""}`.trim()}</strong> ?
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setDeleting(null)}>
              Annuler
            </Button>
            <Button type="button" variant="danger" disabled={deleteSaving} onClick={() => void onDelete()}>
              {deleteSaving ? "Archivage…" : "Confirmer la suppression"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
