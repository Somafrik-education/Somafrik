import { normalize } from "./format";

export const INTERNAL_ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  "Admin School": [
    "Utilisateurs:READ", "Utilisateurs:CREATE", "Utilisateurs:UPDATE", "Utilisateurs:DELETE", "Utilisateurs:SUSPEND",
    "Classes:READ", "Classes:CREATE", "Classes:UPDATE", "Classes:DELETE",
    "Élèves:READ", "Élèves:CREATE", "Élèves:UPDATE", "Élèves:DELETE", "Élèves:SUSPEND",
    "Enseignants:READ", "Enseignants:CREATE",
    "Affectations:READ", "Affectations:CREATE", "Affectations:UPDATE",
    "Présences:READ", "Présences:CREATE", "Présences:UPDATE", "Notes:READ", "Bulletins:READ", "Paiements:READ",
    "Notifications:READ", "Notifications:CREATE", "Notifications:UPDATE",
    "Messages:READ", "Messages:CREATE", "Messages:UPDATE",
    "Documents:READ", "Documents:CREATE", "Documents:UPDATE", "Rapports:READ",
    "Paramètres Établissement:READ", "Paramètres Établissement:UPDATE",
    "Années Académiques:READ", "Années Académiques:CREATE", "Années Académiques:UPDATE",
    "Matières:READ", "Matières:CREATE", "Matières:UPDATE",
    "Examens:READ", "Examens:CREATE", "Examens:UPDATE",
  ],
  Secrétaire: [
    "Utilisateurs:READ", "Classes:READ", "Élèves:READ", "Élèves:CREATE", "Élèves:UPDATE",
    "Enseignants:READ", "Affectations:READ", "Présences:READ", "Présences:CREATE", "Présences:UPDATE",
    "Paiements:READ", "Paiements:CREATE", "Paiements:UPDATE",
    "Notifications:READ", "Notifications:CREATE", "Messages:READ", "Messages:CREATE", "Messages:UPDATE",
    "Documents:READ", "Documents:CREATE", "Documents:UPDATE", "Bulletins:READ", "Rapports:READ",
  ],
  "Préfet des études": [
    "Utilisateurs:READ", "Classes:READ", "Classes:CREATE", "Classes:UPDATE",
    "Élèves:READ", "Élèves:UPDATE", "Enseignants:READ",
    "Affectations:READ", "Affectations:CREATE", "Affectations:UPDATE",
    "Présences:READ", "Présences:CREATE", "Présences:UPDATE",
    "Notes:READ", "Notes:CREATE", "Notes:UPDATE",
    "Bulletins:READ", "Bulletins:CREATE", "Bulletins:UPDATE",
    "Matières:READ", "Matières:CREATE", "Matières:UPDATE",
    "Examens:READ", "Examens:CREATE", "Examens:UPDATE", "Rapports:READ",
    "Notifications:READ", "Notifications:CREATE", "Notifications:UPDATE",
    "Messages:READ", "Messages:CREATE", "Messages:UPDATE",
    "Paramètres Établissement:READ",
  ],
  Proviseur: [
    "Utilisateurs:READ", "Classes:READ", "Élèves:READ", "Enseignants:READ",
    "Affectations:READ", "Présences:READ", "Présences:CREATE", "Présences:UPDATE", "Notes:READ", "Bulletins:READ",
    "Paiements:READ", "Messages:READ", "Notifications:READ", "Documents:READ", "Rapports:READ",
    "Paramètres Établissement:READ",
  ],
  Directeur: [
    "Utilisateurs:READ", "Classes:READ", "Classes:CREATE", "Classes:UPDATE",
    "Élèves:READ", "Élèves:UPDATE", "Enseignants:READ",
    "Affectations:READ", "Affectations:CREATE", "Affectations:UPDATE",
    "Présences:READ", "Présences:CREATE", "Présences:UPDATE", "Notes:READ", "Bulletins:READ", "Paiements:READ",
    "Messages:READ", "Notifications:READ", "Documents:READ", "Rapports:READ", "Paramètres Établissement:READ",
  ],
  "Directeur adjoint": [
    "Utilisateurs:READ", "Classes:READ", "Élèves:READ", "Enseignants:READ",
    "Affectations:READ", "Présences:READ", "Présences:CREATE", "Présences:UPDATE", "Notes:READ", "Bulletins:READ",
    "Messages:READ", "Notifications:READ", "Documents:READ", "Rapports:READ",
  ],
  Comptable: [
    "Élèves:READ", "Paiements:READ", "Paiements:CREATE", "Paiements:UPDATE",
    "Documents:READ", "Rapports:READ", "Messages:READ", "Notifications:READ",
  ],
  Enseignant: [
    "Classes:READ", "Élèves:READ", "Affectations:READ",
    "Présences:READ", "Présences:CREATE", "Présences:UPDATE",
    "Notes:READ", "Notes:CREATE", "Notes:UPDATE",
    "Messages:READ", "Messages:CREATE", "Notifications:READ", "Documents:READ", "Matières:READ", "Examens:READ",
  ],
  Parent: [
    "Élèves:READ", "Notes:READ", "Bulletins:READ", "Présences:READ", "Paiements:READ",
    "Messages:READ", "Notifications:READ", "Documents:READ",
  ],
  "Élève / Étudiant": [
    "Notes:READ", "Bulletins:READ", "Présences:READ", "Messages:READ",
    "Notifications:READ", "Documents:READ", "Examens:READ",
  ],
};

export function resolveInternalRoleKey(role?: string): string | undefined {
  if (!role) return undefined;
  if (INTERNAL_ROLE_DEFAULT_PERMISSIONS[role]) return role;

  const key = normalize(role);
  if (key === "enseignant" || key === "teacher" || key.includes("prof")) return "Enseignant";
  if (key === "secretaire" || key === "secretary") return "Secrétaire";
  if (key === "prefet des etudes" || key === "prefet") return "Préfet des études";
  if (key === "comptable") return "Comptable";
  if (key === "parent") return "Parent";
  if (key.includes("eleve") || key.includes("etudiant") || key === "student") return "Élève / Étudiant";

  for (const knownRole of Object.keys(INTERNAL_ROLE_DEFAULT_PERMISSIONS)) {
    if (normalize(knownRole) === key) return knownRole;
  }

  return role;
}

export function getInternalRoleDefaults(role?: string): string[] {
  const resolved = resolveInternalRoleKey(role);
  if (!resolved) return [];
  return INTERNAL_ROLE_DEFAULT_PERMISSIONS[resolved] ?? [];
}
