"use strict";

// NFC-P0-R3-1 — read-only diagnosis of a physical NFC card from its UID.
//
// Purpose: find why a card is refused and who holds it in THIS school, so R1/R2 can
// recover it for its original pupil. Never writes to the card row, never releases a UID,
// never reassigns a card (R3-4/R3-5 are on HOLD).
//
// Cross-school isolation (CTO review C-1), enforced by construction:
//   1. lookupUidOwnership() is the ONLY query that crosses schools. It is required by the
//      global UID uniqueness and returns a single boolean (same school or not).
//   2. Every other query is bound to the caller's school (school_id = $1) with an explicit
//      column list, and runs only when step 1 answered "same school".
// The response for another school's card carries no status, date, holder or identifier.
// No secret, token hash, NDEF content or full UID is read back, returned or audited.

const { createHttpError } = require("./classesManagement");
const { RbacService } = require("../services/rbacService");
const { normalizeNfcIdentity, assertNfcEnabled } = require("./studentCardsNfcEncoding");

const rbac = new RbacService();
// Same population as NFC programming (card managers of the school).
const DIAGNOSIS_PERMISSION_ROUTE = "POST /api/student-cards/:id/nfc-confirm";

const NDEF_STATES = new Set(["empty", "somafrik", "foreign", "unreadable"]);
const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;

const CODE_MESSAGES = Object.freeze({
  UID_UNKNOWN: "Cette carte n’est enregistrée dans aucun établissement.",
  OTHER_SCHOOL: "Cette carte est gérée par un autre établissement. Aucune information n’est disponible.",
  LIVE_RESERVATION: "Une programmation de cette carte est en cours pour un élève de l’établissement.",
  EXPIRED_NOT_MATERIALISED: "La réservation de cette carte a expiré sans être finalisée.",
  R2_ELIGIBLE: "Réservation expirée jamais encodée : la carte peut être reprise pour son élève d’origine.",
  EXPIRED_HOLDER_INACTIVE: "Réservation expirée d’un élève qui n’est plus actif.",
  EXPIRED_HOLDER_HAS_CARD: "Réservation expirée : l’élève d’origine possède déjà une autre carte ou réservation.",
  EXPIRED_REPLACEMENT: "Remplacement de carte non abouti et expiré.",
  REVOKED_NEVER_ENCODED: "Réservation révoquée avant encodage (annulation ou sécurité, non distinguables).",
  ACTIVE: "Carte active : elle est en service pour un élève de l’établissement.",
  LOST: "Carte déclarée perdue ou volée.",
  REPLACED: "Carte remplacée par une autre carte.",
  REVOKED_SECURITY: "Carte révoquée après encodage.",
  LOCKED_RECORDED: "Carte enregistrée comme verrouillée.",
  UNCLASSIFIED: "État de carte non reconnu.",
});

const PHYSICAL_MESSAGES = Object.freeze({
  BLANK: "Puce vierge.",
  SOMAFRIK_THIS_CARD: "La puce contient déjà le jeton Somafrik de cette carte.",
  SOMAFRIK_OTHER_CARD: "La puce contient un jeton Somafrik qui ne correspond pas à cette carte.",
  FOREIGN: "La puce contient des données qui ne viennent pas de Somafrik.",
  UNREADABLE: "Le contenu de la puce est illisible.",
  READ_ONLY: "La puce est verrouillée en lecture seule.",
  MODEL_MISMATCH: "Le modèle de puce ne correspond pas à celui enregistré.",
});

// Physical states that forbid any recovery, whatever the database says.
const BLOCKING_PHYSICAL = new Set(["SOMAFRIK_OTHER_CARD", "FOREIGN", "UNREADABLE", "READ_ONLY", "MODEL_MISMATCH"]);

function error(code, message, status) { return createHttpError(status, message, code); }

function authorize(principal, scope) {
  if (!principal || !scope?.schoolId || !rbac.canAccess(principal, DIAGNOSIS_PERMISSION_ROUTE)) {
    throw error("STUDENT_CARD_TENANT_DENIED", "Diagnostic de carte NFC refusé.", 403);
  }
  if (!principal.enrollmentSchoolId || principal.enrollmentSchoolId !== scope.schoolId) {
    throw error("STUDENT_CARD_TENANT_DENIED", "Établissement hors périmètre.", 403);
  }
}

function normalizeObservation(payload) {
  const identity = normalizeNfcIdentity(payload);
  const ndef = payload?.ndef;
  if (!ndef || typeof ndef !== "object" || Array.isArray(ndef) || !NDEF_STATES.has(ndef.state)) {
    throw error("STUDENT_CARD_NFC_INVALID", "Observation NFC invalide.", 400);
  }
  if (typeof payload.readOnly !== "boolean") {
    throw error("STUDENT_CARD_NFC_INVALID", "Observation NFC invalide.", 400);
  }
  // Only the public identifier may accompany a Somafrik content: never the secret.
  let publicId = null;
  if (ndef.state === "somafrik") {
    publicId = typeof ndef.publicId === "string" ? ndef.publicId : "";
    if (!PUBLIC_ID.test(publicId)) throw error("STUDENT_CARD_NFC_INVALID", "Observation NFC invalide.", 400);
  }
  return { ...identity, ndefState: ndef.state, publicId, readOnly: payload.readOnly };
}

