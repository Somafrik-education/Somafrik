export const INTERNAL_ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  "Admin School": [
    "Utilisateurs:READ", "Utilisateurs:CREATE", "Utilisateurs:UPDATE", "Utilisateurs:DELETE", "Utilisateurs:SUSPEND",
    "Classes:READ", "Classes:CREATE", "Classes:UPDATE", "Classes:DELETE",
    "Élèves:READ", "Élèves:CREATE", "Élèves:UPDATE", "Élèves:DELETE", "Élèves:SUSPEND",
    "Enseignants:READ", "Enseignants:CREATE",
    "Affectations:READ", "Affectations:CREATE", "Affectations:UPDATE",
    "Présences:READ", "Notes:READ", "Bulletins:READ", "Paiements:READ",
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
    "Paramètres Établissement:READ",
  ],
  Proviseur: [
    "Utilisateurs:READ", "Classes:READ", "Élèves:READ", "Enseignants:READ",
    "Affectations:READ", "Présences:READ", "Notes:READ", "Bulletins:READ",
    "Paiements:READ", "Messages:READ", "Documents:READ", "Rapports:READ",
    "Paramètres Établissement:READ",
  ],
  Directeur: [
    "Utilisateurs:READ", "Classes:READ", "Classes:CREATE", "Classes:UPDATE",
    "Élèves:READ", "Élèves:UPDATE", "Enseignants:READ",
    "Affectations:READ", "Affectations:CREATE", "Affectations:UPDATE",
    "Présences:READ", "Notes:READ", "Bulletins:READ", "Paiements:READ",
    "Messages:READ", "Documents:READ", "Rapports:READ", "Paramètres Établissement:READ",
  ],
  "Directeur adjoint": [
    "Utilisateurs:READ", "Classes:READ", "Élèves:READ", "Enseignants:READ",
    "Affectations:READ", "Présences:READ", "Notes:READ", "Bulletins:READ",
    "Messages:READ", "Documents:READ", "Rapports:READ",
  ],
  Comptable: [
    "Élèves:READ", "Paiements:READ", "Paiements:CREATE", "Paiements:UPDATE",
    "Documents:READ", "Rapports:READ", "Messages:READ",
  ],
  Enseignant: [
    "Classes:READ", "Élèves:READ", "Affectations:READ",
    "Présences:READ", "Présences:CREATE", "Présences:UPDATE",
    "Notes:READ", "Notes:CREATE", "Notes:UPDATE",
    "Messages:READ", "Messages:CREATE", "Documents:READ", "Matières:READ", "Examens:READ",
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

export function getInternalRoleDefaults(role?: string): string[] {
  if (!role) return [];
  return INTERNAL_ROLE_DEFAULT_PERMISSIONS[role] ?? [];
}
