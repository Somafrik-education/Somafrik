/**
 * D3.4b — Contrat d'identité Parents et migration des relations.
 *
 * Contrat cible :
 *   relations.fromContactId = contact.id
 *   user.contactId = contact.id
 *   user.id = identité technique d'auth uniquement
 */

function normalizeId(value) {
  return String(value ?? "").trim();
}

function isParentChildRelation(relation) {
  const type = String(relation?.relationType ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return type === "parent → eleve" || type === "parent -> eleve" || type === "parent - eleve";
}

/**
 * Inventaire des relations Parent → Élève et classification d'identité.
 *
 * Statuts :
 * - canonical — fromContactId ∈ contacts et user.contactId correspondant
 * - contact_without_user — fromContactId ∈ contacts sans user lié
 * - legacy_user_id — fromContactId = user.id et user.contactId ∈ contacts (migrable)
 * - legacy_missing_contact — fromContactId = user.id mais user.contactId absent du registre
 * - user_without_contactId — fromContactId = user.id sans contactId
 * - orphan — aucune correspondance user/contact
 */
function inventoryParentRelations(state = {}) {
  const users = Array.isArray(state.users) ? state.users : [];
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const relations = Array.isArray(state.relations) ? state.relations : [];

  const contactIds = new Set(contacts.map((row) => normalizeId(row.id)).filter(Boolean));
  const usersById = new Map(users.map((row) => [normalizeId(row.id), row]));
  const usersByContactId = new Map(
    users
      .filter((row) => normalizeId(row.contactId))
      .map((row) => [normalizeId(row.contactId), row]),
  );

  const items = [];
  for (const relation of relations) {
    if (!isParentChildRelation(relation)) continue;
    const fromContactId = normalizeId(relation.fromContactId);
    const byContact = contactIds.has(fromContactId);
    const userById = usersById.get(fromContactId);
    const userByContact = usersByContactId.get(fromContactId);
    const mappedContactId = normalizeId(userById?.contactId);
    const mappedContactExists = Boolean(mappedContactId && contactIds.has(mappedContactId));

    let status = "orphan";
    if (byContact && userByContact) status = "canonical";
    else if (byContact && !userByContact) status = "contact_without_user";
    else if (userById && mappedContactId && mappedContactExists) status = "legacy_user_id";
    else if (userById && mappedContactId && !mappedContactExists) status = "legacy_missing_contact";
    else if (userById) status = "user_without_contactId";

    items.push({
      relationId: normalizeId(relation.id),
      fromContactId,
      toStudentId: normalizeId(relation.toStudentId),
      schoolCode: normalizeId(relation.schoolCode),
      status,
      mappedContactId: mappedContactId || (byContact ? fromContactId : ""),
      mappedContactExists,
    });
  }

  const summary = {
    total: items.length,
    canonical: items.filter((row) => row.status === "canonical").length,
    legacyUserId: items.filter((row) => row.status === "legacy_user_id").length,
    legacyMissingContact: items.filter((row) => row.status === "legacy_missing_contact").length,
    contactWithoutUser: items.filter((row) => row.status === "contact_without_user").length,
    userWithoutContactId: items.filter((row) => row.status === "user_without_contactId").length,
    orphan: items.filter((row) => row.status === "orphan").length,
  };

  return { items, summary };
}

/**
 * Migration idempotente : remappe fromContactId = user.id → user.contactId
 * uniquement si le contact cible existe dans `state.contacts`.
 */
function migrateParentRelationsToContactId(state = {}) {
  const users = Array.isArray(state.users) ? state.users : [];
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  const relations = Array.isArray(state.relations) ? state.relations : [];
  const usersById = new Map(users.map((row) => [normalizeId(row.id), row]));
  const contactIds = new Set(contacts.map((row) => normalizeId(row.id)).filter(Boolean));

  let changed = 0;
  let skippedMissingContact = 0;
  const nextRelations = relations.map((relation) => {
    if (!isParentChildRelation(relation)) return relation;
    const fromContactId = normalizeId(relation.fromContactId);
    const user = usersById.get(fromContactId);
    const contactId = normalizeId(user?.contactId);
    if (!user || !contactId || contactId === fromContactId) {
      return relation;
    }
    if (!contactIds.has(contactId)) {
      skippedMissingContact += 1;
      return relation;
    }
    changed += 1;
    return {
      ...relation,
      fromContactId: contactId,
      fromContactName:
        String(relation.fromContactName ?? "").trim() ||
        `${String(user.firstName ?? "").trim()} ${String(user.lastName ?? "").trim()}`.trim(),
    };
  });

  return {
    relations: nextRelations,
    changed,
    skippedMissingContact,
    inventory: inventoryParentRelations({ ...state, relations: nextRelations }),
  };
}

module.exports = {
  inventoryParentRelations,
  migrateParentRelationsToContactId,
  isParentChildRelation,
};
