/** Fiches créées uniquement via Contacts (aligné web). */
export const CONTACT_PROVISIONED_ENTITIES = new Set(["students", "teachers"]);

export function entityCreateViaContactsOnly(entity: string): boolean {
  return CONTACT_PROVISIONED_ENTITIES.has(entity);
}

export const CONTACT_PROVISIONING_HINT =
  "Créez d'abord le compte depuis Comptes utilisateurs, puis attribuez le rôle Enseignant.";
