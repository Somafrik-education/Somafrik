import { FormEvent, useState } from "react";
import {
  reportCardHistoryApi,
  type PublishedVersionRow,
} from "../lib/reportCardHistoryApi";

export function ReportCardHistoryPage() {
  const [reportCardId, setReportCardId] = useState("");
  const [versions, setVersions] = useState<PublishedVersionRow[]>([]);
  const [reason, setReason] = useState("");
  const [sourceVersion, setSourceVersion] = useState("1");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function reload(id: string) {
    const data = await reportCardHistoryApi.listHistory(id);
    setVersions(data.versions || []);
  }

  async function onLoad(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await reload(reportCardId);
      setError("");
    } catch {
      setError("Historique introuvable.");
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }

  async function onCorrect(event: FormEvent) {
    event.preventDefault();
    try {
      await reportCardHistoryApi.correct(reportCardId, {
        sourceVersion: Number(sourceVersion),
        reason,
        commandId: `web-correct-${Date.now()}`,
      });
      await reload(reportCardId);
      setError("");
    } catch {
      setError("Correction refusée.");
    }
  }

  async function onRevoke(version: number) {
    try {
      await reportCardHistoryApi.revoke(reportCardId, version, {
        reason,
        commandId: `web-revoke-${Date.now()}`,
      });
      await reload(reportCardId);
      setError("");
    } catch {
      setError("Révocation refusée.");
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1>Historique des bulletins publiés</h1>
      {loading ? <p>Chargement…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <form onSubmit={(event) => void onLoad(event)}>
        <label>
          Identifiant bulletin
          <input value={reportCardId} onChange={(event) => setReportCardId(event.target.value)} />
        </label>
        <button type="submit">Charger l’historique</button>
      </form>
      {versions.length === 0 && !loading ? <p>Aucune version.</p> : null}
      <ul>
        {versions.map((row) => (
          <li key={`${row.report_card_id}:${row.published_snapshot_version}`}>
            <span>v{row.published_snapshot_version}</span>{" "}
            <strong>{row.verification_status}</strong>
            {row.verification_status === "ACTIVE" ? <span> ACTIVE</span> : null}
            {row.verification_status === "SUPERSEDED" ? <span> SUPERSEDED</span> : null}
            {row.verification_status === "REVOKED" ? <span> REVOKED</span> : null}
            {row.verification_status === "ACTIVE" ? (
              <button type="button" onClick={() => void onRevoke(row.published_snapshot_version)}>
                Révoquer
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <form onSubmit={(event) => void onCorrect(event)}>
        <h2>Corriger</h2>
        <label>
          Version source
          <input value={sourceVersion} onChange={(event) => setSourceVersion(event.target.value)} />
        </label>
        <label>
          Motif
          <input name="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <button type="submit">Corriger</button>
      </form>
    </main>
  );
}
