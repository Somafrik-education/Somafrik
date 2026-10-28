"use strict";

/**
 * Correctif MONO-T1-A2 — lecture des dates d'échéance d'abonnement.
 *
 * Avant le correctif, parseFrDate lisait toujours [jour, mois, année] : la date
 * ISO « 2027-08-31 » renvoyée par le magasin plateforme devenait l'an 31, soit
 * des centaines de milliers de jours de retard, et tout établissement à
 * abonnement daté était « blocked ».
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseSubscriptionDate,
  computeDelinquencyDays,
  resolveSchoolAccess,
  assertSchoolFeature,
} = require("./schoolSubscriptionAccessService");
const { mapSubscriptionRow } = require("../lib/platformManagement");

const DAY = 24 * 60 * 60 * 1000;

function isoDaysFromToday(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function frFromIso(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function stateWith(subscription) {
  return { schools: [{ code: "X" }], subscriptions: [{ schoolCode: "X", status: "Actif", ...subscription }] };
}

test("ISO, français (tiret ou barre) et ISO horodaté désignent le même jour local", () => {
  for (const value of ["2027-08-31", "31-08-2027", "31/08/2027", "2027-08-31T10:00:00"]) {
    const date = parseSubscriptionDate(value);
    assert.ok(date, value);
    assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate()], [2027, 7, 31], value);
  }
  assert.deepEqual(parseSubscriptionDate("2027-8-1"), new Date(2027, 7, 1));
  assert.deepEqual(parseSubscriptionDate("1/8/2027"), new Date(2027, 7, 1));
});

test("valeurs vides, illisibles ou de calendrier impossible ⇒ null", () => {
  for (const value of [null, undefined, "", "  ", "pas une date", "31-02-2027", "2027-02-30", "2027-13-01", "00-01-2027"]) {
    assert.equal(parseSubscriptionDate(value), null, String(value));
  }
  assert.equal(parseSubscriptionDate(new Date("invalide")), null);
  const now = new Date();
  assert.equal(parseSubscriptionDate(now), now);
});

test("retard : échéance future ou du jour ⇒ 0 ; échéance passée ⇒ jours écoulés, en ISO comme en français", () => {
  const today = new Date(2027, 8, 10, 12);
  for (const [endDate, expected] of [
    ["2027-09-10", 0],
    ["2027-12-31", 0],
    ["2027-09-01", 9],
    ["01-09-2027", 9],
    ["2027-08-11", 30],
  ]) {
    assert.equal(computeDelinquencyDays({ endDate }, today), expected, endDate);
  }
});

test("régression A2 : échéance ISO future ⇒ accès complet et fonctions sous abonnement autorisées", () => {
  const endDate = isoDaysFromToday(365);
  const access = resolveSchoolAccess("X", stateWith({ endDate }));
  assert.deepEqual({ level: access.level, daysLate: access.daysLate }, { level: "full", daysLate: 0 });
  for (const feature of ["create_student", "announcements", "notifications", "write_notes", "write_presence"]) {
    assert.doesNotThrow(() => assertSchoolFeature("X", stateWith({ endDate }), feature), feature);
  }
});

test("politique de retard inchangée : J+14 ⇒ limited, J+30 ⇒ blocked, identique en ISO et en français", () => {
  for (const [days, level] of [[-1, "full"], [-13, "full"], [-14, "limited"], [-29, "limited"], [-30, "blocked"]]) {
    const iso = isoDaysFromToday(days);
    assert.equal(resolveSchoolAccess("X", stateWith({ endDate: iso })).level, level, `ISO ${iso}`);
    assert.equal(resolveSchoolAccess("X", stateWith({ endDate: frFromIso(iso) })).level, level, `FR ${frFromIso(iso)}`);
  }
});

test("chaîne réelle : ligne PostgreSQL (DATE) → mapSubscriptionRow → accès complet", () => {
  const endDate = isoDaysFromToday(200);
  for (const endValue of [endDate, new Date(`${endDate}T00:00:00`)]) {
    const subscription = mapSubscriptionRow({
      id: "sub-1",
      school_id: "school-1",
      school_code: "X",
      plan_name: "Standard",
      status: "active",
      start_date: "2026-09-01",
      end_date: endValue,
      profile_payload: {},
    });
    const access = resolveSchoolAccess("X", { schools: [{ code: "X" }], subscriptions: [subscription] });
    assert.equal(access.level, "full", `end_date ${String(endValue)} → endDate ${subscription.endDate}`);
    assert.ok(access.daysLate === 0, `${access.daysLate} jours de retard`);
  }
  assert.ok(Math.abs(parseSubscriptionDate(endDate).getTime() - Date.now()) < 201 * DAY);
});

/* ------------------------------------------------------------------------ *
 * MONO-FIX-O9 — normalisation des statuts : un abonnement suspendu bloque.  *
 * ------------------------------------------------------------------------ */

