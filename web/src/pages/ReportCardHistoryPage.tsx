import { reportCardStatusLabel } from "../lib/reportCardStatus";
import { FormEvent, useState } from "react";
import {
  reportCardHistoryApi,
  type PublishedVersionRow,
  type ReissuePreview,
} from "../lib/reportCardHistoryApi";

export function ReportCardHistoryPage() {
  const [reportCardId, setReportCardId] = useState("");
  const [versions, setVersions] = useState<PublishedVersionRow[]>([]);
  const [reason, setReason] = useState("");
  const [sourceVersion, setSourceVersion] = useState("1");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [reissuePreview, setReissuePreview] = useState<ReissuePreview | null>(null);
  const [reissueReason, setReissueReason] = useState("");
  const [reissueConfirmed, setReissueConfirmed] = useState(false);
  const [reissueCommandId, setReissueCommandId] = useState("");
  const [reissueBusy, setReissueBusy] = useState(false);

  async function reload(id: string) {
    const data = await reportCardHistoryApi.listHistory(id);
    setVersions(data.versions || []);
  }

  async function onLoad(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setReissuePreview(null);
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

  async function prepareReissue(version: number) {
    setReissueBusy(true);
    setError("");
    setMessage("");
    setReissuePreview(null);
    try {
      const preview = await reportCardHistoryApi.previewReissue(reportCardId, version);
      if (!preview?.expected_draft_sha256 || !preview.header?.title) {
        throw new Error("REISSUE_HEADER_MISSING");
      }
      setReissuePreview(preview);
      setReissueReason("");
      setReissueConfirmed(false);
      // Conservé pour les relances après erreur réseau : même commande idempotente.
      setReissueCommandId(`web-reissue-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    } catch {
      setError("Réémission indisponible : contrôlez le modèle actif, l’en-tête, les droits et les notes publiées.");
    } finally {
      setReissueBusy(false);
    }
  }

  async function confirmReissue(event: FormEvent) {
    event.preventDefault();
    if (!reissuePreview || !reissueConfirmed || !reissueReason.trim() || !reissueCommandId) return;
    setReissueBusy(true);
    setError("");
    try {
      const result = await reportCardHistoryApi.reissue(reportCardId, {
        sourceVersion: reissuePreview.source_version,
        expectedDraftSha256: reissuePreview.expected_draft_sha256,
        reason: reissueReason.trim(),
        commandId: reissueCommandId,
      });
      await reload(reportCardId);
      setMessage(`Version v${result.published_snapshot_version} créée. Téléchargez son PDF et contrôlez le nouveau QR.`);
      setReissuePreview(null);
      setReissueConfirmed(false);
    } catch {
      // Le même commandId reste présent pour un rejeu sécurisé, pas de deuxième publication.
      setError("Réémission refusée ou non confirmée. Vérifiez l’historique avant de réessayer.");
    } finally {
      setReissueBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <h1 className="text-xl font-bold">Historique des bulletins publiés</h1>
      {loading ? <p>Chargement…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <form onSubmit={(event) => void onLoad(event)}>
        <label className="block">
          Identifiant bulletin
          <input value={reportCardId} onChange={(event) => setReportCardId(event.target.value)} className="block w-full rounded border p-2" />
        </label>
        <button type="submit" disabled={loading}>Charger l’historique</button>
      </form>
      {versions.length === 0 && !loading ? <p>Aucune version.</p> : null}
      <ul className="space-y-2">
        {versions.map((row) => (
          <li key={`${row.report_card_id}:${row.published_snapshot_version}`} className="flex flex-wrap items-center gap-3 border-b pb-2">
            <span>v{row.published_snapshot_version}</span>
            <strong data-status={row.verification_status}>{reportCardStatusLabel("canonical", row.verification_status)}</strong>
            {row.verification_status === "ACTIVE" ? (
              <>
                <button type="button" onClick={() => void prepareReissue(row.published_snapshot_version)} disabled={reissueBusy}>
                  Réémettre avec le modèle actif
                </button>
                <button type="button" onClick={() => void onRevoke(row.published_snapshot_version)}>Révoquer</button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {reissuePreview ? (
        <form onSubmit={(event) => void confirmReissue(event)} className="space-y-3 rounded border p-4" data-testid="report-card-reissue-preview">
          <h2 className="font-semibold">Prévisualisation de réémission — non officielle</h2>
          <p>v{reissuePreview.source_version} → v{reissuePreview.proposed_version} · Un seul bulletin</p>
          <div className="grid gap-3 md:grid-cols-2" data-testid="report-card-reissue-comparison">
            <section className="rounded border p-3">
              <h3 className="font-semibold">Version actuelle v{reissuePreview.source_version}</h3>
              <p>Présentation figée d'origine — consulter le PDF officiel historique.</p>
              <p>Cette version est conservée et restera vérifiable après réémission.</p>
            </section>
            <section className="rounded border p-3" data-testid="report-card-reissue-header">
              <h3 className="font-semibold">Nouvelle version v{reissuePreview.proposed_version}</h3>
              {reissuePreview.header.lines?.map((line) => <p key={line}>{line}</p>)}
              <strong>{reissuePreview.header.title}</strong>
              <p>Signatures : {reissuePreview.signatures.join(", ") || "—"}</p>
            </section>
          </div>
          <p>Élève : {reissuePreview.student_id}</p>
          <p>Les notes, les maxima et les résultats doivent rester inchangés. L’ancien bulletin demeure consultable comme historique.</p>
          <label className="block">
            Motif de réémission
            <input value={reissueReason} onChange={(event) => setReissueReason(event.target.value)} required className="block w-full rounded border p-2" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={reissueConfirmed} onChange={(event) => setReissueConfirmed(event.target.checked)} />
            Je confirme la création d’une nouvelle version officielle avec le nouvel en-tête et un nouveau QR.
          </label>
          <button type="submit" disabled={reissueBusy || !reissueReason.trim() || !reissueConfirmed}>Publier la nouvelle version</button>
          <button type="button" onClick={() => setReissuePreview(null)} disabled={reissueBusy}>Annuler</button>
        </form>
      ) : null}
      <form onSubmit={(event) => void onCorrect(event)} className="space-y-2">
        <h2>Corriger les notes (gabarit d’origine conservé)</h2>
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
