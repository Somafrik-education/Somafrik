/**
 * BULLETIN-UI-01 — affichage d'un bulletin présenté par matières (modèle A
 * « simple » ou B « hiérarchique »). Lecture seule de valeurs calculées par le
 * moteur : aucun calcul ici. Un aperçu (official=false) porte le bandeau
 * BROUILLON et ne peut pas être présenté comme un bulletin publié.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  reportCardManagementApi,
  type PresentationCell,
  type PresentationHeader,
  type PresentationRow,
  type PresentationTotal,
  type ReportCardPresentation,
} from "../../lib/reportCardManagementApi";

/**
 * BULLETIN-CLASSE-01 / L3 — logo de l'en-tête : bulletin publié → logo FIGÉ (requête
 * authentifiée) ; brouillon → logo actuel de l'établissement (fourni par la page).
 */
function useHeaderLogo(view: ReportCardPresentation, currentLogoSrc: string | null | undefined, verifiedLogoDataUri: string | null | undefined) {
  const [src, setSrc] = useState<string | null>(null);
  const sha = view.header?.logo?.sha256 ?? null;
  const reportCardId = view.official ? view.report_card_id : null;
  const version = view.official ? view.version : null;
  useEffect(() => {
    if (!sha) {
      setSrc(null);
      return undefined;
    }
    if (verifiedLogoDataUri) {
      setSrc(verifiedLogoDataUri);
      return undefined;
    }
    if (!reportCardId || version == null) {
      setSrc(currentLogoSrc ?? null);
      return undefined;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    reportCardManagementApi
      .logo(reportCardId, version)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sha, reportCardId, version, currentLogoSrc, verifiedLogoDataUri]);
  return src;
}

function BulletinHeader({ header, logoSrc }: { header: PresentationHeader; logoSrc: string | null }) {
  const centered = header.layout === "logo_center";
  return (
    <header
      className={`flex gap-3 border-b border-line pb-3 ${centered ? "flex-col items-center text-center" : "items-center"}`}
      data-testid="report-card-header"
      data-layout={header.layout}
    >
      {header.logo ? (
        logoSrc ? (
          <img src={logoSrc} alt="Logo de l'établissement" className="h-16 max-w-[120px] object-contain" data-testid="report-card-header-logo" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-line text-[10px] text-muted" data-testid="report-card-header-logo-pending">
            Logo
          </span>
        )
      ) : null}
      <div className="w-full flex-1">
        {header.lines.map((line) => (
          <p key={line} className="text-xs font-semibold text-ink">{line}</p>
        ))}
        {header.title ? <h2 className={`mt-1 text-base font-black uppercase tracking-wide text-ink ${header.title_align === "center" || (!header.title_align && centered) ? "text-center" : "text-left"}`} data-testid="report-card-header-title">{header.title}</h2> : null}
      </div>
    </header>
  );
}

function show(value: number | string | null | undefined) {
  return value == null || value === "" ? "—" : String(value);
}

/** Note en échec : rouge et soulignée (Web, impression) — jamais un maximum, une absence ou un non applicable. */
const FAILING_CLASS = "font-semibold text-red-700 underline decoration-1 underline-offset-2";

function Score({ cell }: { cell: PresentationCell | undefined }) {
  if (!cell || cell.state === "NOT_APPLICABLE") return <td className="px-1 py-1 text-center text-muted">—</td>;
  if (cell.state === "NUMERIC") {
    return cell.failing ? (
      <td className={`px-1 py-1 text-center ${FAILING_CLASS}`} data-failing>
        {show(cell.value)}
      </td>
    ) : (
      <td className="px-1 py-1 text-center">{show(cell.value)}</td>
    );
  }
  return (
    <td className="px-1 py-1 text-center italic text-amber-700" data-missing>
      Manquante
    </td>
  );
}

function rankText(total: PresentationTotal | null | undefined, cohort: number | null) {
  const rank = total?.rank;
  if (!rank) return "—";
  if (rank.value == null) return "Non classé";
  return cohort ? `${rank.value} / ${cohort}` : String(rank.value);
}

function SubjectRow({ view, row }: { view: ReportCardPresentation; row: PresentationRow }) {
  const composite = row.kind === "composite";
  const label = row.group_label ? `${row.group_label} — ${row.label}` : row.label;
  return (
    <tr
      className={composite ? "bg-slate-100 font-bold" : ""}
      data-subject={row.subject_id}
      data-kind={row.kind}
    >
      <th scope="row" className={`sticky left-0 z-10 bg-inherit px-2 py-1 text-left font-semibold ${row.level ? "pl-6" : ""} ${composite ? "bg-slate-100" : "bg-white"}`}>
        {label}
      </th>
      {view.periods.map((period) => {
        const total = row.periods[period.id];
        return [
          ...view.components.map((component) => (
            <td key={`${period.id}-max-${component.id}`} className="px-1 py-1 text-center text-muted">
              {composite ? "" : show(total?.components?.[component.id]?.max)}
            </td>
          )),
          <td key={`${period.id}-max`} className="px-1 py-1 text-center text-muted">{show(total?.max)}</td>,
          ...view.components.map((component) =>
            composite ? <td key={`${period.id}-v-${component.id}`} /> : <Score key={`${period.id}-v-${component.id}`} cell={total?.components?.[component.id]} />,
          ),
          <td
            key={`${period.id}-sum`}
            className={`px-1 py-1 text-center font-bold ${total?.failing ? FAILING_CLASS : ""}`}
            {...(total?.failing ? { "data-failing": true } : {})}
          >
            {show(total?.points)}
          </td>,
        ];
      })}
      {view.totals.annual ? (
        <>
          <td className="px-1 py-1 text-center text-muted">{show(row.annual?.max)}</td>
          <td
            className={`px-1 py-1 text-center font-bold ${row.annual?.failing ? FAILING_CLASS : ""}`}
            {...(row.annual?.failing ? { "data-failing": true } : {})}
          >
            {show(row.annual?.points)}
          </td>
        </>
      ) : null}
    </tr>
  );
}

export function ReportCardPresentationTable({
  view,
  currentLogoSrc = null,
  verifiedLogoDataUri = null,
}: {
  view: ReportCardPresentation;
  /** Logo actuel de l'établissement, pour un brouillon / aperçu. */
  currentLogoSrc?: string | null;
  /** Logo figé renvoyé par une vérification publique cryptographiquement validée. */
  verifiedLogoDataUri?: string | null;
}) {
  const logoSrc = useHeaderLogo(view, currentLogoSrc, verifiedLogoDataUri);
  const identityItems: [string, string | null][] = view.header
    ? view.header.items.map((item) => [item.label, item.value])
    : [
        ["Établissement", view.school.name],
        ["Élève", view.student.name],
        ["Matricule", view.student.code],
        ["Classe", view.class_name],
        ["Année scolaire", view.academic_year],
      ];
  const span = view.components.length * 2 + 1;
  const summary = (
    label: string,
    pick: (total: PresentationTotal | null | undefined) => ReactNode,
    testId: string,
  ) => (
    <tr className="font-bold" data-testid={testId}>
      <th scope="row" className="sticky left-0 z-10 bg-white px-2 py-1 text-left">{label}</th>
      {view.periods.map((period) => [
        <td key={`${period.id}-${label}`} colSpan={span} className="px-1 py-1 text-center">
          {pick(view.totals.periods[period.id])}
        </td>,
        <td key={`${period.id}-${label}-pad`} />,
      ])}
      {view.totals.annual ? <td colSpan={2} className="px-1 py-1 text-center">{pick(view.totals.annual)}</td> : null}
    </tr>
  );
  // Total : seuls les points obtenus peuvent être en échec, jamais le maximum.
  const totalText = (t: PresentationTotal | null | undefined): ReactNode =>
    t ? (
      <>
        {t.failing ? (
          <span className={FAILING_CLASS} data-failing>
            {show(t.points)}
          </span>
        ) : (
          show(t.points)
        )}
        {` / ${show(t.max)}`}
      </>
    ) : (
      "—"
    );
  return (
    <section className="space-y-3" data-testid="report-card-presentation" data-style={view.style} data-official={view.official ? "true" : "false"}>
      {!view.official ? (
        <p role="note" className="rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-black uppercase tracking-wide text-amber-900" data-testid="report-card-draft-banner">
          BROUILLON — document non officiel, ne vaut pas bulletin publié
        </p>
      ) : null}
      {view.header ? <BulletinHeader header={view.header} logoSrc={logoSrc} /> : null}
      <dl className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-5" data-testid="report-card-identity">
        {identityItems.map(([label, value]) => (
          <div key={label as string}>
            <dt className="text-xs font-bold uppercase tracking-wide text-muted">{label}</dt>
            <dd className="font-semibold text-ink">{show(value)}</dd>
          </div>
        ))}
      </dl>
      {view.status === "INCOMPLETE" ? (
        <p className="text-sm font-bold text-amber-800" data-testid="report-card-incomplete">
          Résultats incomplets : certaines notes sont manquantes.
        </p>
      ) : null}
      {/* Défilement horizontal : toutes les matières et tous les maxima restent visibles. */}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="min-w-full border-collapse text-xs [&_td]:border [&_td]:border-line [&_th]:border [&_th]:border-line">
          <thead className="bg-slate-50">
            <tr>
              <th rowSpan={3} scope="col" className="sticky left-0 z-10 bg-slate-50 px-2 py-1 text-left">Matières</th>
              {view.periods.map((period) => (
                <th key={period.id} colSpan={(view.components.length + 1) * 2} scope="colgroup" className="px-1 py-1">
                  {period.label}
                </th>
              ))}
              {view.totals.annual ? <th colSpan={2} rowSpan={2} className="px-1 py-1">Total annuel</th> : null}
            </tr>
            <tr>
              {view.periods.map((period) => [
                <th key={`${period.id}-mx`} colSpan={view.components.length + 1} className="px-1 py-1">Maxima</th>,
                <th key={`${period.id}-ob`} colSpan={view.components.length + 1} className="px-1 py-1">Obtenu</th>,
              ])}
            </tr>
            <tr>
              {view.periods.map((period) => [
                ...view.components.map((c) => <th key={`${period.id}-m-${c.id}`} className="px-1 py-1">{c.label}</th>),
                <th key={`${period.id}-mt`} className="px-1 py-1">Total</th>,
                ...view.components.map((c) => <th key={`${period.id}-o-${c.id}`} className="px-1 py-1">{c.label}</th>),
                <th key={`${period.id}-ot`} className="px-1 py-1">Total</th>,
              ])}
              {view.totals.annual ? (
                <>
                  <th className="px-1 py-1">Max</th>
                  <th className="px-1 py-1">Obtenu</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <SubjectRow key={row.subject_id} view={view} row={row} />
            ))}
            {summary("Total", totalText, "report-card-total")}
            {summary("Pourcentage", (t) => (t && t.percentage != null ? `${t.percentage} %` : "—"), "report-card-percentage")}
            {summary("Rang", (t) => rankText(t, view.cohort_size), "report-card-rank")}
          </tbody>
        </table>
      </div>
      {view.decision && view.decision.passed != null ? (
        <p className="text-sm font-bold">Décision : {view.decision.passed ? "Admis(e)" : "Non admis(e)"}</p>
      ) : null}
      {view.signatures && view.signatures.length ? (
        <div
          className="grid gap-4 pt-2"
          style={{ gridTemplateColumns: `repeat(${view.signatures.length}, minmax(0, 1fr))` }}
          data-testid="report-card-signatures"
        >
          {view.signatures.map((label, index) => (
            <div key={`${index}-${label}`} className="text-center text-xs">
              <p className="font-semibold text-ink">{label}</p>
              <div className="mt-8 border-t border-dashed border-slate-400" aria-hidden="true" />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
