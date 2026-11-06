/**
 * BULLETIN-UI-01 — gestion des bulletins (administration scolaire, enseignant).
 *
 * Parcours : année → classe → modèle → période → « Prévisualiser » (brouillon
 * non officiel, aucune écriture) → anomalies → publication de la classe après
 * confirmation explicite (classe, période, nombre de bulletins) → bulletin
 * publié : consultation, PDF, impression, versions.
 *
 * Aucune action n'est déclenchée à l'ouverture de l'écran. Les droits affichés
 * ne sont qu'une aide : le serveur reste seul juge (403 traduit, jamais masqué).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, SectionHeader } from "../components/ui/Card";
import { Field, Select } from "../components/ui/Field";
import { ReportCardPresentationTable } from "../components/bulletin/ReportCardPresentationTable";
import { academicYearsApi, type AcademicYear } from "../lib/academicYearsApi";
import { getCurrentRolePermissions, hasBackOfficePermission } from "../lib/permissions";
import { usePermissionContext } from "../lib/usePermissionContext";
import { reportCardHistoryApi, type PublishedVersionRow } from "../lib/reportCardHistoryApi";
import { reportCardStatusLabel } from "../lib/reportCardStatus";
import {
  issueLabel,
  listBulletinModelRequests,
  publicationErrorMessage,
  reportCardManagementApi,
  type ActiveModel,
  type BulletinModelRequest,
  type ClassPublicationSelection,
  type DraftStudent,
  type ManagedClass,
  type PublishedRow,
  type ReportCardDraft,
  type ReportCardPresentation,
} from "../lib/reportCardManagementApi";

const ANNUAL = "ANNUAL";
const ALL = "";

type StudentStatusFilter = "" | "PUBLISHED" | "NOT_PUBLISHED" | "INCOMPLETE";

function percentageOf(view: ReportCardPresentation | null | undefined, period: string) {
  const total = period === ANNUAL ? view?.totals.annual : view?.totals.periods[period];
  return total?.percentage ?? null;
}

function rankOf(view: ReportCardPresentation | null | undefined, period: string) {
  const total = period === ANNUAL ? view?.totals.annual : view?.totals.periods[period];
  const rank = total?.rank;
  if (!rank) return "—";
  if (rank.value == null) return "Non classé";
  return view?.cohort_size ? `${rank.value} / ${view.cohort_size}` : String(rank.value);
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "bulletin";
}

export function ReportCardManagementPage() {
  const permissionCtx = usePermissionContext();
  // Aide d'affichage alignée sur le serveur (resolveReportCardActorFromPrincipal) ;
  // le serveur reste l'autorité : un refus 403 est affiché tel quel.
  const canPreview = useMemo(
    () =>
      hasBackOfficePermission(permissionCtx, "Bulletins", "UPDATE") ||
      getCurrentRolePermissions(permissionCtx).includes("Valider bulletins"),
    [permissionCtx],
  );
  const canPublish = canPreview;
  const canReissue = permissionCtx.permissionsReady === true &&
    (permissionCtx.user?.permissions ?? []).includes("REPORT_CARD_PUBLISH");

  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<ManagedClass[]>([]);
  const [models, setModels] = useState<ActiveModel[]>([]);
  const [modelRequests, setModelRequests] = useState<BulletinModelRequest[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [modelsRetry, setModelsRetry] = useState(0);
  const [setupError, setSetupError] = useState("");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [period, setPeriod] = useState(ANNUAL);
  const [periodOptions, setPeriodOptions] = useState<{ id: string; label: string }[]>([]);
  const [studentFilter, setStudentFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState<StudentStatusFilter>("");

  const [draft, setDraft] = useState<ReportCardDraft | null>(null);
  const [draftSelection, setDraftSelection] = useState<ClassPublicationSelection | null>(null);
  const [published, setPublished] = useState<PublishedRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [openedPreview, setOpenedPreview] = useState<string | null>(null);
  const [anomaliesFor, setAnomaliesFor] = useState<string | null>(null);
  const [official, setOfficial] = useState<{ row: PublishedRow; view: ReportCardPresentation | null; history: PublishedVersionRow[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [y, c] = await Promise.all([academicYearsApi.list(), reportCardManagementApi.listClasses()]);
        if (cancelled) return;
        setYears(Array.isArray(y) ? y : []);
        setClasses(c);
        const current = (Array.isArray(y) ? y : []).find((row) => row.isCurrent) ?? (Array.isArray(y) ? y[0] : undefined);
        if (current) setYearId(current.id);
      } catch (err) {
        if (!cancelled) setSetupError(publicationErrorMessage(err));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    setModelsError("");
    listBulletinModelRequests()
      .then((requests) => {
        if (cancelled) return;
        setModelRequests(requests);
        const seen = new Set<string>();
        const active: ActiveModel[] = [];
        for (const request of requests) {
          const key = request.model_key.trim();
          if (request.status !== "ACTIVE" || !key || seen.has(key)) continue;
          seen.add(key);
          active.push({ model_key: key, description: request.description });
        }
        setModels(active);
        setModelKey((selected) => active.some((model) => model.model_key === selected) ? selected : active.length === 1 ? active[0].model_key : "");
      })
      .catch(() => {
        if (cancelled) return;
        setModelRequests([]);
        setModels([]);
        setModelKey("");
        setModelsError("Impossible de charger les modèles de bulletin. Vérifiez la connexion ou vos droits, puis réessayez.");
      })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [modelsRetry]);

  const yearClasses = useMemo(
    () => classes.filter((row) => !yearId || !row.academicYearId || row.academicYearId === yearId),
    [classes, yearId],
  );
  const selectedClass = classes.find((row) => row.id === classId) ?? null;
  const periodLabel =
    period === ANNUAL ? "Bilan annuel" : periodOptions.find((option) => option.id === period)?.label || period;

  // Changer un critère invalide l'aperçu : il ne peut plus servir à publier.
  useEffect(() => {
    setDraft(null);
    setDraftSelection(null);
    setOfficial(null);
    setMessage("");
    setError("");
    setErrorDetails([]);
  }, [yearId, classId, modelKey, period]);

  const selection = useMemo<ClassPublicationSelection | null>(
    () => (yearId && classId && modelKey ? { academicYearId: yearId, classId, modelKey, period } : null),
    [yearId, classId, modelKey, period],
  );

  const runPreview = useCallback(async () => {
    if (!selection) return;
    setBusy(true);
    setError("");
    setErrorDetails([]);
    setMessage("");
    try {
      const [nextDraft, rows] = await Promise.all([
        reportCardManagementApi.preview(selection),
        reportCardManagementApi.listPublications().catch(() => [] as PublishedRow[]),
      ]);
      setDraft(nextDraft);
      setDraftSelection(selection);
      setPublished(rows);
      const firstView = nextDraft.students.find((student) => student.presentation)?.presentation;
      if (firstView && period === ANNUAL) setPeriodOptions(firstView.periods);
    } catch (err) {
      setDraft(null);
      setError(publicationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [selection, period]);

  const publishedById = useMemo(() => new Map(published.map((row) => [row.report_card_id, row])), [published]);

  const rows = useMemo(() => {
    const students = draft?.students ?? [];
    return students.filter((student) => {
      if (studentFilter && student.student_id !== studentFilter) return false;
      const isPublished = publishedById.has(student.report_card_id);
      if (statusFilter === "PUBLISHED" && !isPublished) return false;
      if (statusFilter === "NOT_PUBLISHED" && isPublished) return false;
      if (statusFilter === "INCOMPLETE" && student.status !== "INCOMPLETE") return false;
      return true;
    });
  }, [draft, studentFilter, statusFilter, publishedById]);

  const toPublish = (draft?.students ?? []).filter((student) => !publishedById.has(student.report_card_id)).length;

  const confirmPublication = useCallback(async () => {
    if (!draft || !draftSelection) return;
    setConfirmOpen(false);
    setBusy(true);
    setError("");
    setErrorDetails([]);
    try {
      const result = await reportCardManagementApi.publish(draftSelection, draft.draft_sha256);
      setMessage(
        result.status === "ALREADY_PUBLISHED"
          ? "Ces bulletins étaient déjà publiés à l'identique : aucune nouvelle version."
          : `Publication officielle effectuée (${result.publications.length} bulletin(s)).`,
      );
      setPublished(await reportCardManagementApi.listPublications().catch(() => published));
    } catch (err) {
      setError(publicationErrorMessage(err));
      const details = (err as { details?: unknown })?.details;
      if (Array.isArray(details)) {
        setErrorDetails(
          details.flatMap((item: { student_id?: string; issues?: unknown[] }) =>
            (Array.isArray(item.issues) ? item.issues : []).map(
              (issue) => `${item.student_id ? item.student_id + " : " : ""}${issueLabel(issue as never)}`,
            ),
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  }, [draft, draftSelection, published]);

  const openOfficial = useCallback(async (row: PublishedRow) => {
    setBusy(true);
    setError("");
    try {
      const version = Number(row.published_snapshot_version);
      const [{ presentation }, history] = await Promise.all([
        reportCardManagementApi.presentation(row.report_card_id, version),
        reportCardHistoryApi.listHistory(row.report_card_id).then((data) => data.versions ?? []).catch(() => []),
      ]);
      setOfficial({ row, view: presentation?.[0] ?? null, history });
    } catch (err) {
      setError(publicationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const pdfBlob = useCallback(async (row: PublishedRow, version: number) => {
    return reportCardManagementApi.pdf(row.report_card_id, version);
  }, []);

  const downloadPdf = useCallback(
    async (row: PublishedRow, version: number, studentLabel: string) => {
      setError("");
      try {
        const blob = await pdfBlob(row, version);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `bulletin-${safeFilePart(studentLabel)}-${safeFilePart(periodLabel)}-v${version}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        setError(publicationErrorMessage(err));
      }
    },
    [pdfBlob, periodLabel],
  );

  const printPdf = useCallback(
    async (row: PublishedRow, version: number) => {
      setError("");
      try {
        const blob = await pdfBlob(row, version);
        const url = URL.createObjectURL(blob);
        const opened = window.open(url, "_blank", "noopener");
        if (!opened) setError("Autorisez l'ouverture de fenêtres pour imprimer le bulletin PDF.");
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (err) {
        setError(publicationErrorMessage(err));
      }
    },
    [pdfBlob],
  );

  return (
    <div className="space-y-6" data-testid="report-card-management-page">
      <SectionHeader
        title="Gestion des bulletins"
        description="Aperçu non officiel, anomalies, publication confirmée et bulletins publiés."
      />

      {setupError ? (
        <Card className="border-red-200 bg-red-50 p-4">
          <p role="alert" className="text-sm font-bold text-red-800">{setupError}</p>
        </Card>
      ) : null}

      {modelsError ? (
        <div data-testid="rc-model-error"><Card className="border-red-200 bg-red-50 p-4">
          <p role="alert" className="text-sm font-bold text-red-800">{modelsError}</p>
          <button type="button" className="mt-2 text-sm font-bold text-brand underline" onClick={() => setModelsRetry((value) => value + 1)}>Réessayer</button>
        </Card></div>
      ) : !modelsLoading && models.length === 0 ? (
        <div data-testid="rc-model-empty"><Card className="space-y-2 p-4">
          <p className="text-sm font-bold text-ink">{modelRequests.length === 0 ? "Aucun modèle de bulletin configuré pour cet établissement." : "Aucun modèle de bulletin actif pour cet établissement."}</p>
          {modelRequests.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-muted" data-testid="rc-model-pending">
              {modelRequests.map((request, index) => (
                <li key={index}>{request.description || request.model_key} — Statut : {request.status}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-sm text-muted">Pour utiliser les bulletins, soumettez une demande de modèle. Un administrateur habilité doit ensuite terminer sa configuration et son activation.</p>
          <Link to="/bulletins/modele" className="inline-block text-sm font-bold text-brand underline">Demander ou suivre un modèle de bulletin</Link>
        </Card></div>
      ) : null}

      <Card className="grid gap-4 p-4 md:grid-cols-3 lg:grid-cols-6">
        <Field label="Année scolaire" htmlFor="rc-year">
          <Select
            id="rc-year"
            value={yearId}
            onChange={(event) => {
              setYearId(event.target.value);
              setClassId("");
            }}
            options={[{ value: "", label: "Choisir…" }, ...years.map((row) => ({ value: row.id, label: row.name }))]}
          />
        </Field>
        <Field label="Classe" htmlFor="rc-class">
          <Select
            id="rc-class"
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            options={[{ value: "", label: "Choisir…" }, ...yearClasses.map((row) => ({ value: row.id, label: row.name }))]}
          />
        </Field>
        <Field label="Modèle de bulletin" htmlFor="rc-model">
          <Select
            id="rc-model"
            value={modelKey}
            onChange={(event) => setModelKey(event.target.value)}
            options={[
              { value: "", label: modelsLoading ? "Chargement…" : modelsError ? "Modèles indisponibles" : models.length ? "Choisir…" : "Aucun modèle actif" },
              ...models.map((row) => ({ value: row.model_key, label: row.description || row.model_key })),
            ]}
          />
        </Field>
        <Field label="Période" htmlFor="rc-period">
          <Select
            id="rc-period"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            options={[
              { value: ANNUAL, label: "Bilan annuel" },
              ...periodOptions.map((option) => ({ value: option.id, label: option.label })),
            ]}
          />
        </Field>
        <Field label="Élève" htmlFor="rc-student">
          <Select
            id="rc-student"
            value={studentFilter}
            onChange={(event) => setStudentFilter(event.target.value)}
            options={[
              { value: ALL, label: "Tous les élèves" },
              ...(draft?.students ?? []).map((student) => ({
                value: student.student_id,
                label: student.presentation?.student.name || student.student_id,
              })),
            ]}
          />
        </Field>
        <Field label="Statut du bulletin" htmlFor="rc-status">
          <Select
            id="rc-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StudentStatusFilter)}
            options={[
              { value: "", label: "Tous" },
              { value: "PUBLISHED", label: "Publié" },
              { value: "NOT_PUBLISHED", label: "Non publié" },
              { value: "INCOMPLETE", label: "Notes incomplètes" },
            ]}
          />
        </Field>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        {canPreview ? (
          <button
            type="button"
            disabled={!selection || busy}
            onClick={() => void runPreview()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            data-testid="rc-preview"
          >
            {busy ? "Calcul…" : "Prévisualiser"}
          </button>
        ) : (
          <p className="text-sm font-semibold text-muted" data-testid="rc-no-preview-right">
            Vos droits ne permettent pas de générer un aperçu ni de publier. Les bulletins publiés restent consultables.
          </p>
        )}
        {draft && canPublish ? (
          <button
            type="button"
            disabled={busy || !draft.publishable || toPublish === 0}
            onClick={() => setConfirmOpen(true)}
            className="rounded-lg border border-brand px-4 py-2 text-sm font-bold text-brand disabled:opacity-50"
            data-testid="rc-publish"
          >
            Publier les bulletins de la classe
          </button>
        ) : null}
        {draft && !draft.publishable ? (
          <p className="text-sm font-bold text-amber-800" data-testid="rc-not-publishable">
            Publication impossible tant que des anomalies bloquantes subsistent.
          </p>
        ) : null}
      </div>

      {message ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4">
          <p role="status" className="text-sm font-bold text-emerald-800">{message}</p>
        </Card>
      ) : null}
      {error ? (
        <Card className="border-red-200 bg-red-50 p-4">
          <p role="alert" className="text-sm font-bold text-red-800">{error}</p>
          {errorDetails.length ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-red-800">
              {errorDetails.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {draft ? (
        <Card className="overflow-x-auto p-0">
          <p className="border-b border-line bg-amber-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-amber-900">
            Aperçu non officiel — {selectedClass?.name ?? ""} · {periodLabel}
          </p>
          {draft.issues.filter((issue) => !issue.student_id).length ? (
            <ul className="border-b border-line px-4 py-2 text-sm text-amber-900" data-testid="rc-class-issues">
              {draft.issues.filter((issue) => !issue.student_id).map((issue, index) => (
                <li key={index}>{issueLabel(issue)}</li>
              ))}
            </ul>
          ) : null}
          <table className="min-w-full text-sm" data-testid="rc-students">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Nom</th>
                <th className="px-3 py-2">Matricule</th>
                <th className="px-3 py-2">Classe</th>
                <th className="px-3 py-2">État des notes</th>
                <th className="px-3 py-2">Statut du bulletin</th>
                <th className="px-3 py-2">Pourcentage</th>
                <th className="px-3 py-2">Rang</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((student) => (
                <StudentLine
                  key={student.report_card_id}
                  student={student}
                  className={selectedClass?.name ?? ""}
                  period={period}
                  publishedRow={publishedById.get(student.report_card_id) ?? null}
                  previewOpen={openedPreview === student.report_card_id}
                  anomaliesOpen={anomaliesFor === student.report_card_id}
                  onTogglePreview={() => setOpenedPreview((current) => (current === student.report_card_id ? null : student.report_card_id))}
                  onToggleAnomalies={() => setAnomaliesFor((current) => (current === student.report_card_id ? null : student.report_card_id))}
                  onOpenOfficial={openOfficial}
                />
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-muted">Aucun élève pour ces filtres.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      ) : null}

      {official ? (
        <div data-testid="rc-official">
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-black text-ink">
              Bulletin publié — version {official.row.published_snapshot_version}
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void downloadPdf(official.row, Number(official.row.published_snapshot_version), official.view?.student.name || official.view?.student.code || "eleve")}
                className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white"
                data-testid="rc-download-pdf"
              >
                Télécharger le PDF
              </button>
              <button
                type="button"
                onClick={() => void printPdf(official.row, Number(official.row.published_snapshot_version))}
                className="rounded-lg border border-line px-3 py-2 text-sm font-bold text-ink"
                data-testid="rc-print-pdf"
              >
                Imprimer
              </button>
              {canReissue && official.history.some((version) =>
                version.published_snapshot_version === Number(official.row.published_snapshot_version) &&
                version.verification_status === "ACTIVE"
              ) ? (
                <Link
                  to={`/bulletins/historique?reportCardId=${encodeURIComponent(official.row.report_card_id)}`}
                  className="rounded-lg border border-brand px-3 py-2 text-sm font-bold text-brand"
                  data-testid="rc-reissue-v2-link"
                >
                  Créer une nouvelle version (V{Number(official.row.published_snapshot_version) + 1})
                </Link>
              ) : null}
            </div>
          </div>
          {official.view ? (
            <ReportCardPresentationTable view={official.view} />
          ) : (
            <p className="text-sm text-muted">Bulletin historique : consultez le PDF officiel.</p>
          )}
          <div>
            <h4 className="font-black text-ink">Historique des versions</h4>
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line" data-testid="rc-history">
              {official.history.map((version) => (
                <li key={version.published_snapshot_version} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-bold">
                    v{version.published_snapshot_version} — {reportCardStatusLabel("canonical", version.verification_status)}
                  </span>
                  <button
                    type="button"
                    className="text-brand underline"
                    onClick={() => void downloadPdf(official.row, Number(version.published_snapshot_version), official.view?.student.code || "eleve")}
                  >
                    PDF v{version.published_snapshot_version}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        </div>
      ) : null}

      {confirmOpen && draft ? (
        <div role="dialog" aria-modal="true" aria-labelledby="rc-confirm-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="rc-confirm">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="rc-confirm-title" className="text-lg font-black text-ink">Confirmer la publication officielle</h2>
            <dl className="space-y-1 text-sm">
              <div><dt className="inline font-bold">Classe : </dt><dd className="inline" data-testid="rc-confirm-class">{selectedClass?.name ?? draft.class_id}</dd></div>
              <div><dt className="inline font-bold">Période : </dt><dd className="inline" data-testid="rc-confirm-period">{periodLabel}</dd></div>
              <div><dt className="inline font-bold">Bulletins concernés : </dt><dd className="inline" data-testid="rc-confirm-count">{toPublish}</dd></div>
            </dl>
            <p className="text-sm text-muted">
              Les bulletins publiés deviennent officiels et immuables ; ils seront visibles par les parents. Une erreur se corrige ensuite par une nouvelle version.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-bold">
                Annuler
              </button>
              <button type="button" onClick={() => void confirmPublication()} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white" data-testid="rc-confirm-publish">
                Publier {toPublish} bulletin(s)
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StudentLine({
  student,
  className,
  period,
  publishedRow,
  previewOpen,
  anomaliesOpen,
  onTogglePreview,
  onToggleAnomalies,
  onOpenOfficial,
}: {
  student: DraftStudent;
  className: string;
  period: string;
  publishedRow: PublishedRow | null;
  previewOpen: boolean;
  anomaliesOpen: boolean;
  onTogglePreview: () => void;
  onToggleAnomalies: () => void;
  onOpenOfficial: (row: PublishedRow) => Promise<void>;
}) {
  const view = student.presentation ?? null;
  const issues = [...(student.issues ?? []), ...(view?.issues ?? [])];
  const percentage = percentageOf(view, period);
  return (
    <>
      <tr data-testid="rc-student-row" data-student={student.student_id}>
        <td className="px-3 py-2 font-bold">{view?.student.name || "—"}</td>
        <td className="px-3 py-2">{student.student_id}</td>
        <td className="px-3 py-2">{view?.class_name || className}</td>
        <td className="px-3 py-2">{student.status === "COMPLETE" ? "Complètes" : "Incomplètes"}</td>
        <td className="px-3 py-2" data-testid="rc-student-status">{publishedRow ? `Publié (v${publishedRow.published_snapshot_version})` : "Non publié"}</td>
        <td className="px-3 py-2">{percentage != null ? `${percentage} %` : "—"}</td>
        <td className="px-3 py-2">{rankOf(view, period)}</td>
        <td className="space-x-2 whitespace-nowrap px-3 py-2">
          {view ? (
            <button type="button" className="text-brand underline" onClick={onTogglePreview}>
              {previewOpen ? "Fermer l'aperçu" : "Prévisualiser"}
            </button>
          ) : null}
          {issues.length ? (
            <button type="button" className="text-amber-800 underline" onClick={onToggleAnomalies}>
              Anomalies ({issues.length})
            </button>
          ) : null}
          {publishedRow ? (
            <button type="button" className="text-brand underline" onClick={() => void onOpenOfficial(publishedRow)}>
              Bulletin publié
            </button>
          ) : null}
        </td>
      </tr>
      {anomaliesOpen ? (
        <tr>
          <td colSpan={8} className="bg-amber-50 px-3 py-2">
            <ul className="list-disc pl-5 text-sm text-amber-900" data-testid="rc-anomalies">
              {issues.map((issue, index) => (
                <li key={index}>{issueLabel(issue)}</li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
      {previewOpen && view ? (
        <tr>
          <td colSpan={8} className="p-3">
            <ReportCardPresentationTable view={view} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
