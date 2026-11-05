/**
 * BULLETIN-CATALOG-01 — client du catalogue des modèles de bulletin.
 *
 * Le pays de l'établissement est déterminé par le serveur (schools.country_id) :
 * aucun pays n'est jamais envoyé par le navigateur côté école. Les aperçus sont
 * calculés par le moteur canonique sur des données fictives (jamais officiels).
 */
import { api } from "../api/client";
import type { ReportCardPresentation } from "./reportCardManagementApi";

export type CatalogCountry = { id: string; name: string; iso_code?: string | null };

export type CatalogModel = {
  model_id: string;
  version: number;
  name: string;
  description: string | null;
  presentation_style: "simple" | "hierarchical";
  status: "active" | "retired";
  allow_sub_subjects?: boolean;
  suggested_structure?: StructureId;
  preview: ReportCardPresentation | null;
};

export type AdminCatalogModel = CatalogModel & {
  availability: { country_id: string; available: boolean; updated_at: string | null; updated_by: string | null }[];
};

export type AvailabilityAuditEntry = {
  id: string | number;
  model_id: string;
  country_id: string;
  country_name?: string | null;
  old_available: boolean | null;
  new_available: boolean;
  actor_id: string;
  actor_label?: string | null;
  created_at: string;
};

export type ConfigurationState = "NONE" | "SAVED" | "ACTIVE" | "INHERITED";

/** BULLETIN-CLASSE-01 — classe configurée et son année scolaire (lues par le serveur). */
export type CatalogClass = { id: string; name: string | null; academic_year_id: string; academic_year_name: string | null };

export type SchoolCatalogModel = CatalogModel & {
  available: boolean;
  configuration: ConfigurationState;
  activated_at: string | null;
  saved_at: string | null;
};

export type SchoolCatalog = {
  country: { id: string; name: string } | null;
  reason: "COUNTRY_UNKNOWN" | null;
  canConfigure: boolean;
  class?: CatalogClass | null;
  models: SchoolCatalogModel[];
};

export type StructureId = "TJ_EX" | "SINGLE";

export type HeaderLayout = "logo_left" | "logo_center" | "no_logo";
export type HeaderElement =
  | "logo"
  | "establishment_name"
  | "establishment_address"
  | "country"
  | "academic_year"
  | "class"
  | "period"
  | "student_name"
  | "student_code";
export type HeaderInput = { layout: HeaderLayout; show: HeaderElement[]; lines: string[]; title: string };

export type ConfigurationInput = {
  structure: StructureId;
  subjects: { code: string; components: Record<string, { max: number | string }> }[];
  factSources: Record<string, { evaluationTypes: string[]; aggregation: "sum" | "weighted_average" | "" }>;
  periods: Record<string, { termNames: string[] }>;
  signatures: string[];
  header?: HeaderInput | null;
};

export type ConfigurationContext = {
  model: CatalogModel;
  style: "simple" | "hierarchical";
  allowSubSubjects: boolean;
  suggestedStructure: StructureId;
  structures: { id: StructureId; label: string; components: { id: string; label: string }[] }[];
  periods: { id: string; label: string }[];
  subjects: { code: string; name: string; parent_code: string | null }[];
  evaluationTypes: { code: string; name: string }[];
  terms: string[];
  configuration: ConfigurationState;
  pendingSaved?: boolean;
  class?: CatalogClass | null;
  current: ConfigurationInput | null;
};

export type FieldIssue = { field: string; code: string };

function modelPath(modelId: string) {
  return "/report-card/catalog/models/" + encodeURIComponent(modelId);
}

export const reportCardCatalogApi = {
  adminOverview: () => api.get<{ countries: CatalogCountry[]; models: AdminCatalogModel[] }>("/report-card/catalog/admin"),
  setAvailability: (modelId: string, countryId: string, available: boolean) =>
    api.put<{ changed: boolean; previous: boolean | null; available: boolean }>(
      "/report-card/catalog/admin/models/" + encodeURIComponent(modelId) + "/countries/" + encodeURIComponent(countryId),
      { available, confirm: true },
    ),
  adminAudit: (modelId: string) =>
    api.get<{ audit: AvailabilityAuditEntry[] }>("/report-card/catalog/admin/audit?modelId=" + encodeURIComponent(modelId)),
  schoolCatalog: (classId?: string) =>
    api.get<SchoolCatalog>("/report-card/catalog" + (classId ? "?classId=" + encodeURIComponent(classId) : "")),
  configurationContext: (modelId: string, classId: string) =>
    api.get<ConfigurationContext>(modelPath(modelId) + "/configuration?classId=" + encodeURIComponent(classId)),
  preview: async (modelId: string, input: ConfigurationInput, classId: string) => {
    const data = await api.post<{ preview: ReportCardPresentation }>(modelPath(modelId) + "/preview", { input, classId });
    return data.preview;
  },
  save: (modelId: string, input: ConfigurationInput, classId: string) =>
    api.put<{ status: "SAVED"; preview: ReportCardPresentation }>(modelPath(modelId) + "/configuration", { input, classId }),
  activate: (modelId: string, commandId: string, classId: string) =>
    api.post<{ status: string; model_key: string }>(modelPath(modelId) + "/activate", { confirm: true, commandId, classId }),
};

/** Problèmes par champ renvoyés par le serveur (422 CONFIGURATION_INVALID). */
export function fieldIssues(error: unknown): FieldIssue[] {
  const details = (error as { details?: unknown })?.details;
  if (!Array.isArray(details)) return [];
  return details.filter((d): d is FieldIssue => typeof d?.field === "string" && typeof d?.code === "string");
}