function maskUid(uid) {
  return `${uid.slice(0, 2)}••••••••${uid.slice(-4)}`;
}

// ---- Step 1: the single cross-school read (boolean only). ------------------------------
async function lookupUidOwnership(db, uid, schoolId) {
  const row = await db.one(
    "SELECT (school_id = $2::uuid) AS same_school FROM student_access_cards WHERE nfc_uid = $1",
    [uid, schoolId],
  );
  return row ? { exists: true, sameSchool: row.same_school === true } : { exists: false, sameSchool: null };
}

// ---- Step 2: school-bound reads, explicit columns. --------------------------------------
async function readSchoolCard(db, schoolId, uid) {
  return db.one(
    `SELECT id, student_id, public_id, status, revoke_reason, nfc_tag_type, nfc_encoding_state,
            nfc_encoded_at, nfc_locked_at, nfc_replaces_card_id, issued_at, revoked_at,
            nfc_reservation_expires_at <= clock_timestamp() AS deadline_past
       FROM student_access_cards
      WHERE school_id = $1 AND nfc_uid = $2`,
    [schoolId, uid],
  );
}

async function readSchoolHolder(db, schoolId, card) {
  const student = await db.one(
    `SELECT s.id, s.first_name, s.last_name, s.student_code, s.status,
            k.class_code, k.name AS class_name
       FROM students s
       LEFT JOIN LATERAL (
         SELECT c.class_code, c.name
           FROM enrollments e
           JOIN academic_years y ON y.id = e.academic_year_id AND y.school_id = $1 AND y.is_current = TRUE
           JOIN classes c ON c.id = e.class_id AND c.school_id = $1
          WHERE e.school_id = $1 AND e.student_id = s.id AND e.status = 'active'
          LIMIT 1
       ) k ON TRUE
      WHERE s.school_id = $1 AND s.id = $2`,
    [schoolId, card.student_id],
  );
  const others = await db.one(
    `SELECT EXISTS (SELECT 1 FROM student_access_cards
                     WHERE school_id = $1 AND student_id = $2 AND id <> $3 AND status = 'active') AS has_active,
            EXISTS (SELECT 1 FROM student_access_cards
                     WHERE school_id = $1 AND student_id = $2 AND id <> $3 AND status = 'issued'
                       AND nfc_encoding_state = 'pending'
                       AND nfc_reservation_expires_at > clock_timestamp()) AS has_live_reservation`,
    [schoolId, card.student_id, card.id],
  );
  return { student, hasOtherActive: others.has_active === true, hasLiveReservation: others.has_live_reservation === true };
}

function classify(card, holder) {
  if (card.nfc_encoding_state === "locked" || card.nfc_locked_at) return "LOCKED_RECORDED";
  if (card.status === "active") return "ACTIVE";
  if (card.status === "lost") return "LOST";
  if (card.status === "replaced") return "REPLACED";
  if (card.status === "issued" && card.nfc_encoding_state === "pending") {
    return card.deadline_past ? "EXPIRED_NOT_MATERIALISED" : "LIVE_RESERVATION";
  }
  if (card.status === "revoked" && card.nfc_encoded_at == null) {
    if (card.revoke_reason !== "nfc_reservation_expired") return "REVOKED_NEVER_ENCODED";
    if (card.nfc_replaces_card_id) return "EXPIRED_REPLACEMENT";
    if (holder.student?.status !== "active") return "EXPIRED_HOLDER_INACTIVE";
    if (holder.hasOtherActive || holder.hasLiveReservation) return "EXPIRED_HOLDER_HAS_CARD";
    return "R2_ELIGIBLE";
  }
  if (card.status === "revoked") return "REVOKED_SECURITY";
  return "UNCLASSIFIED";
}

function physicalState(observation, card) {
  if (observation.readOnly) return "READ_ONLY";
  if (card && card.nfc_tag_type !== observation.tagType) return "MODEL_MISMATCH";
  switch (observation.ndefState) {
    case "empty": return "BLANK";
    case "foreign": return "FOREIGN";
    case "unreadable": return "UNREADABLE";
    default:
      // Compared with THIS school's row only; another school's identifier is never read.
      return card && card.public_id === observation.publicId ? "SOMAFRIK_THIS_CARD" : "SOMAFRIK_OTHER_CARD";
  }
}