const {
  canonicalSubscriptionStatus,
  resolveAccessLevel,
  canUseFeature,
} = require("./schoolSubscriptionAccessService");
const { PostgresRepository } = require("../db/postgresRepository");

const FUTURE = isoDaysFromToday(200);
const SENSITIVE_FEATURES = ["connect", "write_notes", "write_presence", "create_student", "announcements", "notifications"];

function levelOf(subscription, school = { code: "X" }) {
  return resolveSchoolAccess("X", { schools: [school], subscriptions: [{ schoolCode: "X", endDate: FUTURE, ...subscription }] }).level;
}

test("O9 — statuts stockés (anglais) et libellés historiques (français) normalisés ; inconnu ⇒ « Inconnu »", () => {
  const expected = {
    active: "Actif", Actif: "Actif", ACTIVE: "Actif",
    trial: "Essai", Essai: "Essai", draft: "Brouillon", Brouillon: "Brouillon",
    suspended: "Suspendu", Suspendu: "Suspendu", " SUSPENDED ": "Suspendu",
    expired: "Expiré", "Expiré": "Expiré", expire: "Expiré",
    "En retard": "En retard", past_due: "En retard",
    cancelled: "Annulé", canceled: "Annulé", "Annulé": "Annulé",
    terminated: "Résilié", "Résilié": "Résilié",
    en_attente_validation: "Inconnu", pending: "Inconnu", "n'importe quoi": "Inconnu",
  };
  for (const [value, canonical] of Object.entries(expected)) {
    assert.equal(canonicalSubscriptionStatus(value), canonical, JSON.stringify(value));
  }
  for (const empty of [null, undefined, "", "   "]) assert.equal(canonicalSubscriptionStatus(empty), null);
});

test("O9 — « suspended » dans n'importe quel signal ⇒ blocked, même avec échéance future, paiement à jour et accessLevel « full »", () => {
  const signals = [
    { status: "suspended" },
    { status: "Suspendu" },
    { dbStatus: "suspended", status: "Actif", lifecycleStatus: "Actif" },
    { lifecycleStatus: "Suspendu", status: "active" },
    { status: "active", paymentStatus: "Suspendu" },
  ];
  for (const signal of signals) {
    assert.equal(levelOf({ paymentStatus: "À jour", accessLevel: "full", ...signal }), "blocked", JSON.stringify(signal));
    assert.equal(levelOf({ paymentStatus: "À jour", ...signal }), "blocked", JSON.stringify(signal));
  }
});

test("O9 — établissement suspendu (« suspended » ou « Suspendu ») ⇒ blocked, même avec abonnement actif et accessLevel « full »", () => {
  for (const status of ["suspended", "Suspendu", "SUSPENDU"]) {
    assert.equal(levelOf({ status: "active", paymentStatus: "À jour", accessLevel: "full" }, { code: "X", status }), "blocked", status);
  }
  assert.equal(levelOf({ status: "active", paymentStatus: "À jour" }, { code: "X", status: "active" }), "full");
});

