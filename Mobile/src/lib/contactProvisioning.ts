/** Fiches créées uniquement via Contacts (aligné web). Élèves : inscription Classes → Inscrire. */
export const CONTACT_PROVISIONED_ENTITIES = new Set(["teachers"]);

export function entityCreateViaContactsOnly(entity: string): boolean {
  return CONTACT_PROVISIONED_ENTITIES.has(entity);
}

export const CONTACT_PROVISIONING_HINT =
  "Créez d'abord un contact (Élève, Enseignant, etc.) depuis le backoffice web — section Contacts.";
