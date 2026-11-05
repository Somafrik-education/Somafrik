/**
 * BULLETIN-UI-01 — client de la gestion des bulletins (moteur canonique).
 *
 * Aucune logique de calcul : l'aperçu (POST /report-card/publications/preview)
 * et la présentation publiée (GET …/presentation) renvoient des valeurs déjà
 * calculées par le moteur. La publication exige l'empreinte du brouillon
 * confirmé (expectedDraftSha256) : le serveur refuse si les notes ont changé.
 */
import { api, requestBlob } from "../api/client";

/** `failing` : note inférieure au seuil (défaut : moitié du maximum de la cellule) — affichage seulement. */
export type PresentationCell = { state: string; value: number | null; max: number | null; failing?: boolean };

export type PresentationTotal = {
  status: string | null;
  points: number | null;
  max: number | null;
  percentage: number | null;
  rank?: { value: number | null; ranked?: number | null; reason?: string } | null;
  components?: Record<string, PresentationCell>;
  failing?: boolean;
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
  report_card_id: string | null;
  version: number | null;
  verification_status: string | null;
  published_at: string | null;
  period_scope: string | null;
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
  issues: ReportCardIssue[];
  decision: { passed: boolean | null } | null;
  signatures: string[];
};

export type ReportCardIssue = {
  code: string;
  severity?: string;
  reason?: string;
  student_id?: string;
  subject_id?: string;
  period_id?: string;
  score_component_id?: string;
  evaluation_id?: string;
  evaluation_title?: string;
  evaluation_type?: string;
};

export type DraftStudent = {
  report_card_id: string;
  student_id: string;
  status: "COMPLETE" | "INCOMPLETE";
  issues: ReportCardIssue[];
  presentation?: ReportCardPresentation | null;
};

export type ReportCardDraft = {
  official: false;
  draft_sha256: string;
  publishable: boolean;
  period_scope: string;
  class_id: string;
  academic_year_id: string;
  model_key: string;
  issues: ReportCardIssue[];
  students: DraftStudent[];
};

export type ClassPublicationSelection = {
  classId: string;
  academicYearId: string;
  modelKey: string;
  period: string;
};

export type PublishedRow = {
  report_card_id: string;
  published_snapshot_version: number;
  verification_status?: string;
};

export type PublishResult = {
  ok: boolean;
  status: "PUBLISHED" | "ALREADY_PUBLISHED";
  draft_sha256: string;
  publications: { report_card_id: string; published_snapshot_version?: number; state?: string }[];
};

export type ManagedClass = {
  id: string;
  name: string;
  academicYearId?: string | null;
  academicYearName?: string | null;
};

export type ActiveModel = { model_key: string; description?: string | null };

export type BulletinModelRequest = { model_key: string; status: string; description?: string | null };

/** Distinct loading contract: a successful empty list is NOT an HTTP failure. */
export async function listBulletinModelRequests(): Promise<BulletinModelRequest[]> {
  const data = await api.get<{ ok?: boolean; requests?: BulletinModelRequest[] }>("/report-card/requests");
  if (!data || data.ok === false || !Array.isArray(data.requests)) {
    throw new Error("MODEL_REQUESTS_INVALID_RESPONSE");
  }
  return data.requests.filter((request) => typeof request?.model_key === "string" && typeof request?.status === "string");
}


function publicationPath(reportCardId: string) {
  return "/report-card/publications/" + encodeURIComponent(reportCardId);
}