test("O9 — statut inconnu, annulé ou résilié : aucun accès par défaut", () => {
  for (const status of ["en_attente_validation", "pending", "cancelled", "Annulé", "terminated", "Résilié"]) {
    assert.equal(levelOf({ status, paymentStatus: "À jour" }), "blocked", `status ${status}`);
    assert.equal(levelOf({ dbStatus: status, status: "Actif", paymentStatus: "À jour" }), "blocked", `dbStatus ${status}`);
    assert.equal(levelOf({ lifecycleStatus: status, status: "active" }), "blocked", `lifecycleStatus ${status}`);
  }
  assert.equal(levelOf({ status: "active", accessLevel: "superuser" }), "blocked", "accessLevel invalide");
});

test("O9 — règles existantes conservées : retard de paiement, échéances J+14 / J+30, expiré, essai, abonnement absent", () => {
  assert.equal(levelOf({ status: "active", paymentStatus: "À jour" }), "full");
  assert.equal(levelOf({ status: "trial", paymentStatus: "À jour" }), "full");
  assert.equal(levelOf({ status: "active", paymentStatus: "En retard" }), "limited");
  assert.equal(levelOf({ status: "expired", paymentStatus: "En retard" }), "limited", "ordre historique : retard avant expiré");
  assert.equal(levelOf({ status: "expired", paymentStatus: "À jour" }), "blocked");
  assert.equal(levelOf({ status: "active", paymentStatus: "À jour", endDate: isoDaysFromToday(-14) }), "limited");
  assert.equal(levelOf({ status: "active", paymentStatus: "À jour", endDate: isoDaysFromToday(-30) }), "blocked");
  assert.equal(levelOf({ status: "active", accessLevel: "limited" }), "limited", "surcharge explicite valide conservée");
  assert.equal(
    resolveSchoolAccess("X", { schools: [{ code: "X" }], subscriptions: [] }).level,
    "full",
    "abonnement absent : comportement inchangé (hors périmètre O9)",
  );
});

test("O9 — fonctionnalités sensibles : blocked refuse tout ; limited garde notes/présences mais pas l'inscription", () => {
  for (const feature of SENSITIVE_FEATURES) {
    assert.equal(canUseFeature({ level: "blocked" }, feature), false, `blocked ${feature}`);
  }
  assert.deepEqual(
    SENSITIVE_FEATURES.filter((feature) => canUseFeature({ level: "limited" }, feature)),
    ["connect", "write_notes", "write_presence"],
  );
  assert.throws(() => assertSchoolFeature("X", { schools: [{ code: "X" }], subscriptions: [{ schoolCode: "X", status: "suspended" }] }, "write_notes"), (error) => error.statusCode === 403);
});

test("O9 — projections : le statut stocké n'est plus masqué (profil JSON « Actif », fromDbStatus)", () => {
  const platformRow = mapSubscriptionRow({
    id: "sub-o9",
    school_id: "school-1",
    school_code: "X",
    plan_name: "Standard",
    status: "suspended",
    end_date: FUTURE,
    profile_payload: { status: "Actif", lifecycleStatus: "Actif", paymentStatus: "À jour", accessLevel: "full" },
  });
  assert.equal(platformRow.status, "Actif", "le profil masque toujours le libellé affiché");
  assert.equal(platformRow.dbStatus, "suspended", "mais le statut stocké est transmis");
  assert.equal(resolveAccessLevel(platformRow, { code: "X" }), "blocked");

  const repository = Object.create(PostgresRepository.prototype);
  for (const [stored, level] of [["suspended", "blocked"], ["en_attente_validation", "blocked"], ["active", "full"]]) {
    const datasetRow = repository.mapSubscription({ id: "s", school_code: "X", status: stored, end_date: new Date(`${FUTURE}T00:00:00`), price_per_student: 0 });
    assert.equal(datasetRow.dbStatus, stored);
    assert.equal(resolveAccessLevel(datasetRow, { code: "X" }), level, `jeu de données, statut ${stored}`);
  }
});
