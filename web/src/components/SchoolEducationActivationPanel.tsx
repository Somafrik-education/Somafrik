import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useData } from "../context/DataContext";
import { useToast } from "../design-system";
import { educationReferenceApi, type EducationSchoolCatalog } from "../lib/educationReferenceApi";

type Props = {
  schoolCode: string;
  canConfigure: boolean;
};

export function SchoolEducationActivationPanel({ schoolCode, canConfigure }: Props) {
  const { showToast } = useToast();
  const { refresh } = useData();
  const [catalog, setCatalog] = useState<EducationSchoolCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedLevelIds, setSelectedLevelIds] = useState<string[]>([]);
  const [selectedStreamIds, setSelectedStreamIds] = useState<string[]>([]);

  const loadCatalog = useCallback(async () => {
    if (!schoolCode) return;
    setLoading(true);
    try {
      const response = await educationReferenceApi.getSchoolCatalog(schoolCode);
      setCatalog(response);
      setSelectedLevelIds(response.levels.filter((row) => row.schoolActive).map((row) => row.id));
      setSelectedStreamIds(response.streams.filter((row) => row.schoolActive).map((row) => row.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de charger le référentiel pédagogique.";
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [schoolCode, showToast]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const streamsByType = useMemo(() => {
    const groups: Record<string, EducationSchoolCatalog["streams"]> = { filiere: [], serie: [], option: [] };
    for (const stream of catalog?.streams ?? []) {
      groups[stream.streamType]?.push(stream);
    }
    return groups;
  }, [catalog]);

  function toggleId(current: string[], id: string, checked: boolean) {
    if (checked) return [...new Set([...current, id])];
    return current.filter((value) => value !== id);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canConfigure) {
      showToast("Vous n'avez pas les droits pour modifier cette configuration.", "error");
      return;
    }
    setSaving(true);
    try {
      await educationReferenceApi.saveSchoolActivation(
        { levelIds: selectedLevelIds, streamIds: selectedStreamIds },
        schoolCode,
      );
      await refresh();
      await loadCatalog();
      showToast("Structure pédagogique activée pour l'établissement.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Échec de l'enregistrement.";
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted">Chargement du référentiel pédagogique…</p>;
  }

  if (!catalog) {
    return <p className="text-sm text-muted">Référentiel indisponible.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <p className="text-sm text-muted">
        Pays de l&apos;établissement : <strong>{catalog.countryCode}</strong>. Sélectionnez le sous-ensemble proposé
        pour votre établissement. Les libellés nationaux ne sont pas modifiables ici.
      </p>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{catalog.labels?.levelLabel ?? "Niveau"}s disponibles</h3>
        {catalog.levels.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {catalog.levels.map((level) => (
              <label key={level.id} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!canConfigure}
                  checked={selectedLevelIds.includes(level.id)}
                  onChange={(event) => setSelectedLevelIds((current) => toggleId(current, level.id, event.target.checked))}
                />
                <span>{level.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Aucun niveau défini pour ce pays. Contactez le Superadmin ou l&apos;Admin Pays.</p>
        )}
      </div>

      {(["filiere", "serie", "option"] as const).map((streamType) => (
        <div key={streamType}>
          <h3 className="mb-2 text-sm font-semibold">
            {streamType === "filiere" ? "Filières" : streamType === "serie" ? "Séries" : "Options"}
          </h3>
          {streamsByType[streamType]?.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {streamsByType[streamType].map((stream) => (
                <label key={stream.id} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!canConfigure}
                    checked={selectedStreamIds.includes(stream.id)}
                    onChange={(event) =>
                      setSelectedStreamIds((current) => toggleId(current, stream.id, event.target.checked))
                    }
                  />
                  <span>{stream.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Aucune entrée pour cette catégorie.</p>
          )}
        </div>
      ))}

      <button
        type="submit"
        disabled={!canConfigure || saving}
        className="inline-flex items-center rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? "Enregistrement…" : "Enregistrer l'activation"}
      </button>
    </form>
  );
}
