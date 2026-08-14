import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { Card, SectionHeader, useToast } from "../design-system";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { educationReferenceApi, type EducationLevel, type EducationStream } from "../lib/educationReferenceApi";
import { isSuperAdminRole } from "../lib/orgHierarchy";

export function EducationReferencePage() {
  const { session } = useAuth();
  const { state } = useData();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const countries = state.countries ?? [];
  const [countryCode, setCountryCode] = useState(countries[0]?.code ?? "CD");
  const [levels, setLevels] = useState<EducationLevel[]>([]);
  const [streams, setStreams] = useState<EducationStream[]>([]);
  const [loading, setLoading] = useState(false);
  const [levelName, setLevelName] = useState("");
  const [levelCode, setLevelCode] = useState("");
  const [streamName, setStreamName] = useState("");
  const [streamCode, setStreamCode] = useState("");
  const [streamType, setStreamType] = useState<"filiere" | "serie" | "option">("filiere");

  const canManage = isSuperAdminRole(session?.user?.role);

  const load = useCallback(async () => {
    if (!countryCode) return;
    setLoading(true);
    try {
      const [levelsResponse, streamsResponse] = await Promise.all([
        educationReferenceApi.listLevels(countryCode, true),
        educationReferenceApi.listStreams(countryCode),
      ]);
      setLevels(levelsResponse.levels ?? []);
      setStreams(streamsResponse.streams ?? []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Chargement impossible", "error");
    } finally {
      setLoading(false);
    }
  }, [countryCode, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreateLevel(event: FormEvent) {
    event.preventDefault();
    try {
      await educationReferenceApi.createLevel({ countryCode, name: levelName, code: levelCode });
      setLevelName("");
      setLevelCode("");
      await load();
      showToast("Niveau créé.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Création impossible", "error");
    }
  }

  async function handleCreateStream(event: FormEvent) {
    event.preventDefault();
    try {
      await educationReferenceApi.createStream({ countryCode, name: streamName, code: streamCode, streamType });
      setStreamName("");
      setStreamCode("");
      await load();
      showToast("Filière créée.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Création impossible", "error");
    }
  }

  async function handleArchiveLevel(level: EducationLevel) {
    const accepted = await confirm({
      title: "Archiver le niveau",
      description: `Archiver « ${level.name} » ? Cette action est irréversible côté catalogue.`,
      confirmLabel: "Archiver",
      tone: "danger",
    });
    if (!accepted) return;
    try {
      await educationReferenceApi.archiveLevel(level.id);
      await load();
      showToast("Niveau archivé.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Archivage impossible", "error");
    }
  }

  async function handleArchiveStream(stream: EducationStream) {
    const accepted = await confirm({
      title: "Archiver la filière",
      description: `Archiver « ${stream.name} » ?`,
      confirmLabel: "Archiver",
      tone: "danger",
    });
    if (!accepted) return;
    try {
      await educationReferenceApi.archiveStream(stream.id);
      await load();
      showToast("Filière archivée.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Archivage impossible", "error");
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Référentiels pédagogiques"
        description="Catalogue canonique par pays : niveaux, filières, séries et options. Réservé au Superadmin."
      />

      <Card className="p-4">
        <label className="text-sm font-medium">
          Pays
          <select
            className="mt-1 block w-full rounded border border-border px-3 py-2"
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
          >
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name} ({country.code})
              </option>
            ))}
          </select>
        </label>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Niveaux</h2>
        {canManage ? (
          <form onSubmit={handleCreateLevel} className="grid gap-3 md:grid-cols-3">
            <input className="rounded border px-3 py-2" placeholder="Nom" value={levelName} onChange={(e) => setLevelName(e.target.value)} required />
            <input className="rounded border px-3 py-2" placeholder="Code" value={levelCode} onChange={(e) => setLevelCode(e.target.value)} required />
            <button type="submit" className="rounded bg-primary px-4 py-2 text-white">Créer niveau</button>
          </form>
        ) : null}
        {loading ? <p className="text-sm text-muted">Chargement…</p> : null}
        <ul className="space-y-2">
          {levels.map((level) => (
            <li key={level.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>
                {level.name} <span className="text-muted">({level.code})</span> — {level.status}
              </span>
              {canManage && level.status === "active" ? (
                <button type="button" className="text-danger" onClick={() => void handleArchiveLevel(level)}>
                  Archiver
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Filières / séries / options</h2>
        {canManage ? (
          <form onSubmit={handleCreateStream} className="grid gap-3 md:grid-cols-4">
            <input className="rounded border px-3 py-2" placeholder="Nom" value={streamName} onChange={(e) => setStreamName(e.target.value)} required />
            <input className="rounded border px-3 py-2" placeholder="Code" value={streamCode} onChange={(e) => setStreamCode(e.target.value)} required />
            <select className="rounded border px-3 py-2" value={streamType} onChange={(e) => setStreamType(e.target.value as typeof streamType)}>
              <option value="filiere">Filière</option>
              <option value="serie">Série</option>
              <option value="option">Option</option>
            </select>
            <button type="submit" className="rounded bg-primary px-4 py-2 text-white">Créer</button>
          </form>
        ) : null}
        <ul className="space-y-2">
          {streams.map((stream) => (
            <li key={stream.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>
                {stream.name} ({stream.streamType}) — {stream.status}
              </span>
              {canManage && stream.status === "active" ? (
                <button type="button" className="text-danger" onClick={() => void handleArchiveStream(stream)}>
                  Archiver
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
