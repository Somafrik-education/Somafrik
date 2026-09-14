import { FormEvent, useEffect, useState } from "react";
import {
  reportCardConfigurationApi,
  type ReportCardAuditEntry,
  type ReportCardBundle,
  type ReportCardRequest,
  type ReportCardSourceArtifact,
} from "../lib/reportCardConfigurationApi";
import {
  ReportCardSnapshotView,
  ReportCardTemplatePreview,
} from "../components/bulletin/ReportCardSnapshotView";

type RequestDetails = {
  audit: ReportCardAuditEntry[];
  bundle: ReportCardBundle | null;
  binding: Record<string, unknown> | null;
};

export function ReportCardSchoolWorkflowPage() {
  const [requests, setRequests] = useState<ReportCardRequest[]>([]);
  const [details, setDetails] = useState<Record<string, RequestDetails>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modelKey, setModelKey] = useState("trimestriel");
  const [description, setDescription] = useState("");
  const [cardId, setCardId] = useState("");
  const [version, setVersion] = useState("1");
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadedByRequest, setUploadedByRequest] = useState<Record<string, ReportCardSourceArtifact>>({});
  const [sourceByRequest, setSourceByRequest] = useState<Record<string, ReportCardSourceArtifact>>({});

  async function loadDetails(list: ReportCardRequest[]) {
    const next: Record<string, RequestDetails> = {};
    const nextSource: Record<string, ReportCardSourceArtifact> = {};
    await Promise.all(
      list.map(async (request) => {
        const showReview = ["READY_FOR_REVIEW", "APPROVED", "ACTIVE"].includes(request.status);
        const audit = showReview
          ? await reportCardConfigurationApi.listAudit(request.id).catch(() => ({ audit: [] }))
          : { audit: [] };
        const bundle = showReview
          ? await reportCardConfigurationApi.getBundle(request.id).catch(() => null)
          : null;
        const binding =
          request.status === "ACTIVE" && request.model_key
            ? await reportCardConfigurationApi
                .getActiveBinding(request.model_key)
                .then((row) => row.binding)
                .catch(() => null)
            : null;
        next[request.id] = { audit: audit.audit || [], bundle, binding };
        try {
          const row = await reportCardConfigurationApi.getSourceArtifact(request.id);
          if (row?.artifact) nextSource[request.id] = row.artifact;
        } catch {
          /* no artefact yet */
        }
      }),
    );
    setDetails(next);
    setSourceByRequest(nextSource);
  }

  async function reload() {
    setLoading(true);
    try {
      const data = await reportCardConfigurationApi.listRequests();
      const list = data.requests || [];
      setRequests(list);
      await loadDetails(list);
      setError("");
    } catch {
      setError("Impossible de charger les demandes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await reportCardConfigurationApi.submitModel({ modelKey, description });
      await reload();
    } catch {
      setError("Soumission refusée.");
    }
  }

  async function onApprove(id: string) {
    try {
      await reportCardConfigurationApi.approve(id);
      await reload();
    } catch {
      setError("Approbation refusée.");
    }
  }

  async function onConsult(event: FormEvent) {
    event.preventDefault();
    try {
      const data = await reportCardConfigurationApi.getSnapshot(cardId, Number(version));
      setPayload((data.payload as Record<string, unknown>) || null);
      setError("");
    } catch {
      setError("Snapshot introuvable.");
      setPayload(null);
    }
  }

  async function onRequestChanges(id: string) {
    try {
      await reportCardConfigurationApi.requestChanges(id);
      await reload();
    } catch {
      setError("Demande de modifications refusée.");
    }
  }

  async function onUploadSource(requestId: string) {
    if (!uploadFile) {
      setError("Choisir un fichier PDF, JPG ou PNG.");
      return;
    }
    try {
      const data = await reportCardConfigurationApi.attachSourceArtifact(requestId, uploadFile);
      const artifact = data.artifact;
      setUploadedByRequest((current) => ({ ...current, [requestId]: artifact }));
      setSourceByRequest((current) => ({ ...current, [requestId]: artifact }));
      setError("");
    } catch {
      setError("Envoi du modèle refusé.");
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1>Modèle de bulletin</h1>
      {loading ? <p>Chargement…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {requests.length === 0 && !loading ? <p>Aucune demande.</p> : null}
      <ul>
        {requests.map((request) => {
          const extra = details[request.id];
          const template = extra?.bundle?.template?.spec as
            | { paper?: string; orientation?: string; qr_required?: boolean; sections?: { id: string; label?: string; source: "cells" | "slots" | "presence" }[] }
            | undefined;
          return (
            <li key={request.id} data-workflow-state={request.status}>
              <span>{request.model_key}</span> <strong>{request.status}</strong>
              {request.actions?.approve ? (
                <button type="button" onClick={() => void onApprove(request.id)}>
                  Approuver
                </button>
              ) : null}
              {request.actions?.request_changes ? (
                <button type="button" onClick={() => void onRequestChanges(request.id)}>
                  Demander des modifications
                </button>
              ) : null}
              {template ? <ReportCardTemplatePreview template={template} /> : null}
              {extra?.audit?.length ? (
                <ul data-audit>
                  {extra.audit.map((entry, index) => (
                    <li key={String(entry.id ?? index)}>
                      {entry.from_state || "∅"} → {entry.to_state}
                    </li>
                  ))}
                </ul>
              ) : null}
              {extra?.binding ? (
                <p data-active-binding>
                  Configuration ACTIVE {String(extra.binding.model_key || request.model_key)}
                </p>
              ) : null}
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
              />
              <button type="button" onClick={() => void onUploadSource(request.id)}>
                Envoyer un modèle de bulletin
              </button>
              {uploadedByRequest[request.id] || sourceByRequest[request.id] ? (
                <div data-source-artifact-preview>
                  <p>
                    Modèle envoyé {(uploadedByRequest[request.id] || sourceByRequest[request.id]).artifact_id}
                  </p>
                  {(uploadedByRequest[request.id] || sourceByRequest[request.id]).media_type?.startsWith(
                    "image/",
                  ) ? (
                    <img
                      alt={`source-artifact-${(uploadedByRequest[request.id] || sourceByRequest[request.id]).artifact_id}`}
                      src={`/api/report-card/requests/${encodeURIComponent(request.id)}/source-artifact/content`}
                    />
                  ) : (
                    <iframe
                      title={`source-artifact-${(uploadedByRequest[request.id] || sourceByRequest[request.id]).artifact_id}`}
                      src={`/api/report-card/requests/${encodeURIComponent(request.id)}/source-artifact/content`}
                    />
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>
          Clé modèle
          <input value={modelKey} onChange={(event) => setModelKey(event.target.value)} />
        </label>
        <label>
          Description
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <button type="submit">Soumettre</button>
      </form>
      <form onSubmit={(event) => void onConsult(event)}>
        <h2>Bulletin publié</h2>
        <label>
          Identifiant bulletin
          <input value={cardId} onChange={(event) => setCardId(event.target.value)} />
        </label>
        <label>
          Version
          <input value={version} onChange={(event) => setVersion(event.target.value)} />
        </label>
        <button type="submit">Consulter le snapshot</button>
      </form>
      {payload ? <ReportCardSnapshotView payload={payload} /> : null}
    </main>
  );
}
