import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, SectionHeader } from "../components/ui/Card";
import { Field, Select } from "../components/ui/Field";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { formatDateTimeForDisplay } from "../lib/dates";
import {
  cardsFromPublishedSnapshot,
  filterParentPublishedReportCards,
  parentReportCardPeriods,
  snapshotForParentStudent,
  type ParentPublishedReportCard,
} from "../lib/parentReportCards";
import { parentReportCardApi } from "../lib/parentReportCardApi";
import {
  parentDashboardStudentKeys,
  resolveParentDashboardStudent,
} from "../lib/parentDashboard";
import {
  formatParentClassLabel,
  parentLinkedStudents,
  parentStudentLabel,
} from "../lib/parentNotes";

const ALL_PERIODS = "";

function studentValue(student: Record<string, unknown> | null | undefined) {
  if (!student) return "";
  return String(student.id ?? student.matricule ?? student.publicId ?? "").trim();
}

function statusLabel(status?: string) {
  const normalized = String(status ?? "ACTIVE").trim().toUpperCase();
  if (normalized === "SUPERSEDED") return "Remplacé";
  if (normalized === "REVOKED") return "Révoqué";
  if (normalized === "ACTIVE") return "Actif";
  return normalized || "Publié";
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function ParentReportCardsPage() {
  const { session } = useAuth();
  const { state } = useData();
  const user = session?.user ?? null;
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [period, setPeriod] = useState(ALL_PERIODS);
  const [rows, setRows] = useState<ParentPublishedReportCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pdfBusyKey, setPdfBusyKey] = useState("");

  const children = useMemo(
    () => parentLinkedStudents(user, state),
    [user, state],
  );
  const selectedChild = useMemo(
    () => resolveParentDashboardStudent(user, state, selectedStudentId),
    [user, state, selectedStudentId],
  );

  useEffect(() => {
    if (!selectedChild) {
      if (selectedStudentId) setSelectedStudentId("");
      return;
    }
    const requested = String(selectedStudentId).trim().toUpperCase();
    const allowed = parentDashboardStudentKeys(selectedChild).includes(requested);
    const next = studentValue(selectedChild);
    if (!allowed && next) setSelectedStudentId(next);
  }, [selectedChild, selectedStudentId]);

  useEffect(() => {
    setPeriod(ALL_PERIODS);
  }, [selectedStudentId]);

  const loadPublished = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const publications = await parentReportCardApi.listPublications();
      const cards = (
        await Promise.all(
          publications.map(async (publication) => {
            const version = Number(publication.published_snapshot_version || 0);
            const [snapshot, history] = await Promise.all([
              parentReportCardApi.getSnapshot(publication.report_card_id, version),
              parentReportCardApi.listHistory(publication.report_card_id),
            ]);
            return cardsFromPublishedSnapshot(publication, snapshot, history);
          }),
        )
      ).flat();
      setRows(cards);
    } catch {
      setRows([]);
      setError("Impossible de charger les bulletins publiés.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPublished();
  }, [loadPublished]);

  const periods = useMemo(
    () => parentReportCardPeriods(rows, selectedChild),
    [rows, selectedChild],
  );

  const visibleRows = useMemo(
    () => filterParentPublishedReportCards(rows, selectedChild, period),
    [rows, selectedChild, period],
  );

  const downloadPdf = useCallback(
    async (card: ParentPublishedReportCard, version: number) => {
      const busyKey = card.reportCardId + ":" + version;
      setPdfBusyKey(busyKey);
      setError("");
      try {
        const blob = await parentReportCardApi.pdf(card.reportCardId, version);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        const child = safeFilePart(parentStudentLabel(selectedChild) || card.studentId || "eleve");
        const periodPart = safeFilePart(card.period || "periode");
        anchor.href = url;
        anchor.download = "bulletin-" + child + "-" + periodPart + "-v" + version + ".pdf";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        setError("Impossible de télécharger ce bulletin PDF.");
      } finally {
        setPdfBusyKey("");
      }
    },
    [selectedChild],
  );

  if (!children.length) {
    return (
      <div className="space-y-6" data-testid="parent-report-cards-page">
        <SectionHeader
          title="Bulletins"
          description="Bulletins publiés de vos enfants."
        />
        <Card className="p-6">
          <p className="font-bold text-ink">Aucun enfant lié à votre compte.</p>
          <p className="mt-2 text-sm text-muted">
            Contactez l'établissement si un enfant devrait apparaître ici.
          </p>
        </Card>
      </div>
    );
  }

  const childName = parentStudentLabel(selectedChild);
  const childClass = formatParentClassLabel(
    selectedChild,
    user?.schoolPublicCode ?? "",
  );

  return (
    <div className="space-y-6" data-testid="parent-report-cards-page">
      <SectionHeader
        title="Bulletins"
        description="Consultez uniquement les bulletins publiés et leurs versions officielles."
        actions={
          <button
            type="button"
            onClick={() => void loadPublished()}
            disabled={loading}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-brand disabled:opacity-50"
          >
            Actualiser
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {children.length > 1 ? (
          <Card className="p-4">
            <Field label="Enfant" htmlFor="parent-report-card-child">
              <Select
                id="parent-report-card-child"
                value={studentValue(selectedChild)}
                onChange={(event) => setSelectedStudentId(event.target.value)}
                options={children.map((child) => ({
                  value: studentValue(child),
                  label: parentStudentLabel(child),
                }))}
              />
            </Field>
          </Card>
        ) : (
          <Card className="p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Enfant</p>
            <p className="mt-1 font-black text-ink">{childName || "Élève"}</p>
            <p className="mt-1 text-sm font-semibold text-muted">{childClass}</p>
          </Card>
        )}

        <Card className="p-4">
          <Field label="Période" htmlFor="parent-report-card-period">
            <Select
              id="parent-report-card-period"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              options={[
                { value: ALL_PERIODS, label: "Toutes les périodes" },
                ...periods.map((value) => ({ value, label: value })),
              ]}
            />
          </Field>
        </Card>
      </div>

      {children.length > 1 ? (
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            Enfant sélectionné
          </p>
          <p className="mt-1 font-black text-ink">{childName || "Élève"}</p>
          <p className="mt-1 text-sm font-semibold text-muted">{childClass}</p>
        </Card>
      ) : null}

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4">
          <p role="alert" className="text-sm font-bold text-red-800">{error}</p>
        </Card>
      ) : null}

      {loading ? (
        <Card className="p-6">
          <p className="text-sm font-semibold text-muted">Chargement des bulletins publiés…</p>
        </Card>
      ) : visibleRows.length === 0 ? (
        <Card className="p-6">
          <p className="font-bold text-ink">Aucun bulletin publié.</p>
          <p className="mt-2 text-sm text-muted">
            Aucun document officiel n'est disponible pour cet enfant et cette période.
          </p>
        </Card>
      ) : (
        <div className="space-y-4" data-testid="parent-report-cards-list">
          {visibleRows.map((card) => (
            <ParentReportCard
              key={card.id}
              card={card}
              selectedChild={selectedChild}
              pdfBusyKey={pdfBusyKey}
              onDownloadPdf={downloadPdf}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ParentReportCard({
  card,
  selectedChild,
  pdfBusyKey,
  onDownloadPdf,
}: {
  card: ParentPublishedReportCard;
  selectedChild: Record<string, unknown> | null;
  pdfBusyKey: string;
  onDownloadPdf: (card: ParentPublishedReportCard, version: number) => Promise<void>;
}) {
  const currentSnapshot = snapshotForParentStudent(card.payload, selectedChild);
  const versions = card.history.length
    ? [...card.history].sort(
        (left, right) =>
          Number(right.published_snapshot_version) - Number(left.published_snapshot_version),
      )
    : [
        {
          report_card_id: card.reportCardId,
          published_snapshot_version: card.version,
          verification_status: card.verificationStatus,
        },
      ];

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Période</p>
            <h3 className="mt-1 text-lg font-black text-ink">
              {card.period || "Période non renseignée"}
            </h3>
            <p className="mt-1 text-sm text-muted">
              Publié le {formatDateTimeForDisplay(card.publishedAt) || "date non renseignée"}
            </p>
          </div>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-black text-ink">
            Version courante v{card.version}
          </span>
        </div>
      </div>

      {currentSnapshot ? (
        <div className="border-b border-line bg-slate-50 px-5 py-4">
          <p className="text-sm font-semibold text-muted">
            Aperçu officiel disponible. Le PDF ci-dessous reste le document de référence.
          </p>
        </div>
      ) : null}

      <div className="p-5">
        <h4 className="font-black text-ink">Versions publiées</h4>
        <div className="mt-3 divide-y divide-line rounded-xl border border-line">
          {versions.map((version) => {
            const versionNumber = Number(version.published_snapshot_version);
            const busy = pdfBusyKey === card.reportCardId + ":" + versionNumber;
            return (
              <div
                key={card.reportCardId + ":" + versionNumber}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-black text-ink">Version {versionNumber}</p>
                  <p className="text-sm font-semibold text-muted">
                    {statusLabel(version.verification_status)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onDownloadPdf(card, versionNumber)}
                  className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy ? "Préparation…" : "Télécharger le PDF"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
