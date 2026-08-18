import { ApiError } from "../../api/client";

export type LinkParentDraft = {
  studentId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  relationType: string;
};

export function defaultLinkParentDraft(): LinkParentDraft {
  return {
    studentId: "",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    relationType: "parent_student",
  };
}

export function buildLinkParentPayload(draft: Record<string, unknown>): {
  studentId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  relationType: string;
} {
  return {
    studentId: String(draft.studentId ?? "").trim(),
    firstName: String(draft.firstName ?? "").trim(),
    lastName: String(draft.lastName ?? "").trim(),
    phone: String(draft.phone ?? "").trim(),
    email: String(draft.email ?? "").trim(),
    relationType: String(draft.relationType ?? "parent_student").trim() || "parent_student",
  };
}

export function validateLinkParentDraft(draft: Record<string, unknown>, identityFound: boolean): string | null {
  const payload = buildLinkParentPayload(draft);
  if (!payload.studentId) return "Sélectionnez l'élève.";
  if (!payload.phone && !payload.email) return "Indiquez un téléphone ou un email.";
  if (!identityFound && (!payload.firstName || !payload.lastName)) {
    return "Nom et prénom obligatoires pour créer le parent.";
  }
  return null;
}

export function parentLinkErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "PARENT_IDENTITY_AMBIGUOUS") {
      return "Email et téléphone désignent deux comptes distincts.";
    }
    if (error.code === "PARENT_CONTACT_AMBIGUOUS") {
      return "Plusieurs contacts actifs correspondent à cette identité.";
    }
    if (error.status === 403) return "Action non autorisée pour votre rôle.";
    if (error.status === 404) return error.message || "Élève ou ressource introuvable.";
    if (error.status === 409) return error.message || "Conflit d'identité parent.";
    if (error.status === 400) return error.message || "Requête invalide.";
    if (error.status >= 500) return "Erreur serveur. Réessayez plus tard.";
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Échec de la liaison parent.";
}

export function relationIdsFromParentChildRow(row: Record<string, unknown>): string[] {
  if (Array.isArray(row.relationIds)) {
    return row.relationIds.map(String).filter(Boolean);
  }
  const id = String(row.id ?? "").trim();
  if (id && !id.startsWith("parent-child:")) return [id];
  return [];
}
