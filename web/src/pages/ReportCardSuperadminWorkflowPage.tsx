import { FormEvent, useState } from "react";
import {
  reportCardAdminApi,
  type ReportCardCatalogEntry,
  type ReportCardRequest,
  type ReportCardSourceArtifact,
} from "../lib/reportCardConfigurationApi";
import { ReportCardTemplatePreview } from "../components/bulletin/ReportCardSnapshotView";

const DEFAULT_TEMPLATE = {
  paper: "A4",
  orientation: "portrait",
  qr_required: true,
  sections: [
    { id: "SUMMARY", order: 1, label: "Totaux", source: "slots" as const },
    { id: "SUBJECTS", order: 2, label: "Disciplines", source: "cells" as const },
    { id: "APPLICABILITY", order: 3, label: "Presence", source: "presence" as const },
  ],
};

type Draft = {
  profileId: string;
  profileVersion: string;
  schemaId: string;
  schemaVersion: string;
  templateJson: string;
  savedTemplate: { template_id: string; version: number } | null;
  preview: typeof DEFAULT_TEMPLATE | null;
};

function emptyDraft(): Draft {
  return {
    profileId: "",
    profileVersion: "1",
    schemaId: "",
    schemaVersion: "1",
    templateJson: JSON.stringify(DEFAULT_TEMPLATE, null, 2),
    savedTemplate: null,
    preview: null,
  };
}

function seedDraft(
  request?: ReportCardRequest,
  profileList: ReportCardCatalogEntry[] = [],
  schemaList: ReportCardCatalogEntry[] = [],
): Draft {
  const profile = profileList.find((row) => row.id === request?.profile_id) || profileList[0];
  const schema = schemaList.find((row) => row.id === request?.schema_id) || schemaList[0];
  return {
    ...emptyDraft(),
    profileId: request?.profile_id || profile?.id || "",
    profileVersion: String(request?.profile_version || profile?.version || 1),
    schemaId: request?.schema_id || schema?.id || "",
    schemaVersion: String(request?.schema_version || schema?.version || 1),
  };
}

