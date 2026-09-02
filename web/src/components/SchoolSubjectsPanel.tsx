import { FormEvent, useCallback, useEffect, useState } from "react";
import { Button, EmptyState, InlineAlert, SectionHeader } from "@/design-system";
import { Field, Input } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { ApiError } from "../api/client";
import { formatCaughtApiError } from "../lib/apiErrors";
import { isArchivedSubjectStatus, subjectsApi, type SchoolSubject } from "../lib/subjectsApi";

export function SchoolSubjectsPanel({ canCreate }: { canCreate: boolean }) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<SchoolSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await subjectsApi.list();
      setRows(list.filter((item) => !isArchivedSubjectStatus(item.status)));
    } catch (err) {
      console.error(
        JSON.stringify({
          kind: "subjects_catalog_load_failure",
          status: err instanceof ApiError ? err.status : null,
          message: err instanceof Error ? err.message : "unknown",
        }),
      );
      setRows([]);
      setError(formatCaughtApiError(err, "Impossible de charger les cours."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!canCreate || saving) return;
    setSaving(true);
    try {
      await subjectsApi.create({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        coefficient: 1,
        status: "active",
      });
      setName("");
      setCode("");
      showToast("Cours enregistré.", "success");
      await load();
    } catch (err) {
      showToast(formatCaughtApiError(err, "Création de cours impossible."), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Cours"
        description="Référentiel PostgreSQL (/api/v2/subjects). Aucune liste JSON locale."
      />
      {error ? (
        <InlineAlert tone="danger" title="Catalogue de cours indisponible">
          {error}
        </InlineAlert>
      ) : loading ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : rows.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
          {rows.map((subject) => (
            <li key={subject.code}>
              {subject.name} ({subject.code})
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="Aucun cours"
          description="Aucun cours n'est configuré pour cet établissement. Créez-le ici ; il sera lu par la modal Affecter."
        />
      )}
      {canCreate ? (
        <form className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]" onSubmit={(event) => void onCreate(event)}>
          <Field label="Nom" htmlFor="school-subject-name" required>
            <Input
              id="school-subject-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Field label="Code" htmlFor="school-subject-code" required>
            <Input
              id="school-subject-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              required
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={saving || !name.trim() || !code.trim()}>
              {saving ? "Enregistrement…" : "Ajouter un cours"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
