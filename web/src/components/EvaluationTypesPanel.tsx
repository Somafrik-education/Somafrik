import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, FormField, Input, useToast } from "../design-system";
import { ApiError } from "../api/client";
import { evaluationTypesApi, type CanonicalEvaluationType } from "../lib/evaluationTypesApi";
import { isSuperAdminRole } from "../lib/orgHierarchy";

type Props = {
  schoolCode: string;
  canConfigure: boolean;
  userRole?: string;
};

function formatHttpError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return error.message || "Requête invalide.";
    if (error.status === 403) return "Vous n'avez pas le droit de modifier les types d'évaluation.";
    if (error.status === 404) return "Type d'évaluation introuvable.";
    if (error.status === 409) return error.message || "Conflit : type déjà existant ou archivé.";
    if (error.status >= 500) return "Erreur serveur. Réessayez plus tard.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Erreur inattendue.";
}

export function EvaluationTypesPanel({ schoolCode, canConfigure, userRole }: Props) {
  const { showToast } = useToast();
  const [types, setTypes] = useState<CanonicalEvaluationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const backoffice = isSuperAdminRole(userRole);

  const loadTypes = useCallback(async () => {
    if (!schoolCode) return;
    setLoading(true);
    try {
      const response = await evaluationTypesApi.list({
        schoolCode: backoffice ? schoolCode : undefined,
      });
      setTypes((response.types ?? []).filter((row) => row.status === "active"));
    } catch (error) {
      showToast(formatHttpError(error), "error");
    } finally {
      setLoading(false);
    }
  }, [schoolCode, backoffice, showToast]);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!canConfigure) {
      showToast("Vous n'avez pas les droits pour modifier cette configuration.", "error");
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await evaluationTypesApi.create({ name: trimmed }, backoffice ? schoolCode : undefined);
      setName("");
      await loadTypes();
      showToast("Type d'évaluation créé.", "success");
    } catch (error) {
      showToast(formatHttpError(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(typeId: string) {
    if (!canConfigure) {
      showToast("Vous n'avez pas les droits pour modifier cette configuration.", "error");
      return;
    }
    setSaving(true);
    try {
      await evaluationTypesApi.archive(typeId, backoffice ? schoolCode : undefined);
      await loadTypes();
      showToast("Type d'évaluation archivé.", "success");
    } catch (error) {
      showToast(formatHttpError(error), "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted">Chargement des types d'évaluation…</p>;
  }

  return (
    <div className="space-y-4">
      {types.length ? (
        <ul className="space-y-2">
          {types.map((type) => (
            <li key={type.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <div>
                <p className="font-medium">{type.name}</p>
                <p className="text-xs text-muted">{type.code}</p>
              </div>
              {canConfigure ? (
                <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void handleArchive(type.id)}>
                  Archiver
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Aucun type actif. Le catalogue PostgreSQL de l'établissement est vide.</p>
      )}
      {canConfigure ? (
        <form onSubmit={handleCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <FormField label="Nouveau type" className="flex-1">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Devoir blanc" />
          </FormField>
          <Button type="submit" disabled={saving || !name.trim()}>
            Ajouter
          </Button>
        </form>
      ) : null}
    </div>
  );
}
