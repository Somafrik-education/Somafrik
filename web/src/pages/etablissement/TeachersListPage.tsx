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
import { teachersApi, type CreateTeacherPayload, type SchoolTeacher } from "../../lib/teachersApi";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { getEntityFeaturePermissions } from "../../lib/permissions";

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
    if (err.status === 403) {
      return err.message || "Accès refusé.";
    }
    if (err.status === 409) {
      return err.message || "Conflit : cette identité enseignant est ambiguë ou déjà présente.";
    }
    if (err.status === 400) {
      return err.message || "Données invalides.";
    }
    if (err.status >= 500) {
      return err.message || "Erreur serveur. Réessayez plus tard.";
    }
    return err.message || fallback;
  }
  return fallback;
}

/**
 * Liste et création d'enseignants via /api/teachers (PostgreSQL).
 * Affectations, modification et suppression hors périmètre de cette PR.
 */
export function TeachersListPage() {
  const { showToast } = useToast();
  const permissionCtx = usePermissionContext();
  const permissions = getEntityFeaturePermissions(permissionCtx, "teachers", "Enseignants");

  const [rows, setRows] = useState<SchoolTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<TeacherFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const payload: CreateTeacherPayload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        gender: form.gender || undefined,
        birthDate: form.birthDate,
        entryDate: form.entryDate || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        speciality: form.speciality.trim() || undefined,
        temporaryPassword: form.temporaryPassword,
      };
      await teachersApi.create(payload);
      setModalOpen(false);
      showToast("Enseignant créé avec son compte de connexion.", "success");
      await load();
    } catch (err) {
      const message = mapApiError(err, "Création impossible.");
      setFormError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
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
        key: "actions",
        header: "Actions",
        sortable: false,
        render: () => (
          <span className="text-sm text-muted">Modifier / Supprimer / Affecter — prochaine PR</span>
        ),
      },
    ],
    [],
  );

  if (!permissions.canRead) {
    return <EntityListForbidden moduleLabel="enseignants" />;
  }

  return (
    <>
      <EntityListShell
        title="Enseignants"
        description="Création des enseignants et de leur compte de connexion."
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
        primaryActions={
          permissions.canCreate ? (
            <Button type="button" onClick={openCreate}>
              Ajouter un enseignant
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Ajouter un enseignant">
        <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
          {formError ? (
            <InlineAlert tone="danger" title="Erreur">
              {formError}
            </InlineAlert>
          ) : (
            <InlineAlert tone="info" title="Compte de connexion">
              L&apos;identifiant et le code enseignant sont générés automatiquement. Le mot de passe
              temporaire devra être changé à la première connexion.
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
            <Input
              id="teacher-birth-date"
              type="date"
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
            <Input
              id="teacher-entry-date"
              type="date"
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
          <Field label="Mot de passe temporaire" htmlFor="teacher-temp-password" required>
            <Input
              id="teacher-temp-password"
              type="password"
              autoComplete="new-password"
              value={form.temporaryPassword}
              onChange={(event) =>
                setForm((current) => ({ ...current, temporaryPassword: event.target.value }))
              }
              required
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Création…" : "Créer l'enseignant"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
