"use strict";

/**
 * NFC-ROLES-ACCESS-01 — droit dédié « Présences — Effectuer l'appel (NFC/QR) » (module `roll_call`, jeton `Présences — Effectuer l'appel (NFC/QR):CREATE`).
 *
 * Compatibilité (aucun droit existant supprimé, aucun nouveau titulaire) : avant ce chantier,
 * l'appel NFC/QR local-first était ouvert aux rôles TEACHER, SCHOOL_ADMIN, PROVISEUR, PRINCIPAL,
 * PREFET_ETUDES et SECRETARY disposant de l'écriture des présences (NFC-ROLES-FINAL-01). Ces
 * titulaires reçoivent le droit dédié, à l'IDENTIQUE de leur droit présences (même rôle, même
 * portée globale / pays / établissement), et une seule fois :
 *  - grants réels : une ligne `roll_call` n'est créée que si AUCUNE ligne `roll_call` (active ou
 *    archivée) n'a jamais existé pour ce rôle et cette portée. Un retrait ultérieur dans la matrice
 *    (archivage ou décochage, jamais de suppression physique) n'est donc jamais annulé ;
 *  - rôles sans aucun grant (repli sur les cartes historiques) : le droit est dérivé à la lecture
 *    de l'écriture des présences du MÊME rôle (`legacyRollCallCrud`), tant que le rôle n'a pas de
 *    ligne configurée.
 * Les autres rôles (surveillant, comptable…) n'obtiennent ce droit que par attribution explicite.
 */

const ROLL_CALL_MODULE_KEY = "roll_call";
const ROLL_CALL_PERMISSION = "Présences — Effectuer l'appel (NFC/QR):CREATE";
const ROLL_CALL_COMPAT_ROLE_KEYS = Object.freeze(["TEACHER", "SCHOOL_ADMIN", "PROVISEUR", "PRINCIPAL", "PREFET_ETUDES", "SECRETARY"]);
const ROLL_CALL_COMPAT_UPDATED_BY = "nfc-roles-access-01-compat";

/** Copie unique des titulaires existants (PostgreSQL). Renvoie le nombre de lignes créées. */
async function backfillRollCallGrantsFromAttendance(repo) {
  if (typeof repo?.query !== "function" || repo?.engine === "memory") return 0;
  const result = await repo.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, country_id, school_id, module_key,
       can_create, can_read, can_update, can_delete, status, version, created_by, updated_by
     )
     SELECT upper(a.role_key), a.scope_type, a.country_id, a.school_id, $2,
            TRUE, TRUE, FALSE, FALSE, 'active', 1, $3, $3
       FROM role_module_permissions a
      WHERE a.module_key = 'attendance' AND a.status = 'active' AND (a.can_create OR a.can_update)
        AND upper(a.role_key) = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1 FROM role_module_permissions r
           WHERE r.module_key = $2
             AND upper(r.role_key) = upper(a.role_key)
             AND r.scope_type = a.scope_type
             AND r.country_id IS NOT DISTINCT FROM a.country_id
             AND r.school_id IS NOT DISTINCT FROM a.school_id
        )`,
    [ROLL_CALL_COMPAT_ROLE_KEYS, ROLL_CALL_MODULE_KEY, ROLL_CALL_COMPAT_UPDATED_BY],
  );
  return Number(result?.rowCount ?? 0);
}

/** Rôle sans grant configuré : droit dérivé de l'écriture des présences du même rôle (compatibilité). */
function legacyRollCallCrud(roleKey, attendanceCrud) {
  if (!ROLL_CALL_COMPAT_ROLE_KEYS.includes(String(roleKey ?? "").toUpperCase())) return null;
  if (!attendanceCrud || !(attendanceCrud.canCreate || attendanceCrud.canUpdate)) return null;
  return { canCreate: true, canRead: true, canUpdate: false, canDelete: false };
}

module.exports = {
  ROLL_CALL_MODULE_KEY,
  ROLL_CALL_PERMISSION,
  ROLL_CALL_COMPAT_ROLE_KEYS,
  ROLL_CALL_COMPAT_UPDATED_BY,
  backfillRollCallGrantsFromAttendance,
  legacyRollCallCrud,
};
