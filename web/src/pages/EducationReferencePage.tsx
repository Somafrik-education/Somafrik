import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { Card, SectionHeader, useToast } from "../design-system";
import { useConfirm } from "../components/ui/ConfirmDialog";
import {
  educationReferenceApi,
  type EducationLevel,
  type EducationPedagogicalLabels,
  type EducationStream,
  type EducationClassGroup,
} from "../lib/educationReferenceApi";
import { initialCatalogCountryCode } from "../lib/educationReferenceCountry";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole, scopedCountries } from "../lib/orgHierarchy";
import { useFeaturePermissions } from "../lib/usePermissionContext";

const GENERIC_LABELS: EducationPedagogicalLabels = {
  levelLabel: "Niveau",
  trackLabel: "Filière",
  groupLabel: "Groupe",
};

export function EducationReferencePage() {
  const { session } = useAuth();
  const { state, refresh } = useData();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const catalogPermissions = useFeaturePermissions("Référentiels pédagogiques");
  const user = session?.user ?? null;
  const isSuperAdmin = isSuperAdminRole(user?.role);
  const isCountryAdmin = user?.role === COUNTRY_ADMIN_ROLE;
  const visibleCountries = useMemo(() => scopedCountries(user, state.countries ?? []), [user, state.countries]);
  const [countryCode, setCountryCode] = useState("");
  const [levels, setLevels] = useState<EducationLevel[]>([]);
  const [streams, setStreams] = useState<EducationStream[]>([]);
  const [groups, setGroups] = useState<EducationClassGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [levelName, setLevelName] = useState("");
  const [levelCode, setLevelCode] = useState("");
  const [streamName, setStreamName] = useState("");
  const [streamCode, setStreamCode] = useState("");
  const [streamType, setStreamType] = useState<"filiere" | "serie" | "option">("filiere");
  const [groupName, setGroupName] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [labelDraft, setLabelDraft] = useState<EducationPedagogicalLabels>(GENERIC_LABELS);

  const canCreate = isSuperAdmin || catalogPermissions.canCreate;
  const canUpdate = isSuperAdmin || catalogPermissions.canUpdate;
  const selectedCountry = visibleCountries.find((country) => country.code === countryCode);
  const labels: EducationPedagogicalLabels = {
    levelLabel: selectedCountry?.levelLabel || GENERIC_LABELS.levelLabel,
    trackLabel: selectedCountry?.trackLabel || GENERIC_LABELS.trackLabel,
    groupLabel: selectedCountry?.groupLabel || GENERIC_LABELS.groupLabel,
  };

  useEffect(() => {
    if (countryCode) return;
    const next = initialCatalogCountryCode({
      isCountryAdmin,
      visibleCountryCodes: visibleCountries.map((country) => country.code).filter(Boolean),
    });
    if (next) setCountryCode(next);
  }, [countryCode, isCountryAdmin, visibleCountries]);

  useEffect(() => {
    setLabelDraft(labels);
  }, [labels.levelLabel, labels.trackLabel, labels.groupLabel]);

  const load = useCallback(async () => {
    if (!countryCode) {
      setLevels([]);
      setStreams([]);
      setGroups([]);
      return;
    }
    setLoading(true);
    try {
      const [levelsResponse, streamsResponse, groupsResponse] = await Promise.all([
        educationReferenceApi.listLevels(countryCode, true),
        educationReferenceApi.listStreams(countryCode),
        educationReferenceApi.listGroups(countryCode, true),
      ]);
      setLevels(levelsResponse.levels ?? []);
      setStreams(streamsResponse.streams ?? []);
      setGroups(groupsResponse.groups ?? []);
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
    if (!countryCode) return;
    try {
      await educationReferenceApi.createLevel({ countryCode, name: levelName, code: levelCode });
      setLevelName("");
      setLevelCode("");
      await load();
      showToast(`${labels.levelLabel} créé.`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Création impossible", "error");
    }
  }

  async function handleCreateStream(event: FormEvent) {
    event.preventDefault();
    if (!countryCode) return;
    try {
      await educationReferenceApi.createStream({ countryCode, name: streamName, code: streamCode, streamType });
      setStreamName("");
      setStreamCode("");
      await load();
      showToast(`${labels.trackLabel} créé.`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Création impossible", "error");
    }
  }

  async function handleCreateGroup(event: FormEvent) {
    event.preventDefault();
    if (!countryCode) return;
    try {
      await educationReferenceApi.createGroup({ countryCode, code: groupCode, name: groupName || groupCode });
      setGroupName("");
      setGroupCode("");
      await load();
      showToast(`${labels.groupLabel} créé.`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Création impossible", "error");
    }
  }

  async function handleArchiveLevel(level: EducationLevel) {
    const accepted = await confirm({
      title: `Archiver le ${labels.levelLabel.toLowerCase()}`,
      description: `Archiver « ${level.name} » ? Cette action est irréversible côté catalogue.`,
      confirmLabel: "Archiver",
      tone: "danger",
    });
    if (!accepted) return;
    try {
      await educationReferenceApi.archiveLevel(level.id);
      await load();
      showToast("Élément archivé.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Archivage impossible", "error");
    }
  }

  async function handleArchiveStream(stream: EducationStream) {
    const accepted = await confirm({
      title: `Archiver — ${labels.trackLabel.toLowerCase()}`,
      description: `Archiver « ${stream.name} » ?`,
      confirmLabel: "Archiver",
      tone: "danger",
    });
    if (!accepted) return;
    try {
      await educationReferenceApi.archiveStream(stream.id);
      await load();
      showToast("Élément archivé.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Archivage impossible", "error");
    }
  }

  async function handleArchiveGroup(group: EducationClassGroup) {
    const accepted = await confirm({
      title: `Archiver le ${labels.groupLabel.toLowerCase()}`,
      description: `Archiver « ${group.name} » ? Cette action est irréversible côté catalogue.`,
      confirmLabel: "Archiver",
      tone: "danger",
    });
    if (!accepted) return;
    try {
      await educationReferenceApi.archiveGroup(group.id);
      await load();
      showToast("Élément archivé.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Archivage impossible", "error");
    }
  }

  async function handleSaveLabels(event: FormEvent) {
    event.preventDefault();
    if (!countryCode) return;
    try {
      await educationReferenceApi.updateCountryLabels({ countryCode, ...labelDraft });
      await refresh();
      showToast("Libellés du pays enregistrés.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Enregistrement impossible", "error");
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Référentiels pédagogiques"
        description="Catalogue canonique par pays : niveaux, filières/options et groupes. Réservé au Super administrateur et à l’Administrateur pays. Aucun défaut RDC."
      />

      <Card className="p-4">
        <label className="text-sm font-medium" htmlFor="education-reference-country">
          Pays
          <select
            id="education-reference-country"
            className="mt-1 block w-full rounded border border-border px-3 py-2"
            value={countryCode}
            disabled={isCountryAdmin && visibleCountries.length === 1}
            onChange={(event) => setCountryCode(event.target.value)}
          >
            <option value="">Choisir un pays…</option>
            {visibleCountries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name} ({country.code})
              </option>
            ))}
          </select>
        </label>
      </Card>

      {!countryCode ? (
        <p className="text-sm text-muted">Sélectionnez un pays pour charger son catalogue. Aucune valeur n&apos;est préremplie.</p>
      ) : (
        <>
          {canUpdate ? (
            <Card className="p-6 space-y-4">
              <h2 className="text-lg font-semibold">Libellés d&apos;écran du pays</h2>
              <p className="text-sm text-muted">
                Concepts canoniques : Niveau, Filière/Option, Groupe. L&apos;affichage peut varier selon le pays.
              </p>
              <form onSubmit={handleSaveLabels} className="grid gap-3 md:grid-cols-4">
                <input
                  className="rounded border px-3 py-2"
                  aria-label="Libellé niveau"
                  value={labelDraft.levelLabel}
                  onChange={(event) => setLabelDraft((current) => ({ ...current, levelLabel: event.target.value }))}
                  required
                />
                <input
                  className="rounded border px-3 py-2"
                  aria-label="Libellé filière"
                  value={labelDraft.trackLabel}
                  onChange={(event) => setLabelDraft((current) => ({ ...current, trackLabel: event.target.value }))}
                  required
                />
                <input
                  className="rounded border px-3 py-2"
                  aria-label="Libellé groupe"
                  value={labelDraft.groupLabel}
                  onChange={(event) => setLabelDraft((current) => ({ ...current, groupLabel: event.target.value }))}
                  required
                />
                <button type="submit" className="rounded bg-primary px-4 py-2 text-white">
                  Enregistrer les libellés
                </button>
              </form>
            </Card>
          ) : null}

          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">{labels.levelLabel}s</h2>
            {canCreate ? (
              <form onSubmit={handleCreateLevel} className="grid gap-3 md:grid-cols-3">
                <input className="rounded border px-3 py-2" placeholder="Nom" value={levelName} onChange={(e) => setLevelName(e.target.value)} required />
                <input className="rounded border px-3 py-2" placeholder="Code" value={levelCode} onChange={(e) => setLevelCode(e.target.value)} required />
                <button type="submit" className="rounded bg-primary px-4 py-2 text-white">
                  Créer
                </button>
              </form>
            ) : null}
            {loading ? <p className="text-sm text-muted">Chargement…</p> : null}
            <ul className="space-y-2">
              {levels.map((level) => (
                <li key={level.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                  <span>
                    {level.name} <span className="text-muted">({level.code})</span> — {level.status}
                  </span>
                  {canUpdate && level.status === "active" ? (
                    <button type="button" className="text-danger" onClick={() => void handleArchiveLevel(level)}>
                      Archiver
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {!loading && !levels.length ? (
              <p className="text-sm text-muted">Aucun {labels.levelLabel.toLowerCase()} défini pour ce pays.</p>
            ) : null}
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">{labels.trackLabel}s</h2>
            {canCreate ? (
              <form onSubmit={handleCreateStream} className="grid gap-3 md:grid-cols-4">
                <input className="rounded border px-3 py-2" placeholder="Nom" value={streamName} onChange={(e) => setStreamName(e.target.value)} required />
                <input className="rounded border px-3 py-2" placeholder="Code" value={streamCode} onChange={(e) => setStreamCode(e.target.value)} required />
                <select className="rounded border px-3 py-2" value={streamType} onChange={(e) => setStreamType(e.target.value as typeof streamType)}>
                  <option value="filiere">Filière</option>
                  <option value="serie">Série</option>
                  <option value="option">Option</option>
                </select>
                <button type="submit" className="rounded bg-primary px-4 py-2 text-white">
                  Créer
                </button>
              </form>
            ) : null}
            <ul className="space-y-2">
              {streams.map((stream) => (
                <li key={stream.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                  <span>
                    {stream.name} ({stream.streamType}) — {stream.status}
                  </span>
                  {canUpdate && stream.status === "active" ? (
                    <button type="button" className="text-danger" onClick={() => void handleArchiveStream(stream)}>
                      Archiver
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">{labels.groupLabel}s</h2>
            {canCreate ? (
              <form onSubmit={handleCreateGroup} className="grid gap-3 md:grid-cols-3">
                <input className="rounded border px-3 py-2" placeholder="Code (ex. A)" value={groupCode} onChange={(e) => setGroupCode(e.target.value)} required />
                <input className="rounded border px-3 py-2" placeholder="Nom" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                <button type="submit" className="rounded bg-primary px-4 py-2 text-white">
                  Créer
                </button>
              </form>
            ) : null}
            <ul className="space-y-2">
              {groups.map((group) => (
                <li key={group.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                  <span>
                    {group.name} <span className="text-muted">({group.code})</span> — {group.status}
                  </span>
                  {canUpdate && group.status === "active" ? (
                    <button type="button" className="text-danger" onClick={() => void handleArchiveGroup(group)}>
                      Archiver
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {!loading && !groups.length ? (
              <p className="text-sm text-muted">Aucun {labels.groupLabel.toLowerCase()} défini pour ce pays.</p>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