// Actions only point to existing, tested flows. No release, no reassignment (R3-4 HOLD).
function decide(code, physical) {
  if (BLOCKING_PHYSICAL.has(physical)) return { recoverable: false, actions: [] };
  switch (code) {
    case "UID_UNKNOWN":
      return physical === "BLANK" ? { recoverable: true, actions: ["program_new_card"] } : { recoverable: false, actions: [] };
    case "OTHER_SCHOOL": return { recoverable: false, actions: ["contact_owner_school"] };
    case "LIVE_RESERVATION": return { recoverable: true, actions: ["resume_operation"] };
    case "EXPIRED_NOT_MATERIALISED": return { recoverable: true, actions: ["open_holder_cards"] };
    case "R2_ELIGIBLE":
      return physical === "SOMAFRIK_THIS_CARD"
        ? { recoverable: true, actions: ["recover_without_rewrite"] }
        : { recoverable: true, actions: ["reencode_for_holder"] };
    case "ACTIVE":
      return physical === "SOMAFRIK_THIS_CARD"
        ? { recoverable: false, actions: [] } // card in service and intact
        : { recoverable: false, actions: ["declare_lost_and_replace"] };
    case "EXPIRED_HOLDER_INACTIVE":
    case "EXPIRED_HOLDER_HAS_CARD":
    case "EXPIRED_REPLACEMENT":
    case "REVOKED_NEVER_ENCODED":
      return { recoverable: false, actions: ["cto_review"] };
    default:
      return { recoverable: false, actions: [] };
  }
}

function day(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

async function diagnoseStudentCardNfc(repo, payload, principal, meta, scope) {
  authorize(principal, scope);
  const observation = normalizeObservation(payload);
  if (typeof repo.withTransaction !== "function" || typeof repo.recordAudit !== "function") {
    throw error("STUDENT_CARD_NFC_POSTGRES_REQUIRED", "PostgreSQL requis pour le diagnostic NFC.", 503);
  }
  const result = await repo.withTransaction(async (tx) => {
    // The whole diagnosis runs in a READ ONLY transaction: no write can slip in.
    await tx.query("SET TRANSACTION READ ONLY");
    const db = { one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null };
    db.getSchoolSettingsStore = () => ({
      getSettings: (id) => db.one("SELECT * FROM school_settings WHERE school_id = $1", [id]),
    });
    await assertNfcEnabled(db, scope.schoolId);

    const ownership = await lookupUidOwnership(db, observation.uid, scope.schoolId);
    if (!ownership.exists) {
      const physical = physicalState(observation, null);
      return { code: "UID_UNKNOWN", sameSchool: null, physical, ...decide("UID_UNKNOWN", physical) };
    }
    if (!ownership.sameSchool) {
      // Stop here: nothing else about another school's card is ever read.
      const physical = physicalState(observation, null);
      return { code: "OTHER_SCHOOL", sameSchool: false, physical, ...decide("OTHER_SCHOOL", physical) };
    }
    const card = await readSchoolCard(db, scope.schoolId, observation.uid);
    if (!card) throw error("STUDENT_CARD_NFC_CONFLICT", "La carte a changé pendant le diagnostic. Réessayez.", 409);
    const holder = await readSchoolHolder(db, scope.schoolId, card);
    const code = classify(card, holder);
    const physical = physicalState(observation, card);
    return {
      code, sameSchool: true, physical, ...decide(code, physical),
      card: {
        id: card.id, status: card.status, encodingState: card.nfc_encoding_state, tagType: card.nfc_tag_type,
        everEncoded: card.nfc_encoded_at != null, isReplacement: card.nfc_replaces_card_id != null,
        issuedDay: day(card.issued_at), revokedDay: day(card.revoked_at),
      },
      holder: holder.student ? {
        id: holder.student.id, firstName: holder.student.first_name, lastName: holder.student.last_name,
        studentCode: holder.student.student_code, active: holder.student.status === "active",
        classCode: holder.student.class_code ?? null, className: holder.student.class_name ?? null,
      } : null,
    };
  });

  // Mandatory audit (no best effort): masked UID, codes, never NDEF, token or holder data.
  await repo.recordAudit({
    schoolCode: scope.loginCode, userId: principal.sub || principal.id,
    action: "student_card_nfc_diagnosed", entityType: "student_access_card",
    entityId: result.sameSchool === true ? result.card.id : null,
    oldValue: null,
    newValue: { uid: maskUid(observation.uid), tagType: observation.tagType, code: result.code, physical: result.physical },
    ipAddress: meta?.ipAddress, userAgent: meta?.userAgent,
  });

  return {
    ...result,
    message: CODE_MESSAGES[result.code],
    physicalMessage: PHYSICAL_MESSAGES[result.physical],
  };
}

module.exports = {
  diagnoseStudentCardNfc,
  // Exported for tests and static isolation checks.
  lookupUidOwnership, readSchoolCard, readSchoolHolder, classify, physicalState, decide, maskUid,
  CODE_MESSAGES, PHYSICAL_MESSAGES,
};
