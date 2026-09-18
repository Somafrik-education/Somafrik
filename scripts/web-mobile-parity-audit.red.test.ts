/**
 * Caractérisation RED — divergences encore ouvertes.
 * Ces tests DOIVENT échouer tant que les lots de correction n'ont pas le GO CTO.
 *
 *   npx --yes tsx scripts/web-mobile-parity-audit.red.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { rollCallInitialStatus } from "../web/src/lib/presenceMetrics.ts";
import { formatFinanceDate as webFinanceDate } from "../web/src/lib/financeCurrency.ts";
import { formatDateForDisplay } from "../web/src/lib/dates.ts";
import { CRUD_PERMISSION_MODULES as webCrudModules } from "../web/src/lib/constants.ts";

import { hydrateRollCallStatus, getRollCallDraftStats, emptyRollCallEntry } from "../Mobile/src/lib/attendanceTruth.ts";
import { formatFinanceDate as mobileFinanceDate } from "../Mobile/src/lib/financeCurrency.ts";
import { CRUD_PERMISSION_MODULES as mobileCrudModules } from "../Mobile/src/lib/constants.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("PARITY-001 défaut d'appel Web Présent === Mobile null (workflow cible unique)", () => {
  const webDefault = rollCallInitialStatus(undefined);
  const mobileDefault = hydrateRollCallStatus(undefined);
  assert.equal(
    webDefault,
    mobileDefault,
    `PARITY-001 : défaut Web=${String(webDefault)} Mobile=${String(mobileDefault)} — le workflow cible est Présent par défaut + changement de statut simple, identique Web/Mobile`,
  );
});

test("PARITY-001b KPI brouillon Mobile ne doit pas compter les non-saisis comme absents", () => {
  const roster = ["a", "b", "c", "d"];
  const attendance = {
    a: { ...emptyRollCallEntry(), status: "Présent" as const, source: "draft" as const },
  };
  const stats = getRollCallDraftStats(roster, attendance);
  assert.equal(
    stats.rate,
    null,
    `PARITY-001b : taux brouillon=${stats.rate} sur appel incomplet — attendu fail-closed (null / —) comme le KPI jour Web`,
  );
});

test("PARITY-080 dates finance = contrat JJ-MM-AAAA", () => {
  const expected = formatDateForDisplay("2026-09-17");
  assert.equal(expected, "17-09-2026");
  assert.equal(
    webFinanceDate("2026-09-17"),
    expected,
    `PARITY-080 Web finance date=${webFinanceDate("2026-09-17")} attendu ${expected}`,
  );
  assert.equal(
    mobileFinanceDate("2026-09-17"),
    expected,
    `PARITY-080 Mobile finance date=${mobileFinanceDate("2026-09-17")} attendu ${expected}`,
  );
});

test("PARITY-012 validation mot de passe login = politique backend 8+lettre+chiffre", () => {
  const webLogin = read("web/src/pages/LoginPage.tsx");
  const mobileLogin = read("Mobile/src/screens/LoginScreen.tsx");
  assert.equal(
    /newPassword:\s*z\.string\(\)\.min\(6/.test(webLogin),
    false,
    "PARITY-012 : LoginPage accepte encore min(6) alors que validatePasswordPolicy exige 8",
  );
  assert.equal(
    /nextPassword\.length < 6/.test(mobileLogin),
    false,
    "PARITY-012 : LoginScreen accepte encore length < 6 alors que le backend exige 8",
  );
});

test("PARITY-027 catalogues CRUD Web === Mobile (Frais, Impayés, Planning, Contacts, Relations, Droits)", () => {
  const required = ["Frais & tarifs", "Impayés", "Planning de cours", "Contacts", "Relations", "Droits par rôle"];
  for (const moduleName of required) {
    assert.ok(
      (webCrudModules as readonly string[]).includes(moduleName) &&
        (mobileCrudModules as readonly string[]).includes(moduleName),
      `PARITY-027 : module ${moduleName} Web=${(webCrudModules as readonly string[]).includes(moduleName)} Mobile=${(mobileCrudModules as readonly string[]).includes(moduleName)}`,
    );
  }
});

test("PARITY-011 must_change_password : ProtectedRoute Web doit bloquer le shell métier", () => {
  const guard = read("web/src/components/ProtectedRoute.tsx");
  assert.match(
    guard,
    /mustChangePassword/,
    "PARITY-011 : ProtectedRoute ne lit que isAuthenticated (token) — un utilisateur must_change_password peut atteindre le shell",
  );
});

test("PARITY-081 hint inscription Web = JJ-MM-AAAA", () => {
  const page = read("web/src/pages/etablissement/ClassStudentsPage.tsx");
  assert.equal(
    /Format AAAA-MM-JJ/.test(page),
    false,
    "PARITY-081 : hint date de naissance encore AAAA-MM-JJ",
  );
});

test("PARITY-021 écran Permissions Mobile enregistré OU explicitement hors produit", () => {
  const nav = read("Mobile/src/navigation/AppNavigator.tsx");
  const permissions = read("Mobile/src/domain/security/permissions.ts");
  const registered = /name=["']Permissions["']/.test(nav);
  const hardcodedDeny = /viewName === ["']Permissions["'][\s\S]{0,80}return false/.test(permissions);
  assert.equal(
    registered || !hardcodedDeny,
    true,
    "PARITY-021 : PermissionsScreen existe, canReadView(Permissions)=false, non monté — écran orphelin",
  );
});

test("PARITY-022 Accueil enseignant Mobile utilise le KPI jour fail-closed", () => {
  const home = read("Mobile/src/screens/HomeScreen.tsx");
  const usesPartialStats = /teacherPresenceStats = getPresenceStats\(/.test(home);
  const usesDeviceToday = /function isTodayPresence/.test(home);
  assert.equal(
    usesPartialStats || usesDeviceToday,
    false,
    "PARITY-022 : Accueil enseignant calcule encore un % sur lignes du jour (timezone appareil) au lieu de getTodayEstablishmentPresenceKpi",
  );
});