const FIELD_MESSAGES: Record<string, string> = {
  STRUCTURE_REQUIRED: "Choisissez une structure d'évaluation.",
  SUBJECTS_REQUIRED: "Choisissez au moins une matière.",
  SUBJECT_NOT_IN_SCHOOL_CATALOG: "Cette matière n'existe plus ou n'est plus active dans l'établissement.",
  SUBJECT_DUPLICATE: "Cette matière est déjà sélectionnée.",
  SUBJECT_IS_MAIN_SUBJECT: "Une matière principale se calcule à partir de ses sous-matières : choisissez les sous-matières.",
  SUB_SUBJECT_NOT_ALLOWED: "Ce modèle n'affiche que des matières simples : retirez les sous-matières.",
  PARENT_SUBJECT_INACTIVE: "La matière principale de cette sous-matière n'est plus active.",
  INVALID_MAX: "Le maximum doit être un nombre supérieur à 0 et inférieur ou égal à 1000.",
  SUBJECT_WITHOUT_COMPONENTS: "Indiquez au moins un maximum pour cette matière.",
  EVALUATION_TYPES_REQUIRED: "Choisissez au moins un type d'évaluation.",
  EVALUATION_TYPE_UNKNOWN: "Type d'évaluation inconnu ou inactif.",
  AGGREGATION_REQUIRED: "Choisissez le mode de calcul.",
  TERM_REQUIRED: "Associez au moins une période scolaire.",
  TERM_UNKNOWN: "Période scolaire inconnue pour l'année en cours.",
  INVALID_SIGNATURES: "Quatre signatures au maximum, 60 caractères chacune.",
  SUBJECT_NOT_IN_CLASS: "Cette matière n'est pas enseignée dans la classe (aucun cours actif).",
  HEADER_INVALID: "En-tête invalide.",
  HEADER_LAYOUT_INVALID: "Disposition inconnue.",
  HEADER_ELEMENT_UNKNOWN: "Élément d'en-tête inconnu.",
  HEADER_LOGO_WITHOUT_PLACE: "La disposition « sans logo » ne peut pas afficher le logo.",
  HEADER_LINES_INVALID: "Quatre lignes au maximum, 80 caractères chacune.",
  HEADER_TITLE_INVALID: "Titre de 60 caractères au maximum.",
};

export function fieldIssueMessage(code: string): string {
  return FIELD_MESSAGES[code] ?? "Valeur refusée par le serveur.";
}

/** Message d'erreur sans fuite : seuls les codes métier connus sont traduits. */
export function catalogErrorMessage(error: unknown): string {
  const status = (error as { status?: number })?.status;
  const code = String((error as { code?: string })?.code ?? "");
  const byCode: Record<string, string> = {
    CATALOG_UNAVAILABLE: "Le catalogue des bulletins n'est pas encore installé sur ce serveur.",
    CATALOG_MODEL_NOT_AVAILABLE: "Ce modèle n'est pas disponible dans votre pays.",
    CATALOG_MODEL_UNKNOWN: "Modèle introuvable.",
    CATALOG_MODEL_RETIRED: "Ce modèle est retiré : il ne peut plus être rendu disponible.",
    CATALOG_CONFIGURATION_REQUIRED: "Enregistrez d'abord la configuration avant de l'activer.",
    COUNTRY_UNKNOWN: "Le pays de l'établissement n'est pas reconnu.",
    CONFIGURATION_INVALID: "Certains champs sont à corriger.",
    CONFIRMATION_REQUIRED: "Confirmation requise.",
    CLASS_REQUIRED: "Choisissez d'abord la classe à configurer.",
    CLASS_NOT_FOUND: "Classe introuvable dans votre établissement.",
    CLASS_SCOPE_UNAVAILABLE: "La configuration par classe n'est pas encore installée sur ce serveur.",
  };
  if (byCode[code]) return byCode[code];
  if (status === 401 || status === 403) return "Accès refusé : vos droits ne permettent pas cette action.";
  if (status === 404) return "Ressource introuvable.";
  return "Opération impossible pour le moment. Réessayez.";
}

/**
 * BULLETIN-PREPROD-01 — catalogue indisponible côté serveur (pas une erreur passagère) :
 * - NOT_INSTALLED : tables du catalogue absentes (migration non appliquée) → 503 CATALOG_UNAVAILABLE ;
 * - SERVER_OUTDATED : route du catalogue inconnue du serveur (API antérieure à #1051) → 404 sans code métier.
 */
export type CatalogUnavailability = "NOT_INSTALLED" | "SERVER_OUTDATED";

export function catalogUnavailability(error: unknown): CatalogUnavailability | null {
  const status = (error as { status?: number })?.status;
  const code = String((error as { code?: string })?.code ?? "");
  if (code === "CATALOG_UNAVAILABLE") return "NOT_INSTALLED";
  if (status === 404 && !code.startsWith("CATALOG_")) return "SERVER_OUTDATED";
  return null;
}

export function isAccessDenied(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const code = String((error as { code?: string })?.code ?? "");
  return (status === 401 || status === 403) && code !== "CATALOG_MODEL_NOT_AVAILABLE";
}

export function modelTypeLabel(style: "simple" | "hierarchical") {
  return style === "hierarchical" ? "Matières et sous-matières" : "Matières simples";
}
