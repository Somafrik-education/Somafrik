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
  const loadPolicy = between(source, "async function loadSchoolPolicyEvents", "async function resolveTargetPolicyInput");
  assert.doesNotMatch(
    loadPolicy,
    /catch\s*\{[\s\S]*getDefaultSchoolNotificationSettings\(\)\.events/,
    "une erreur DB/politique ne doit jamais réactiver silencieusement tous les canaux",
  );
});

test("I-P1-02 — centre IN_APP : erreurs préférences/politique = fail-closed", () => {
  const source = read("backend/lib/communicationsNotificationsService.js");
  const userVisibility = between(source, "async function isInAppVisible", "function rowAllowsInApp");
  const schoolVisibility = between(source, "async function allowsInAppForRow", "async function fetchRecipientPage");
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

test("I-P1-04 — panne de lecture des préférences personnelles = fail-closed pour PUSH/EMAIL", () => {
  const dispatcher = read("backend/lib/communicationsDispatcher.js");
  const loadEnabled = between(dispatcher, "async function loadEnabledChannels", "async function schoolPolicyForTarget");
  assert.match(
    loadEnabled,
    /if\s*\(isMissingPrefsTable\(error\)\)\s*return defaultEnabledChannels\(\)/,
    "seule l'absence de table de préférences peut conserver le défaut historique",
  );
  assert.match(
    loadEnabled,
    /COMMUNICATION_PREFS_UNAVAILABLE/,
    "une autre erreur de lecture doit être marquée fail-closed",
  );

  const fanout = read("backend/lib/communicationChannelFanout.js");
  const catchBlock = between(fanout, "} catch (error) {", "logger.error?.(\"[communications-c4] preference lookup failed");
  assert.match(
    catchBlock,
    /communication_preferences_unavailable/,
    "le fan-out doit propager l'indisponibilité des préférences au lieu de réactiver les canaux",
  );
});
