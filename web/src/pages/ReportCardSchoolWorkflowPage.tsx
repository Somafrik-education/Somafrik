import { FormEvent, useEffect, useState } from "react";
import { reportCardConfigurationApi, type ReportCardRequest } from "../lib/reportCardConfigurationApi";
import { ReportCardSnapshotView } from "../components/bulletin/ReportCardSnapshotView";

export function ReportCardSchoolWorkflowPage() {
  const [requests, setRequests] = useState<ReportCardRequest[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modelKey, setModelKey] = useState("trimestriel");
  const [description, setDescription] = useState("");
  const [cardId, setCardId] = useState("");
  const [version, setVersion] = useState("1");
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await reportCardConfigurationApi.listRequests();
      setRequests(data.requests || []);
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

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1>Modèle de bulletin</h1>
      {loading ? <p>Chargement…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {requests.length === 0 && !loading ? <p>Aucune demande.</p> : null}
      <ul>
        {requests.map((request) => (
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
          </li>
        ))}
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
