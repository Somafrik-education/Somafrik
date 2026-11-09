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
import { rollCallActor } from "./studentCardRollCallRoles";
import { SYNC_COPY } from "../offline/rollCall/sync/syncStatus";
import { OFFLINE_ROLL_CALL_COPY } from "../offline/rollCall/session/offlineRollCall";

const WRITE = ["Présences:READ", "Présences:CREATE", "Présences:UPDATE"];
const READ_ONLY = ["Présences:READ"];
const session = (roleKeys: string[], permissions: string[], role = "") => ({ user: { role, roleKeys, permissions }, permissions });

test("matrice : qui voit « Démarrer l'appel NFC/QR » (clés canoniques + permission d'écriture)", () => {
  const cases: Array<[string, string[], string[], boolean, string]> = [
    ["Enseignant", ["TEACHER"], WRITE, true, ""],
    ["Directeur / Admin School", ["SCHOOL_ADMIN"], WRITE, true, "Directeur"],
    ["Secrétaire", ["SECRETARY"], WRITE, true, "Secrétaire"],
    ["Préfet des études", ["PREFET_ETUDES"], WRITE, true, ""],
    ["Proviseur", ["PROVISEUR"], WRITE, true, ""],
    ["Principal", ["PRINCIPAL"], WRITE, true, ""],
    ["Enseignant + Directeur", ["TEACHER", "SCHOOL_ADMIN"], WRITE, true, "Professeur"],
    ["Enseignant + Secrétaire", ["TEACHER", "SECRETARY"], WRITE, true, ""],
    ["Secrétaire sans droit d'écriture", ["SECRETARY"], READ_ONLY, false, ""],
    ["Directeur sans droit d'écriture", ["SCHOOL_ADMIN"], READ_ONLY, false, ""],
    ["Surveillant (autre rôle)", ["SUPERVISOR"], WRITE, false, ""],
    ["Comptable (autre rôle)", ["ACCOUNTANT"], WRITE, false, ""],
    ["Parent", ["PARENT"], WRITE, false, ""],
    ["Élève", ["STUDENT"], WRITE, false, ""],
    ["Superadmin", ["SUPER_ADMIN"], WRITE, false, ""],
    ["Secrétaire + plateforme", ["SECRETARY", "COUNTRY_ADMIN"], WRITE, false, ""],
    ["Clé inconnue libellée « Directeur »", ["CUSTOM_DIRECTOR"], WRITE, false, "Directeur"],
  ];
  for (const [label, keys, permissions, expected, roleLabel] of cases) {
    assert.equal(rollCallActor(session(keys, permissions, roleLabel)).rollCall, expected, label);
  }
  // Un libellé personnalisé ne change rien : seules les clés comptent.
  assert.equal(rollCallActor(session(["SUPERVISOR"], WRITE, "Directeur")).rollCall, false);
  assert.equal(rollCallActor(session(["SECRETARY"], WRITE, "Professeur")).rollCall, true);
});

test("écran Présences : trois actions de carte, aucun ancien bouton d'appel collectif", () => {
  const screen = readFileSync(path.join(__dirname, "../screens/TeacherAttendanceScreen.tsx"), "utf8");
  // 1. Vérifier une carte (contrôle individuel, sans écriture de présence).
  assert.match(screen, /testID="attendance-card-verify"/);
  assert.match(screen, /actor\.verify && \(nfcControl === "ready" \|\| canOpenQrScanner\)/);
  // 2. Démarrer l'appel NFC/QR — moteur local-first, pour tout rôle autorisé.
  assert.match(screen, /rollCallButton\("attendance-offline-roll-call", OFFLINE_ROLL_CALL_COPY\.start/);
  assert.match(screen, /const canOpenOfflineRollCall = Boolean\(\s*\n\s*actor\.rollCall/);
  // 3. Vérifier les appels (Appels hors connexion) — appels locaux du compte.
  assert.match(screen, /rollCallButton\("attendance-offline-sync-list", SYNC_COPY\.checkCalls/);
  assert.match(screen, /const canOpenOfflineSyncList = Boolean\(\s*\n\s*actor\.rollCall/);
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

test("libellés définitifs : pas de « hors connexion » sur le bouton d'appel", () => {
  assert.equal(OFFLINE_ROLL_CALL_COPY.start, "Démarrer l'appel NFC/QR");
  assert.doesNotMatch(OFFLINE_ROLL_CALL_COPY.start, /hors connexion/i);
  assert.equal(OFFLINE_ROLL_CALL_COPY.title, "Appel NFC/QR");
  assert.equal(SYNC_COPY.checkCalls, "Vérifier les appels (Appels hors connexion)");
});
