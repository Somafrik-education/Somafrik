"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `début introuvable: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `fin introuvable: ${end}`);
  return source.slice(from, to);
}

test("I-P1-01 — dispatcher : erreur de politique établissement = fail-closed, jamais défaut tout autorisé", () => {
  const source = read("backend/lib/communicationsDispatcher.js");
  const loadPolicy = between(source, "async function loadSchoolPolicyEvents", "async function loadEnabledChannels");
  assert.doesNotMatch(
    loadPolicy,
    /catch\s*\{[\s\S]*getDefaultSchoolNotificationSettings\(\)\.events/,
    "une erreur DB/politique ne doit jamais réactiver silencieusement tous les canaux",
  );
});

test("I-P1-02 — centre IN_APP : erreurs préférences/politique = fail-closed", () => {
  const source = read("backend/lib/communicationsNotificationsService.js");
  const userVisibility = between(source, "async function isInAppVisible", "async function allowsInAppForRow");
  const schoolVisibility = between(source, "async function allowsInAppForRow", "async function list(");
  assert.match(userVisibility, /catch\s*\{\s*return false;\s*\}/, "préférences indisponibles : IN_APP doit être refusé");
  assert.match(schoolVisibility, /catch\s*\{\s*return false;\s*\}/, "politique établissement indisponible : IN_APP doit être refusé");
});

test("I-P1-03 — markRead ne retourne pas une notification masquée par la politique IN_APP", () => {
  const source = read("backend/lib/communicationsNotificationsService.js");
  const markRead = between(source, "async function markRead", "async function archive");
  assert.match(
    markRead,
    /allowsInAppForRow/,
    "markRead doit réappliquer la politique IN_APP avant de retourner le contenu de la notification",
  );
});
