/**
 * BULLETIN-UI-01 — lecture « téléphone » d'un bulletin présenté par matières.
 *
 * Entrée : présentation renvoyée par le serveur pour un bulletin PUBLIÉ
 * (GET /report-card/publications/:id/presentation) — valeurs déjà calculées
 * par le moteur canonique et lues dans le snapshot figé. Ce module ne calcule
 * rien : il réorganise un tableau trop large en une liste par période, sans
 * supprimer de matière, de sous-matière ni de maximum.
 */
export type PresentationCell = { state: string; value: number | null; max: number | null };

export type PresentationTotal = {
  status: string | null;
  points: number | null;
  max: number | null;
  percentage: number | null;
  rank?: { value: number | null; ranked?: number | null; reason?: string } | null;
  components?: Record<string, PresentationCell>;
};

export type PresentationRow = {
  subject_id: string;
  parent_id: string | null;
  kind: "simple" | "composite";
  level: number;
  label: string;
  group_label?: string;
  periods: Record<string, PresentationTotal>;
  annual: PresentationTotal | null;
};

export type ReportCardPresentation = {
  official: boolean;
  style: "simple" | "hierarchical";
  school: { name: string | null };
  class_name: string | null;
  academic_year: string | null;
  student: { code: string; name: string | null };
  periods: { id: string; label: string }[];
  components: { id: string; label: string }[];
  rows: PresentationRow[];
  totals: { periods: Record<string, PresentationTotal | null>; annual: PresentationTotal | null };
  status: string | null;
  cohort_size: number | null;
};

export const ANNUAL_VIEW = "ANNUAL";

export type PhoneComponentLine = { id: string; label: string; text: string; missing: boolean };

export type PhoneSubjectLine = {
  key: string;
  label: string;
  kind: "simple" | "composite";
  level: number;
  total: string;
  components: PhoneComponentLine[];
};

export type PhoneReportCard = {
  official: boolean;
  identity: { label: string; value: string }[];
  periodLabel: string;
  incomplete: boolean;
  subjects: PhoneSubjectLine[];
  summary: { label: string; value: string }[];
};

function show(value: number | string | null | undefined): string {
  return value == null || value === "" ? "—" : String(value);
}

function fraction(points: number | null | undefined, max: number | null | undefined): string {
  if (points == null && max == null) return "—";
  return `${show(points)} / ${show(max)}`;
}

function rankText(total: PresentationTotal | null | undefined, cohort: number | null): string {
  const rank = total?.rank;
  if (!rank) return "—";
  if (rank.value == null) return "Non classé";
  return cohort ? `${rank.value} / ${cohort}` : String(rank.value);
}

/** Choix de lecture : une période du bulletin, ou le bilan annuel s'il existe. */
export function phoneViewOptions(view: ReportCardPresentation): { id: string; label: string }[] {
  const options = view.periods.map((period) => ({ id: period.id, label: period.label }));
  if (view.totals.annual) options.push({ id: ANNUAL_VIEW, label: "Bilan annuel" });
  return options;
}

export function defaultPhoneView(view: ReportCardPresentation): string {
  if (view.totals.annual) return ANNUAL_VIEW;
  return view.periods[view.periods.length - 1]?.id ?? ANNUAL_VIEW;
}

/**
 * Une période : chaque matière avec chacune de ses composantes « note / max »,
 * puis son total. Bilan annuel : total annuel de chaque matière. Les matières
 * principales gardent leur sous-total (celui du moteur) et leurs sous-matières.
 */
export function phoneReportCard(view: ReportCardPresentation, selected: string): PhoneReportCard {
  const annual = selected === ANNUAL_VIEW;
  const period = view.periods.find((entry) => entry.id === selected);
  const subjects = view.rows.map((row): PhoneSubjectLine => {
    const total = annual ? row.annual : row.periods[selected];
    const components =
      annual || row.kind === "composite"
        ? []
        : view.components.map((component) => {
            const cell = total?.components?.[component.id];
            if (!cell || cell.state === "NOT_APPLICABLE") return { id: component.id, label: component.label, text: "—", missing: false };
            if (cell.state === "NUMERIC") return { id: component.id, label: component.label, text: fraction(cell.value, cell.max), missing: false };
            return { id: component.id, label: component.label, text: `Manquante / ${show(cell.max)}`, missing: true };
          });
    return {
      key: row.subject_id,
      label: row.group_label ? `${row.group_label} — ${row.label}` : row.label,
      kind: row.kind,
      level: row.level,
      total: fraction(total?.points, total?.max),
      components,
    };
  });
  const total = annual ? view.totals.annual : view.totals.periods[selected];
  return {
    official: view.official === true,
    identity: [
      { label: "Établissement", value: show(view.school.name) },
      { label: "Élève", value: show(view.student.name) },
      { label: "Matricule", value: show(view.student.code) },
      { label: "Classe", value: show(view.class_name) },
      { label: "Année scolaire", value: show(view.academic_year) },
    ],
    periodLabel: annual ? "Bilan annuel" : period?.label ?? selected,
    incomplete: view.status === "INCOMPLETE",
    subjects,
    summary: [
      { label: "Total", value: fraction(total?.points, total?.max) },
      { label: "Pourcentage", value: total?.percentage != null ? `${total.percentage} %` : "—" },
      { label: "Rang", value: rankText(total, view.cohort_size) },
    ],
  };
}

export function reportCardPresentationPath(reportCardId: string, version: number | string) {
  return `/report-card/publications/${encodeURIComponent(reportCardId)}/presentation?version=${encodeURIComponent(String(version))}`;
}
