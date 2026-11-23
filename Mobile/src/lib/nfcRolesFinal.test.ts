/**
 * NFC-ROLES-FINAL-01 — Mobile : parcours unique d'appel NFC/QR local-first pour tous les rôles
 * autorisés, trois actions de carte seulement, aucun ancien bouton d'appel collectif.
 *   npx --yes tsx --test Mobile/src/lib/nfcRolesFinal.test.ts
 *
 * Ces décisions d'interface ne font qu'éviter de proposer un parcours refusé : l'autorisation
 * réelle (classe, rôle, droits) est vérifiée par le serveur (backend/lib/rollCallRoles.http.pg.test.js).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROLL_CALL_PERMISSION, rollCallActor } from "./studentCardRollCallRoles";
import { resolveRollCallLauncher } from "./rollCallLauncher";
import { SYNC_COPY } from "../offline/rollCall/sync/syncStatus";
import { OFFLINE_ROLL_CALL_COPY } from "../offline/rollCall/session/offlineRollCall";

const WRITE = ["Présences:READ", "Présences:CREATE", "Présences:UPDATE"];
// NFC-ROLES-ACCESS-01 : droit dédié, indépendant des présences et de la consultation des classes.
const ROLL = ["Présences — Effectuer l'appel (NFC/QR):CREATE"];
const session = (roleKeys: string[], permissions: string[], role = "") => ({ user: { role, roleKeys, permissions }, permissions });

test("matrice : « Démarrer l'appel NFC/QR » = droit dédié + rôle scolaire (clés canoniques)", () => {
  const cases: Array<[string, string[], string[], boolean, string]> = [
    ["Enseignant avec le droit", ["TEACHER"], ROLL, true, ""],
    ["Directeur avec le droit, sans Classes ni Élèves", ["SCHOOL_ADMIN"], ROLL, true, "Directeur"],
    ["Secrétaire avec le droit", ["SECRETARY"], ROLL, true, "Secrétaire"],
    ["Préfet des études avec le droit", ["PREFET_ETUDES"], ROLL, true, ""],
    ["Proviseur avec le droit", ["PROVISEUR"], ROLL, true, ""],
    ["Principal avec le droit", ["PRINCIPAL"], ROLL, true, ""],
    ["Surveillant explicitement autorisé", ["SUPERVISOR"], ROLL, true, ""],
    ["Enseignant + Directeur", ["TEACHER", "SCHOOL_ADMIN"], ROLL, true, "Professeur"],
    ["Enseignant avec Présences mais sans le droit", ["TEACHER"], WRITE, false, ""],
    ["Directeur avec Présences mais sans le droit", ["SCHOOL_ADMIN"], WRITE, false, ""],
    ["Secrétaire avec Présences mais sans le droit", ["SECRETARY"], WRITE, false, ""],
    ["Parent avec le droit", ["PARENT"], ROLL, false, ""],
    ["Élève avec le droit", ["STUDENT"], ROLL, false, ""],
    ["Superadmin avec le droit", ["SUPER_ADMIN"], ROLL, false, ""],
    ["Secrétaire + plateforme", ["SECRETARY", "COUNTRY_ADMIN"], ROLL, false, ""],
    ["Clé inconnue libellée « Directeur »", ["CUSTOM_DIRECTOR"], ROLL, false, "Directeur"],
  ];
  for (const [label, keys, permissions, expected, roleLabel] of cases) {
    assert.equal(rollCallActor(session(keys, permissions, roleLabel)).rollCall, expected, label);
  }
  assert.equal(ROLL_CALL_PERMISSION, ROLL[0], "même jeton que le serveur");
});

test("écran Présences : trois actions de carte, aucun ancien bouton d'appel collectif", () => {
  const screen = readFileSync(path.join(__dirname, "../screens/TeacherAttendanceScreen.tsx"), "utf8");
  // NFC-ROLES-ACCESS-01 : bloc commun aux DEUX vues (liste des classes et classe ouverte).
  assert.equal((screen.match(/\{cardActions\}/g) ?? []).length, 2, "actions visibles sans classe ouverte");
  assert.equal((screen.match(/\{rollCallModals\}/g) ?? []).length, 2, "fenêtres disponibles sans classe ouverte");
  // 1. Vérifier une carte (contrôle individuel, sans écriture de présence), selon SA permission.
  assert.match(screen, /testID="attendance-card-verify"/);
  assert.match(screen, /launcher\.canVerifyCard \?/);
  // 2. Démarrer l'appel NFC/QR — sélecteur de classe autorisée, puis moteur local-first.
  // APPEL-NAV-01 : sans classe ouverte → sélecteur ; classe ouverte → appel direct (voir rollCallOpenClass.test.ts).
  assert.match(screen, /rollCallButton\("attendance-offline-roll-call", OFFLINE_ROLL_CALL_COPY\.start, startOfflineRollCall\)/);
  assert.match(screen, /<RollCallClassPickerModal/);
  assert.match(screen, /setRollCallTarget\(\{ \.\.\.target, date: isoAttendanceDate\(\) \}\)/);
  assert.doesNotMatch(screen, /canOpenOfflineRollCall|offlineRollCallOpen/, "plus aucune dépendance à une classe ouverte");
  // 3. Vérifier les appels (Appels hors connexion) — appels locaux du compte.
  assert.match(screen, /rollCallButton\("attendance-offline-sync-list", SYNC_COPY\.checkCalls/);
  assert.match(screen, /SYNC_COPY\.localScope/, "appels locaux du compte, distincts de la supervision");
  // Anciens boutons retirés.
  for (const legacy of [
    /USABILITY_TEST_IDS\.attendanceScanNfc/,
    /USABILITY_TEST_IDS\.attendanceScanQr/,
    /attendance-class-roll-call/,
    /attendance-roll-call-direction-nfc/,
    /attendance-roll-call-direction-qr/,
    /attendance-roll-call-direction-resume/,
    /setNfcScannerOpen\(true\)/,
    /openRollCall\("(nfc|qr)", "direction"\)/,
    /rollCallButton\([^)]*openClassRollCall/,
  ]) assert.doesNotMatch(screen, legacy, String(legacy));
  // Les anciennes fenêtres restent montées pour d'autres contrôles mais aucun bouton ne les ouvre :
  // le seul `setScannerOpen(true)` restant est le repli QR interne à l'ancienne fenêtre NFC, fermée.
  assert.equal((screen.match(/setScannerOpen\(true\)/g) ?? []).length, 1);
  assert.match(screen, /onFallbackQr=\{\(\) => \{\s*\n\s*setNfcScannerOpen\(false\);/);
  // Plus aucun réservé « enseignant » sur le parcours unique.
  assert.doesNotMatch(screen, /actor\.teacher\s*\n?\s*&& canUpdatePresences/);
});

test("lanceur : trois actions sans classe, chacune selon sa permission et les supports", () => {
  const settings = { studentCardEnabled: true, studentCardQrEnabled: true, studentCardNfcEnabled: true, studentCardAttendanceEnabled: true, studentCardOfflineRollCallEnabled: true };
  const launch = (keys: string[], permissions: string[], platformOs = "android", s: Record<string, boolean> = settings) => {
    const sess = session(keys, permissions);
    return resolveRollCallLauncher({ session: sess, actor: rollCallActor(sess), settings: s as never, platformOs });
  };
  // Directeur : droit d'appel seul → appel et liste ; pas de vérification (ni Élèves:READ, ni Présences).
  assert.deepEqual(launch(["SCHOOL_ADMIN"], ROLL), { nfcAvailable: true, qrAvailable: true, canVerifyCard: false, canStartRollCall: true, canCheckCalls: true });
  // Enseignant : droit d'appel + présences → les trois actions.
  const teacher = launch(["TEACHER"], [...ROLL, ...WRITE]);
  assert.deepEqual([teacher.canVerifyCard, teacher.canStartRollCall, teacher.canCheckCalls], [true, true, true]);
  // Présences sans droit d'appel : vérification seule.
  const noRoll = launch(["SECRETARY"], WRITE);
  assert.deepEqual([noRoll.canVerifyCard, noRoll.canStartRollCall, noRoll.canCheckCalls], [true, false, false]);
  // Appel hors connexion désactivé pour l'établissement : pas de démarrage.
  assert.equal(launch(["SCHOOL_ADMIN"], ROLL, "android", { ...settings, studentCardOfflineRollCallEnabled: false }).canStartRollCall, false);
  // iOS : QR seulement ; Web : rien.
  assert.deepEqual([launch(["SCHOOL_ADMIN"], ROLL, "ios").nfcAvailable, launch(["SCHOOL_ADMIN"], ROLL, "ios").canStartRollCall], [false, true]);
  assert.equal(launch(["SCHOOL_ADMIN"], ROLL, "web").canStartRollCall, false);
  // Parent avec le jeton : jamais.
  assert.equal(launch(["PARENT"], ROLL).canStartRollCall, false);
});

test("libellés définitifs : pas de « hors connexion » sur le bouton d'appel", () => {
  assert.equal(OFFLINE_ROLL_CALL_COPY.start, "Démarrer l'appel NFC/QR");
  assert.doesNotMatch(OFFLINE_ROLL_CALL_COPY.start, /hors connexion/i);
  assert.equal(OFFLINE_ROLL_CALL_COPY.title, "Appel NFC/QR");
  assert.equal(SYNC_COPY.checkCalls, "Vérifier les appels (Appels hors connexion)");
});
