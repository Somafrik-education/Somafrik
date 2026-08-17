import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
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
import { classesApi, type SchoolClass } from "../../lib/classesApi";
import {
  classStudentsApi,
  type ClassStudent,
  type EnrollClassStudentPayload,
} from "../../lib/classStudentsApi";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { getEntityFeaturePermissions } from "../../lib/permissions";

type EnrollFormState = {
  firstName: string;
  lastName: string;
  gender: string;
  birthDate: string;
  parentPhone: string;
  parentEmail: string;
};

const EMPTY_FORM: EnrollFormState = {
  firstName: "",
  lastName: "",
  gender: "",
  birthDate: "",
  parentPhone: "",
  parentEmail: "",
};

/**
 * Inscription d'élèves depuis une classe existante (PostgreSQL).
 * Le classCode provient de la classe ouverte — aucun choix libre d'établissement ou d'année.
 */
export function ClassStudentsPage() {
  const { classCode = "" } = useParams();
  const decodedClassCode = decodeURIComponent(classCode).trim();
  const { showToast } = useToast();
  const permissionCtx = usePermissionContext();
  const permissions = getEntityFeaturePermissions(permissionCtx, "students", "Élèves");

  const [schoolClass, setSchoolClass] = useState<SchoolClass | null>(null);
  const [rows, setRows] = useState<ClassStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<EnrollFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!decodedClassCode) return;
    setLoading(true);
    setError(null);
    try {
      const [classes, students] = await Promise.all([
        classesApi.list(),
        classStudentsApi.list(decodedClassCode),
      ]);
      const current = (Array.isArray(classes) ? classes : []).find(
        (item) => item.classCode === decodedClassCode,
      );
      if (!current) {
        setError("Classe introuvable dans votre établissement.");
        setSchoolClass(null);
        setRows([]);
        return;
      }
      setSchoolClass(current);
      setRows(Array.isArray(students) ? students : []);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Impossible de charger les élèves de la classe.";
      setError(message);
      setSchoolClass(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [decodedClassCode]);

  useEffect(() => {
    if (!permissions.canRead || !decodedClassCode) {
      setLoading(false);
      return;
    }
    void load();
  }, [decodedClassCode, load, permissions.canRead]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.name, row.firstName, row.lastName, row.studentCode, row.matricule, row.loginCode, row.identifier, row.gender]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  function openEnroll() {
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || !decodedClassCode) return;
    setSaving(true);
    try {
      const payload: EnrollClassStudentPayload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        gender: form.gender || undefined,
        birthDate: form.birthDate || undefined,
        parentPhone: form.parentPhone.trim() || undefined,
        parentEmail: form.parentEmail.trim() || undefined,
      };
      const created = await classStudentsApi.enroll(decodedClassCode, payload);
      setRows((current) =>
        [...current, created].sort((a, b) => a.lastName.localeCompare(b.lastName, "fr")),
      );
      setModalOpen(false);
      showToast("Élève inscrit dans la classe.", "success");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Inscription impossible.";
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  const columns = useMemo(
    () => [
      { key: "lastName", header: "Nom", render: (row: ClassStudent) => row.lastName || "—" },
      { key: "firstName", header: "Prénom", render: (row: ClassStudent) => row.firstName || "—" },
      {
        key: "studentCode",
        header: "Matricule",
        render: (row: ClassStudent) => row.studentCode || row.matricule || "—",
      },
      { key: "gender", header: "Genre", render: (row: ClassStudent) => row.gender || "—" },
      {
        key: "actions",
        header: "Actions",
        sortable: false,
        render: (row: ClassStudent) => (
          <Link
            className="text-sm underline"
            to={`/etablissement/eleves/${encodeURIComponent(row.studentCode)}`}
          >
            Dossier
          </Link>
        ),
      },
    ],
    [],
  );

  if (!decodedClassCode) {
    return <Navigate to="/etablissement/classes" replace />;
  }

  if (!permissions.canRead) {
    return <EntityListForbidden moduleLabel="Élèves" />;
  }

  const classLabel = schoolClass?.name ?? decodedClassCode;
  const canEnroll = permissions.canCreate && schoolClass?.status === "active";

  return (
    <>
      <EntityListShell
        title={`Élèves — ${classLabel}`}
        description={`Inscription et dossiers des élèves de la classe ${classLabel}.`}
        orientation={
          <Link
            to="/etablissement/classes"
            className="inline-flex font-semibold text-brand hover:underline"
          >
            ← Retour aux classes
          </Link>
        }
        alerts={
          error ? (
            <InlineAlert tone="danger" title="Erreur">
              {error}
            </InlineAlert>
          ) : schoolClass?.status === "inactive" ? (
            <InlineAlert tone="warning" title="Classe inactive">
              Cette classe est inactive. L&apos;inscription de nouveaux élèves n&apos;est pas
              disponible.
            </InlineAlert>
          ) : null
        }
        filters={
          <EntityListSearch
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher dans élèves"
            aria-label="Rechercher dans élèves"
          />
        }
        primaryActions={
          canEnroll ? (
            <Button type="button" onClick={openEnroll}>
              Inscrire un élève
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
          <p className="text-sm text-muted">Chargement des élèves…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Liste vide"
            description="Aucun élève inscrit dans cette classe pour le moment."
          />
        ) : (
          <EntityListTable columns={columns} rows={filtered} rowKey={(row) => row.studentCode} />
        )}
      </EntityListShell>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Inscrire un élève">
        <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
          <InlineAlert tone="info" title="Classe d'inscription">
            {classLabel} ({decodedClassCode}) — année {schoolClass?.academicYearName ?? "—"}
          </InlineAlert>
          <Field label="Prénom" htmlFor="enroll-first-name" required>
            <Input
              id="enroll-first-name"
              value={form.firstName}
              onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
              required
            />
          </Field>
          <Field label="Nom" htmlFor="enroll-last-name" required>
            <Input
              id="enroll-last-name"
              value={form.lastName}
              onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
              required
            />
          </Field>
          <Field label="Genre" htmlFor="enroll-gender">
            <Select
              id="enroll-gender"
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
          <Field label="Date de naissance" htmlFor="enroll-birth-date" hint="Format AAAA-MM-JJ">
            <Input
              id="enroll-birth-date"
              type="date"
              value={form.birthDate}
              onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))}
            />
          </Field>
          <Field label="Téléphone parent" htmlFor="enroll-parent-phone">
            <Input
              id="enroll-parent-phone"
              value={form.parentPhone}
              onChange={(event) =>
                setForm((current) => ({ ...current, parentPhone: event.target.value }))
              }
            />
          </Field>
          <Field label="Email parent" htmlFor="enroll-parent-email">
            <Input
              id="enroll-parent-email"
              type="email"
              value={form.parentEmail}
              onChange={(event) =>
                setForm((current) => ({ ...current, parentEmail: event.target.value }))
              }
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Inscription…" : "Inscrire"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
