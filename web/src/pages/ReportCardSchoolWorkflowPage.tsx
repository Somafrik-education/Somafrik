import { FormEvent, useEffect, useState } from "react";
import {
  reportCardConfigurationApi,
  type ReportCardAuditEntry,
  type ReportCardBundle,
  type ReportCardRequest,
  type ReportCardSourceArtifact,
} from "../lib/reportCardConfigurationApi";
import { academicYearsApi } from "../lib/academicYearsApi";
import { getEntityFeaturePermissions } from "../lib/permissions";
import { usePermissionContext } from "../lib/usePermissionContext";
import {
  ReportCardSnapshotView,
  ReportCardTemplatePreview,
} from "../components/bulletin/ReportCardSnapshotView";
import { ReportCardSourcePreview } from "../components/bulletin/ReportCardSourcePreview";

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
  const [academicYearName, setAcademicYearName] = useState("");
  const permissionCtx = usePermissionContext();
  const bulletinPerms = getEntityFeaturePermissions(permissionCtx, "bulletins", "Bulletins");

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

  useEffect(() => {
    void academicYearsApi
      .list()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        const current = list.find((row) => row.isCurrent) || list[0];
        setAcademicYearName(current?.name || "");
      })
      .catch(() => setAcademicYearName(""));
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
      {academicYearName ? (
        <p data-testid="report-card-academic-year">Année scolaire {academicYearName}</p>
      ) : null}
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
            <li key={request.id} data-workflow-state={request.status} data-request-id={request.id}>
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
              {bulletinPerms.canCreate ? (
                <>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    data-testid="report-card-source-file"
                    onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                  />
                  <button
                    type="button"
                    data-testid="report-card-upload-source"
                    onClick={() => void onUploadSource(request.id)}
                  >
                    Envoyer un modèle de bulletin
                  </button>
                </>
              ) : null}
              {uploadedByRequest[request.id] || sourceByRequest[request.id] ? (
                <ReportCardSourcePreview
                  requestId={request.id}
                  artifact={uploadedByRequest[request.id] || sourceByRequest[request.id]}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {bulletinPerms.canCreate ? (
        <form onSubmit={(event) => void onSubmit(event)}>
          <label>
            Clé modèle
            <input
              data-testid="report-card-model-key"
              value={modelKey}
              onChange={(event) => setModelKey(event.target.value)}
            />
          </label>
          <label>
            Description
            <input
              data-testid="report-card-model-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <button type="submit" data-testid="report-card-submit-request">
            Soumettre la demande de modèle
          </button>
        </form>
      ) : null}
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
