/**
 * CARTE-PR3-M1 — parcours de navigation du contrôle d'entrée : un surveillant qui n'a QUE la
 * permission Contrôle d'entrée doit pouvoir l'ouvrir, sans recevoir aucun droit Présences.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { getAllowedRoleDrawerItems } from "../navigation/roleDrawerPreferences";
import { canReadRoute } from "../domain/security/permissions";

const ENTRY = "Contrôle d'entrée:CREATE";

function session(role: string, roleKey: string, permissions: string[]) {
  return {
    role,
    roleKeys: [roleKey],
    permissions,
    school: { code: "CD-TEST" },
    user: { id: "u1", role, roleKeys: [roleKey], permissions, schoolCode: "CD-TEST" },
  };
}

const routes = (value: unknown) => getAllowedRoleDrawerItems(value).map((item) => item.route);

test("surveillant avec la seule permission Contrôle d'entrée : entrée de menu dédiée, aucun droit Présences", () => {
  const supervisor = session("supervisor", "SUPERVISOR", [ENTRY]);
  assert.ok(routes(supervisor).includes("EntryControl"), "le menu propose Contrôle d'entrée");
  assert.equal(canReadRoute(supervisor, "TeacherAttendance"), false, "Présences reste fermé");
  assert.ok(!routes(supervisor).includes("TeacherAttendance"));
});

test("menu Contrôle d'entrée : jamais sans la permission, jamais pour un rôle non admissible", () => {
  assert.ok(!routes(session("supervisor", "SUPERVISOR", ["Présences:READ", "Contrôle d'entrée:READ"])).includes("EntryControl"));
  assert.ok(!routes(session("teacher", "TEACHER", [ENTRY, "Présences:READ"])).includes("EntryControl"));
  assert.ok(!routes(session("accountant", "ACCOUNTANT", [ENTRY])).includes("EntryControl"));
  assert.ok(!routes(session("super_admin", "SUPER_ADMIN", [ENTRY, "ALL_PRIVILEGES"])).includes("EntryControl"));
  assert.ok(!routes(session("country_admin", "COUNTRY_ADMIN", [ENTRY])).includes("EntryControl"));
  for (const [role, key] of [["secretary", "SECRETARY"], ["principal", "PRINCIPAL"], ["proviseur", "PROVISEUR"], ["prefet", "PREFET_ETUDES"], ["school_admin", "SCHOOL_ADMIN"]]) {
    assert.ok(routes(session(role, key, [ENTRY])).includes("EntryControl"), key);
  }
});

test("navigateur : écran EntryControl enregistré seulement pour un acteur du contrôle d'entrée", () => {
  const navigator = readFileSync(new URL("../navigation/AppNavigator.tsx", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../screens/StudentCardEntryControlScreen.tsx", import.meta.url), "utf8");
  assert.match(navigator, /entryControlActor\(session\) && <Stack\.Screen name="EntryControl" component=\{StudentCardEntryControlScreen\}/);
  // Écran autonome : aucune lecture de présences, d'élèves ni des capacités de pointage.
  assert.doesNotMatch(screen, /getStudentCardCapabilities|loadPresences|\/presences|submitProtectedMutation/);
  assert.match(screen, /StudentCardEntryControlModal/);
  assert.match(screen, /entryControlActor\(session\)/);
});
