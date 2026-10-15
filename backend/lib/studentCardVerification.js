"use strict";

/**
 * CARTE-PR2 — vérification d'une carte élève, filtrée par RBAC AVANT toute transmission.
 *
 * Chaque section n'est lue et renvoyée que si la permission effective correspondante est
 * présente (jamais selon le libellé du rôle) ET si l'élève est dans le périmètre :
 *  - roleKey canonique TEACHER (ou libellé « Enseignant », plus restrictif) : classes affectées
 *    uniquement, quelles que soient les autres permissions — aucune élévation par rôle secondaire ;
 *  - autres rôles d'établissement : établissement entier.
 * Hors périmètre, seule la validité de la carte est indiquée.
 */

const { createHttpError } = require("./classesManagement");
const { scanStudentCard, listStudentCards } = require("./studentAccessCardsManagement");
const { scanStudentCardFinance } = require("./studentCardFinance");
const { isStudentCardCapabilityEnabled, mapSettingsRow } = require("./schoolSettingsManagement");
const { createSchoolSettingsPgStore } = require("../db/schoolSettingsPgStore");
const { ROLE_PRIVILEGE_ORDER, isKnownRoleKey } = require("./userRoleLifecycle");

const VERIFY_ROUTE_KEY = "POST /api/student-cards/verify";

/** Capacités évaluées avec le catalogue RBAC existant (permissions effectives relues en base). */
const CAPABILITY_ROUTE_KEYS = Object.freeze({
  identity: "GET /api/students",
  attendance: ["GET /api/presences", "POST /api/presences"],
  finance: "GET /api/finance/student-fees",
  cardHistory: "GET /api/students/:id/cards",
});
const GUARDIAN_CONTACT_PERMISSIONS = Object.freeze(["Relations:READ", "Gérer utilisateurs"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function principalRoleKeys(principal) {
  const keys = new Set();
  for (const key of Array.isArray(principal?.roleKeys) ? principal.roleKeys : []) {
    keys.add(String(key ?? "").trim().toUpperCase());
  }
  if (principal?.roleKey) keys.add(String(principal.roleKey).trim().toUpperCase());
  return keys;
}

// Liste positive dérivée du catalogue canonique. Aucun libellé ne peut conférer un droit.
const STAFF_ROLE_KEYS = new Set(ROLE_PRIVILEGE_ORDER.filter(
  (key) => !["SUPER_ADMIN", "COUNTRY_ADMIN", "PARENT", "STUDENT"].includes(key),
));

function assertStaffPrincipal(principal) {
  const keys = principalRoleKeys(principal);
  // L'absence de roleKey ou la présence d'une clé inconnue est refusée fail-closed.
  // Même avec un rôle secondaire valide, un rôle plateforme ne donne aucun accès scolaire.
  const authorized = keys.size > 0
    && [...keys].every((key) => isKnownRoleKey(key) && !["SUPER_ADMIN", "COUNTRY_ADMIN"].includes(key))
    && [...keys].some((key) => STAFF_ROLE_KEYS.has(key));
  if (!authorized) {
    throw createHttpError(403, "Vérification de carte réservée au personnel de l'établissement.", "CARD_VERIFY_FORBIDDEN");
  }
}

function isClassRestricted(principal) {
  return principalRoleKeys(principal).has("TEACHER");
}

function hasAnyPermission(principal, permissions) {
  const owned = new Set(Array.isArray(principal?.permissions) ? principal.permissions : []);
  return permissions.some((permission) => owned.has(permission));
}

function readVerifyDate(payload) {
  const raw = String(payload?.date ?? "").trim();
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(raw) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) {
    throw createHttpError(400, "Date invalide.", "CARD_VERIFY_INPUT_INVALID");
  }
  return raw;
}

async function financeCheckEnabled(repo, schoolId) {
  const store = typeof repo.getSchoolSettingsStore === "function" ? repo.getSchoolSettingsStore() : createSchoolSettingsPgStore(repo);
  const row = typeof store.getSettings === "function" ? await store.getSettings(schoolId) : null;
  return isStudentCardCapabilityEnabled(mapSettingsRow(row), "studentCardFinanceCheckEnabled");
}

async function studentInScope(repo, principal, scope, classId) {
  if (!isClassRestricted(principal)) return true;
  if (!classId || typeof repo.teacherHasActiveAssignmentForClassId !== "function") return false;
  // Forcé en « Enseignant » : un libellé personnalisé ne contourne pas le contrôle d'affectation.
  return Boolean(await repo.teacherHasActiveAssignmentForClassId(
    { ...principal, role: "Enseignant" },
    classId,
    scope.schoolId,
  ));
}

async function verifyStudentCard(repo, payload, scope, principal, can) {
  assertStaffPrincipal(principal);
  const date = readVerifyDate(payload);
  let resolved;
  try {
    resolved = await scanStudentCard(repo, { cardToken: payload?.cardToken }, scope);
  } catch (error) {
    // Carte inconnue, d'un autre établissement, remplacée, perdue, révoquée ou non activée :
    // la réponse ne dit que « invalide », sans aucune donnée.
    if (error?.statusCode === 404 || error?.statusCode === 409) {
      return { card: { valid: false }, scope: "none" };
    }
    throw error;
  }

  const inScope = await studentInScope(repo, principal, scope, resolved.class?.id);
  if (!inScope) return { card: { valid: true, medium: resolved.card.medium }, scope: "none" };

  const restricted = isClassRestricted(principal);
  const body = {
    card: { valid: true, medium: resolved.card.medium },
    scope: restricted ? "class" : "school",
  };
  // Un enseignant voit l'identité de ses classes ; les autres rôles selon Élèves:READ.
  if (restricted || await can(CAPABILITY_ROUTE_KEYS.identity)) {
    body.student = resolved.student;
    body.class = resolved.class;
  }
  if (await can(CAPABILITY_ROUTE_KEYS.attendance[0]) || await can(CAPABILITY_ROUTE_KEYS.attendance[1])) {
    const row = await repo.one(
      `SELECT status FROM attendance WHERE school_id = $1::uuid AND student_id = $2::uuid AND attendance_date = $3::date LIMIT 1`,
      [scope.schoolId, resolved.student.id, date],
    );
    body.attendance = { date, status: row?.status ?? null };
  }
  if (await can(CAPABILITY_ROUTE_KEYS.finance) && await financeCheckEnabled(repo, scope.schoolId)) {
    body.finance = await scanStudentCardFinance(repo, resolved, principal);
  }
  if (!restricted && await can(CAPABILITY_ROUTE_KEYS.cardHistory)) {
    body.cardHistory = (await listStudentCards(repo, resolved.student.id, scope)).map((card) => ({
      medium: card.medium,
      status: card.status,
      issuedAt: card.issuedAt ?? null,
      revokedAt: card.revokedAt ?? null,
    }));
  }
  if (hasAnyPermission(principal, GUARDIAN_CONTACT_PERMISSIONS) && typeof repo.listParentRelations === "function") {
    const relations = await repo.listParentRelations(
      { studentId: resolved.student.id },
      { ...principal, schoolCode: scope.loginCode },
    );
    body.guardians = (relations?.items ?? [])
      .filter((item) => item.status === "Actif")
      .map((item) => ({ name: item.name ?? "", phone: item.phone ?? "", isPrincipal: item.isPrincipal === "Oui" }));
  }
  return body;
}

module.exports = {
  VERIFY_ROUTE_KEY,
  CAPABILITY_ROUTE_KEYS,
  GUARDIAN_CONTACT_PERMISSIONS,
  isClassRestricted,
  verifyStudentCard,
};