export const reportCardManagementApi = {
  listClasses: async (): Promise<ManagedClass[]> => {
    const rows = await api.get<unknown[]>("/classes");
    return (Array.isArray(rows) ? rows : [])
      .map((row) => row as Record<string, unknown>)
      .filter((row) => row.id)
      .map((row) => ({
        id: String(row.id),
        name: String(row.name ?? row.className ?? row.classCode ?? row.id),
        academicYearId: row.academicYearId ? String(row.academicYearId) : null,
        academicYearName: row.academicYearName ? String(row.academicYearName) : null,
      }));
  },
  /** Modèles de bulletin actifs de l'établissement (configuration LOT 6/7). */
  listActiveModels: async (): Promise<ActiveModel[]> => {
    const data = await api.get<{ ok?: boolean; requests?: { status?: string; model_key?: string; description?: string | null }[] }>(
      "/report-card/requests",
    );
    const seen = new Set<string>();
    const models: ActiveModel[] = [];
    for (const row of data?.requests ?? []) {
      const key = String(row.model_key ?? "").trim();
      if (row.status !== "ACTIVE" || !key || seen.has(key)) continue;
      seen.add(key);
      models.push({ model_key: key, description: row.description ?? null });
    }
    return models;
  },
  /** Brouillon non officiel : aucune écriture côté serveur. */
  preview: async (selection: ClassPublicationSelection) => {
    const data = await api.post<{ ok?: boolean; draft?: ReportCardDraft }>(
      "/report-card/publications/preview",
      selection,
    );
    if (!data?.draft) throw new Error("Aperçu indisponible.");
    return data.draft;
  },
  /** Publication officielle de l'aperçu CONFIRMÉ (empreinte exigée). */
  publish: (selection: ClassPublicationSelection, expectedDraftSha256: string) =>
    api.post<PublishResult>("/report-card/publications", { ...selection, expectedDraftSha256 }),
  listPublications: async (): Promise<PublishedRow[]> => {
    const data = await api.get<{ ok?: boolean; publications?: PublishedRow[] }>("/report-card/publications");
    return Array.isArray(data?.publications) ? data.publications : [];
  },
  presentation: async (reportCardId: string, version: number) => {
    const data = await api.get<{ ok?: boolean; presentation?: ReportCardPresentation[] | null; verification_status?: string }>(
      publicationPath(reportCardId) + "/presentation?version=" + encodeURIComponent(String(version)),
    );
    return { presentation: data?.presentation ?? null, verificationStatus: data?.verification_status ?? null };
  },
  pdf: (reportCardId: string, version: number) =>
    requestBlob(publicationPath(reportCardId) + "/pdf?version=" + encodeURIComponent(String(version))),
};

/** Libellé lisible d'une anomalie (sans donnée nominative). */
export function issueLabel(issue: ReportCardIssue): string {
  const where = [issue.subject_id, issue.period_id, issue.score_component_id].filter(Boolean).join(" · ");
  const reasons: Record<string, string> = {
    NOT_ENTERED: "note non saisie",
    UNPUBLISHED: "note non publiée",
    CANCELLED: "note annulée",
  };
  const codes: Record<string, string> = {
    MISSING_SCORE: "Note manquante",
    EVALUATION_GRADE_MISSING: "Aucune note enregistrée pour cette évaluation",
    EVALUATION_TYPE_UNMAPPED: "Type d'évaluation non associé au bulletin",
    SUBJECT_NOT_CONFIGURED: "Matière non configurée",
    CATALOG_MISMATCH: "Matière absente du catalogue",
  };
  const base = codes[issue.code] ?? issue.code;
  const reason = issue.reason ? reasons[issue.reason] ?? issue.reason : "";
  const evaluation = issue.evaluation_title
    ? `Évaluation : ${issue.evaluation_title}${issue.evaluation_type ? ` (type : ${issue.evaluation_type})` : ""}`
    : issue.evaluation_type ? `Type : ${issue.evaluation_type}` : "";
  return [base, evaluation ? `— ${evaluation}` : "", reason ? `(${reason})` : "", where ? `— ${where}` : ""].filter(Boolean).join(" ");
}

/** Message d'erreur sans fuite : seuls les codes métier connus sont traduits. */
export function publicationErrorMessage(error: unknown): string {
  const status = (error as { status?: number })?.status;
  const code = String((error as { code?: string; data?: { code?: string } })?.code ?? (error as { data?: { code?: string } })?.data?.code ?? "");
  const byCode: Record<string, string> = {
    REPORT_CARD_INCOMPLETE: "Publication refusée : des bulletins sont incomplets (notes manquantes).",
    INVALID_PEDAGOGICAL_DATA: "Publication refusée : données pédagogiques incohérentes.",
    DRAFT_CHANGED: "Les notes ont changé depuis l'aperçu. Relancez l'aperçu avant de publier.",
    DRAFT_CONFIRMATION_REQUIRED: "Confirmation de l'aperçu requise.",
    PUBLICATION_ALREADY_EXISTS: "Un bulletin différent est déjà publié pour cette période : utilisez une correction officielle.",
    MODEL_NOT_BOUND: "Aucun modèle de bulletin actif pour ce choix.",
    CLASS_NOT_FOUND: "Classe introuvable pour cette année scolaire.",
    PROFILE_NOT_PUBLISHABLE: "Le modèle de bulletin ne permet pas encore la publication.",
    INVALID_PERIOD_SCOPE: "Période invalide pour ce modèle.",
  };
  if (byCode[code]) return byCode[code];
  if (status === 401 || status === 403) return "Droits insuffisants pour cette action.";
  if (status === 404) return "Ressource introuvable.";
  return "Opération impossible. Réessayez ou contactez l'administration.";
}
