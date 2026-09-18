/**
 * Contrats source LOT 0 — PARITY-001 / 001b / 011 / 012 / 022.
 *
 *   npx --yes tsx --test scripts/lot0-parity.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { rollCallInitialStatus } from "../web/src/lib/presenceMetrics.ts";
import {
  emptyRollCallEntry,
  getRollCallDraftStats,
  hydrateRollCallStatus,
} from "../Mobile/src/lib/attendanceTruth.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("PARITY-001 défaut d'appel Web Présent === Mobile Présent", () => {
  assert.equal(rollCallInitialStatus(undefined), "Présent");
  assert.equal(hydrateRollCallStatus(undefined), "Présent");
  assert.equal(hydrateRollCallStatus(null), "Présent");
  const unset = emptyRollCallEntry();
  assert.equal(unset.status, "Présent");
  assert.equal(unset.source, "unset");
});

test("PARITY-001b KPI brouillon incomplet fail-closed", () => {
  const roster = ["a", "b", "c", "d"];
  const attendance = {
    a: { ...emptyRollCallEntry(), status: "Présent" as const, source: "draft" as const },
  };
  const stats = getRollCallDraftStats(roster, attendance);
  assert.equal(stats.rate, null);
});

test("PARITY-011 ProtectedRoute lit mustChangePassword", () => {
  const guard = read("web/src/components/ProtectedRoute.tsx");
  assert.match(guard, /mustChangePassword/);
  assert.match(guard, /\/connexion/);
});

test("PARITY-012 validation login = politique backend", () => {
  const webLogin = read("web/src/pages/LoginPage.tsx");
  const mobileLogin = read("Mobile/src/screens/LoginScreen.tsx");
  assert.equal(/newPassword:\s*z\.string\(\)\.min\(6/.test(webLogin), false);
  assert.equal(/nextPassword\.length < 6/.test(mobileLogin), false);
  assert.match(webLogin, /validateAccountSecret/);
  assert.match(mobileLogin, /validateAccountSecret/);
});

test("PARITY-022 Accueil enseignant utilise le KPI jour fail-closed", () => {
  const home = read("Mobile/src/screens/HomeScreen.tsx");
  assert.equal(/teacherPresenceStats = getPresenceStats\(/.test(home), false);
  assert.equal(/function isTodayPresence/.test(home), false);
  assert.match(home, /getTodayEstablishmentPresenceKpi/);
  assert.match(home, /establishmentPresenceValue/);
});