export function ReportCardSuperadminWorkflowPage() {
  const [schoolId, setSchoolId] = useState("");
  const [requests, setRequests] = useState<ReportCardRequest[]>([]);
  const [profiles, setProfiles] = useState<ReportCardCatalogEntry[]>([]);
  const [schemas, setSchemas] = useState<ReportCardCatalogEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [artifacts, setArtifacts] = useState<Record<string, ReportCardSourceArtifact | null>>({});

  function draftFor(request: ReportCardRequest): Draft {
    return drafts[request.id] || seedDraft(request, profiles, schemas);
  }

  function patchDraft(requestId: string, patch: Partial<Draft>) {
    const request = requests.find((row) => row.id === requestId);
    setDrafts((current) => ({
      ...current,
      [requestId]: { ...(current[requestId] || seedDraft(request, profiles, schemas)), ...patch },
    }));
  }

  function resolveDraft(requestId: string): Draft {
    const request = requests.find((row) => row.id === requestId);
    return drafts[requestId] || seedDraft(request, profiles, schemas);
  }

  async function loadQueue(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    try {
      const [data, catalog] = await Promise.all([
        reportCardAdminApi.queue(schoolId),
        reportCardAdminApi.catalog(schoolId).catch(() => ({ profiles: [], schemas: [] })),
      ]);
      setRequests(data.requests || []);
      setProfiles(catalog.profiles || []);
      setSchemas(catalog.schemas || []);
      const nextArtifacts: Record<string, ReportCardSourceArtifact | null> = {};
      await Promise.all(
        (data.requests || []).map(async (request) => {
          if (typeof reportCardAdminApi.getSourceArtifact !== "function") return;
          try {
            const row = await reportCardAdminApi.getSourceArtifact(request.id, schoolId);
            nextArtifacts[request.id] = row.artifact || null;
          } catch {
            nextArtifacts[request.id] = null;
          }
        }),
      );
      setArtifacts(nextArtifacts);
      setDrafts((current) => {
        const next = { ...current };
        for (const request of data.requests || []) {
          if (!next[request.id]) {
            next[request.id] = seedDraft(request, catalog.profiles || [], catalog.schemas || []);
          }
        }
        return next;
      });
      setError("");
    } catch {
      setError("File inaccessible.");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }

  async function run(action: (id: string, target: string) => Promise<unknown>, requestId: string) {
    try {
      await action(requestId, schoolId);
      await loadQueue();
    } catch {
      setError("Transition refusée.");
    }
  }

  async function saveTemplate(requestId: string) {
    const draft = resolveDraft(requestId);
    try {
      const spec = JSON.parse(draft.templateJson);
      const saved = await reportCardAdminApi.saveRenderingTemplate(requestId, schoolId, spec);
      patchDraft(requestId, { savedTemplate: saved.template, preview: spec });
      setError("");
      return saved.template;
    } catch {
      setError("Enregistrement du gabarit refusé.");
    }
  }

  async function bindSelectedBundle(requestId: string) {
    const draft = resolveDraft(requestId);
    let saved = draft.savedTemplate;
    if (!saved) {
      saved = (await saveTemplate(requestId)) || null;
    }
    if (!saved) {
      setError("Enregistrer le gabarit avant de lier le bundle.");
      return;
    }
    try {
      await reportCardAdminApi.bindBundle(requestId, schoolId, {
        profile: { id: draft.profileId, version: Number(draft.profileVersion) },
        schema: { id: draft.schemaId, version: Number(draft.schemaVersion) },
        template: { id: saved.template_id, version: saved.version },
      });
      await loadQueue();
    } catch {
      setError("Liaison du bundle refusée.");
    }
  }

  function previewTemplate(requestId: string) {
    const draft = resolveDraft(requestId);
    try {
      const spec = JSON.parse(draft.templateJson);
      patchDraft(requestId, { preview: spec });
      setError("");
    } catch {
      setError("Gabarit JSON invalide.");
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1>Configuration bulletins</h1>
      <form onSubmit={(event) => void loadQueue(event)}>
        <label>
          Établissement cible
          <input
            value={schoolId}
            onChange={(event) => setSchoolId(event.target.value)}
            required
          />
        </label>
        <button type="submit">Charger la file</button>
      </form>
      {loading ? <p>Chargement…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {requests.length === 0 && !loading ? <p>Aucune demande.</p> : null}
      <ul>
        {requests.map((request) => {
          const draft = draftFor(request);
          const configuring = Boolean(request.actions?.save_template || request.actions?.bind_bundle || request.actions?.ready);
          return (
            <li key={request.id} data-workflow-state={request.status}>
              <span>{request.model_key}</span> <strong>{request.status}</strong>
              <section>
                <h2>Artefact source</h2>
                {artifacts[request.id] ? (
                  <p>
                    {artifacts[request.id]?.original_filename} {artifacts[request.id]?.artifact_id}{" "}
                    {artifacts[request.id]?.sha256}
                  </p>
                ) : (
                  <p>Aucun artefact source.</p>
                )}
                {artifacts[request.id]?.media_type === "application/pdf" ||
                artifacts[request.id]?.media_type?.startsWith("image/") ? (
                  <iframe
                    title={`source-artifact-${request.id}`}
                    src={`/api/report-card/admin/requests/${encodeURIComponent(request.id)}/source-artifact/content?schoolId=${encodeURIComponent(schoolId)}`}
                  />
                ) : null}
              </section>
              {request.actions?.review ? (
                <button type="button" onClick={() => void run(reportCardAdminApi.startReview, request.id)}>
                  Examiner
                </button>
              ) : null}
              {request.actions?.configure ? (
                <button type="button" onClick={() => void run(reportCardAdminApi.startConfiguring, request.id)}>
                  Configurer
                </button>
              ) : null}
              {configuring ? (
                <div data-configuring-form>
                  <label>
                    Profil académique
                    <select
                      value={draft.profileId}
                      onChange={(event) => {
                        const selected = profiles.find((row) => row.id === event.target.value);
                        patchDraft(request.id, {
                          profileId: event.target.value,
                          profileVersion: String(selected?.version || draft.profileVersion),
                        });
                      }}
                    >
                      <option value="">Choisir</option>
                      {profiles.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.profile_key} v{row.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Version profil
                    <input
                      value={draft.profileVersion}
                      onChange={(event) => patchDraft(request.id, { profileVersion: event.target.value })}
                    />
                  </label>
                  <label>
                    Schéma bulletin
                    <select
                      value={draft.schemaId}
                      onChange={(event) => {
                        const selected = schemas.find((row) => row.id === event.target.value);
                        patchDraft(request.id, {
                          schemaId: event.target.value,
                          schemaVersion: String(selected?.version || draft.schemaVersion),
                        });
                      }}
                    >
                      <option value="">Choisir</option>
                      {schemas.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.schema_key} v{row.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Version schéma
                    <input
                      value={draft.schemaVersion}
                      onChange={(event) => patchDraft(request.id, { schemaVersion: event.target.value })}
                    />
                  </label>
                  <label>
                    Gabarit de rendu
                    <textarea
                      value={draft.templateJson}
                      onChange={(event) => patchDraft(request.id, { templateJson: event.target.value })}
                    />
                  </label>
                  {draft.savedTemplate ? (
                    <p data-saved-template>
                      Gabarit enregistré v{draft.savedTemplate.version}
                    </p>
                  ) : null}
                  {request.actions?.save_template ? (
                    <button type="button" onClick={() => void saveTemplate(request.id)}>
                      Enregistrer gabarit
                    </button>
                  ) : null}
                  {request.actions?.bind_bundle ? (
                    <button type="button" onClick={() => void bindSelectedBundle(request.id)}>
                      Lier le bundle
                    </button>
                  ) : null}
                  <button type="button" onClick={() => previewTemplate(request.id)}>
                    Prévisualiser
                  </button>
                  <ReportCardTemplatePreview template={draft.preview} />
                </div>
              ) : null}
              {request.actions?.ready ? (
                <button type="button" onClick={() => void run(reportCardAdminApi.markReadyForReview, request.id)}>
                  Prêt pour revue
                </button>
              ) : null}
              {request.actions?.reject ? (
                <button type="button" onClick={() => void run(reportCardAdminApi.reject, request.id)}>
                  Rejeter
                </button>
              ) : null}
              {request.actions?.activate ? (
                <button type="button" onClick={() => void run(reportCardAdminApi.activate, request.id)}>
                  Activer
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
