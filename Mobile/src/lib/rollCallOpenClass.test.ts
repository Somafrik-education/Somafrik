/**
 * APPEL-NAV-01 — Présences locales (appel NFC/QR) : une seule sélection de classe.
 *   npx --yes tsx --test Mobile/src/lib/rollCallOpenClass.test.ts
 *
 * Parcours attendu (Directeur, Secrétaire, Enseignant) : Présences → classe → « Démarrer l'appel
 * NFC/QR » ouvre directement l'appel de CETTE classe, sans repasser par le sélecteur, à condition
 * que la classe figure dans la liste serveur du compte (même périmètre que le sélecteur).
 * Sans classe ouverte, le sélecteur reste la seule sélection. Aucun nouveau moteur d'appel :
 * la cible est passée à l'OfflineRollCallModal existant, qui reprend le brouillon SQLCipher.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { findAuthorizedRollCallClass } from "./rollCallOpenClass";

const screen = readFileSync(path.join(__dirname, "../screens/TeacherAttendanceScreen.tsx"), "utf8");
const picker = readFileSync(path.join(__dirname, "../components/RollCallClassPickerModal.tsx"), "utf8");

// Listes renvoyées par GET …/roll-call/offline/v1/classes selon l'autorité du compte.
const SCHOOL_A = [
  { classId: "C-6A", classCode: "6A", className: "6e A", enrolled: 30 },
  { classId: "C-6B", classCode: "6B", className: "6e B", enrolled: 28 },
  { classId: "C-5A", classCode: "5A", className: "5e A", enrolled: 31 },
];
const TEACHER_A = [SCHOOL_A[0]];

test("Directeur (périmètre établissement) : la classe ouverte est la cible, sans seconde sélection", () => {
  assert.deepEqual(findAuthorizedRollCallClass(SCHOOL_A, "C-6B"), { classId: "C-6B", className: "6e B" });
  // Casse et espaces de l'identifiant local sans effet ; identifiant et libellé du serveur conservés.
  assert.deepEqual(findAuthorizedRollCallClass(SCHOOL_A, " c-5a "), { classId: "C-5A", className: "5e A" });
});

test("Secrétaire (périmètre établissement) : même résultat, aucune autre classe retenue", () => {
  assert.deepEqual(findAuthorizedRollCallClass(SCHOOL_A, "C-6A"), { classId: "C-6A", className: "6e A" });
  assert.equal(findAuthorizedRollCallClass(SCHOOL_A, "C-6"), null, "pas de correspondance partielle");
});

test("Enseignant (classes affectées) : classe affectée → appel direct ; autre classe → sélecteur", () => {
  assert.deepEqual(findAuthorizedRollCallClass(TEACHER_A, "C-6A"), { classId: "C-6A", className: "6e A" });
  assert.equal(findAuthorizedRollCallClass(TEACHER_A, "C-6B"), null);
});

test("isolation : classe d'un autre établissement, liste vide ou identifiant absent → jamais d'appel direct", () => {
  assert.equal(findAuthorizedRollCallClass(SCHOOL_A, "C-OTHER-SCHOOL"), null);
  assert.equal(findAuthorizedRollCallClass([], "C-6A"), null);
  for (const missing of ["", "   ", null, undefined]) assert.equal(findAuthorizedRollCallClass(SCHOOL_A, missing), null);
});

test("écran : sélecteur sans classe ouverte, appel direct depuis une classe ouverte, repli sélecteur", () => {
  const start = screen.slice(screen.indexOf("const startOfflineRollCall = () => {"));
  const body = start.slice(0, start.indexOf("\n  };\n"));
  assert.ok(body.length > 0, "startOfflineRollCall présent");
  // 1. Sans classe ouverte : sélecteur, comme avant.
  assert.match(body, /if \(!openedClassId\) \{\s*setRollCallPickerOpen\(true\);\s*return;/);
  // 2. Classe ouverte : même liste (et même repli hors connexion) que le sélecteur.
  assert.match(body, /loadRollCallClasses\(rollCallPickerScope\)/);
  assert.match(body, /findAuthorizedRollCallClass\(classes, openedClassId\)/);
  // 3. Hors liste ou liste indisponible : sélecteur. Changement de classe pendant la lecture : rien.
  assert.match(body, /if \(target\) openRollCallTarget\(target\);\s*else setRollCallPickerOpen\(true\);/);
  assert.match(body, /if \(selectedClassIdRef\.current !== openedClassId\) return;/);
  // Pas de second appel : déclenchement unique, rien si un appel est déjà affiché.
  assert.match(body, /if \(rollCallOpeningRef\.current \|\| rollCallTarget\) return;/);
  // Sélecteur et appel direct ouvrent la MÊME fenêtre, avec la même cible (classe + date du jour).
  assert.match(screen, /onSelect=\{\(target\) => \{\s*setRollCallPickerOpen\(false\);\s*openRollCallTarget\(target\);/);
  assert.equal((screen.match(/setRollCallTarget\(\{/g) ?? []).length, 1, "un seul point d'ouverture de l'appel");
  // Aucun nouveau moteur : pas de démarrage de session ici (le brouillon SQLCipher est repris par la fenêtre).
  assert.doesNotMatch(body, /startRollCallSession|startClassRollCallContext|openOfflineRollCall/);
});

test("sélecteur : liste partagée, cache par compte et établissement inchangé", () => {
  assert.match(picker, /export async function loadRollCallClasses\(scopeKey: string\)/);
  assert.match(picker, /lastLists\.set\(scopeKey, result\.classes\)/);
  assert.match(picker, /const cached = scopeKey \? lastLists\.get\(scopeKey\) : undefined;/);
  assert.match(picker, /void loadRollCallClasses\(scopeKey\)/);
});

test("présences manuelles et NFC inchangées : enregistrement manuel et actions de carte intacts", () => {
  assert.match(screen, /onPress=\{\(\) => saveCall\(selectedClass\)\}/);
  assert.match(screen, /onPress=\{\(\) => markClassPresent\(selectedClass\)\}/);
  assert.equal((screen.match(/\{cardActions\}/g) ?? []).length, 2);
  assert.match(screen, /<OfflineRollCallModal\s+visible\s+session=\{session\}\s+classId=\{rollCallTarget\.classId\}/);
});
