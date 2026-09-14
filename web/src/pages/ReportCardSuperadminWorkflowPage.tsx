import { FormEvent, useState } from "react";
import { reportCardAdminApi, type ReportCardRequest } from "../lib/reportCardConfigurationApi";

export function ReportCardSuperadminWorkflowPage() {
  const [schoolId, setSchoolId] = useState("");
  const [requests, setRequests] = useState<ReportCardRequest[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadQueue(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    try {
      const data = await reportCardAdminApi.queue(schoolId);
      setRequests(data.requests || []);
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
        {requests.map((request) => (
          <li key={request.id} data-workflow-state={request.status}>
            <span>{request.model_key}</span> <strong>{request.status}</strong>
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
        ))}
      </ul>
    </main>
  );
}
