"use strict";

/**
 * C0 — validation fail-closed des cibles de navigation C4.
 *
 * Une notification transporte un pointeur vers une ressource, jamais un droit.
 * Avant de servir ce pointeur au client, on vérifie qu'il ne désigne pas une
 * ressource d'un autre établissement : sinon la cible est supprimée et la
 * notification devient non ouvrable.
 *
 * Trois propriétés tenues volontairement :
 *
 *  - **Aucun N+1.** La vérification est groupée : une seule requête par type de
 *    ressource présent dans la page, quelle que soit la taille de la page.
 *  - **Aucune réhydratation.** Les requêtes ne lisent que `id`, jamais une
 *    colonne métier. Le RBAC de la ressource cible reste seul juge de son
 *    contenu, au moment où l'utilisateur l'ouvre.
 *  - **Tolérance à la suppression.** Une ressource supprimée laisse un pointeur
 *    inerte, conservé tel quel : il ne résout plus rien. Seule une ressource
 *    *existante et rattachée à un autre établissement* déclenche le refus.
 */

/**
 * Contrat des cibles : pour chaque type, les identifiants transmis au client et
 * la table qui porte leur rattachement d'établissement. Registre figé et interne
 * — aucune valeur n'y provient d'une entrée utilisateur.
 */
const TARGET_RESOURCES = Object.freeze({
  conversation: [{ key: "conversationId", table: "school_conversations" }],
  announcement: [{ key: "announcementId", table: "announcements" }],
  attendance: [
    { key: "attendanceId", table: "attendance" },
    { key: "studentId", table: "students" },
  ],
  grade: [
    { key: "gradeId", table: "grades" },
    { key: "studentId", table: "students" },
  ],
  report_card: [
    { key: "reportCardId", table: "report_cards" },
    { key: "studentId", table: "students" },
  ],
  payment: [
    { key: "paymentId", table: "payments" },
    { key: "studentId", table: "students" },
  ],
  finance_obligation: [
    { key: "obligationId", table: "student_fee_obligations" },
    { key: "studentId", table: "students" },
  ],
  timetable: [
    { key: "weeklySlotId", table: "course_schedule_weekly_slots" },
    { key: "classId", table: "classes" },
  ],
  teacher_replacement: [
    { key: "replacementId", table: "course_schedule_replacements" },
    { key: "weeklySlotId", table: "course_schedule_weekly_slots" },
    { key: "classId", table: "classes" },
  ],
});

const ALLOWED_TABLES = new Set(
  Object.values(TARGET_RESOURCES).flatMap((resources) => resources.map((resource) => resource.table)),
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function verifiableId(value) {
  const id = String(value ?? "").trim();
  return UUID_PATTERN.test(id) ? id : null;
}

/**
 * Identifiants qui existent bel et bien, mais dans un autre établissement.
 * Une requête par table, sur un tableau d'identifiants.
 */
async function collectForeignIds(tx, schoolId, idsByTable) {
  const foreign = new Set();
  for (const [table, ids] of idsByTable) {
    if (!ALLOWED_TABLES.has(table)) continue;
    const candidates = [...ids];
    if (!candidates.length) continue;
    try {
      const rows = await tx.all(
        `SELECT id::text AS id FROM ${table} WHERE id = ANY($1::uuid[]) AND school_id <> $2::uuid`,
        [candidates, schoolId],
      );
      for (const row of rows) foreign.add(String(row.id));
    } catch {
      // Rattachement invérifiable : on refuse la cible plutôt que de la servir.
      for (const id of candidates) foreign.add(id);
    }
  }
  return foreign;
}

/**
 * Supprime, sur place, toute cible de navigation non conforme au tenant.
 * Attend des notifications déjà projetées (`navigationTarget`).
 */
async function sanitizeNavigationTargets(tx, schoolId, items) {
  if (!Array.isArray(items) || !items.length) return items;

  const idsByTable = new Map();
  const inspected = [];
  for (const item of items) {
    const target = item?.navigationTarget;
    if (!target || typeof target !== "object" || !Object.keys(target).length) continue;
    const resources = TARGET_RESOURCES[String(target.type ?? "")];
    if (!resources) {
      // Type hors contrat : non ouvrable, donc non servi.
      inspected.push({ item, ids: null });
      continue;
    }
    const ids = [];
    for (const { key, table } of resources) {
      const id = verifiableId(target[key]);
      if (!id) continue;
      ids.push(id);
      if (!idsByTable.has(table)) idsByTable.set(table, new Set());
      idsByTable.get(table).add(id);
    }
    inspected.push({ item, ids });
  }
  if (!inspected.length) return items;

  const foreign = idsByTable.size ? await collectForeignIds(tx, schoolId, idsByTable) : new Set();
  for (const { item, ids } of inspected) {
    if (ids === null || ids.some((id) => foreign.has(id))) item.navigationTarget = {};
  }
  return items;
}

module.exports = {
  TARGET_RESOURCES,
  sanitizeNavigationTargets,
};
