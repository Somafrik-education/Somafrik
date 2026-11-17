/**
 * AUDIT-SETUP-GUIDED-10-01 / A6 — écran natif Mobile « Règles de notification ».
 *
 *   npx --yes tsx --test Mobile/src/lib/schoolNotificationSettingsMobile.a6.test.ts
 *
 * L'étape 9 « Communication » exige au moins une règle enregistrée. Le Mobile doit permettre
 * de la satisfaire avec les mêmes droits et les mêmes appels que le Web
 * (`SettingsNotificationsPage` + `schoolNotificationSettingsApi`).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { canReadView } from "../domain/security/permissions";

const mobileSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB_PATH = path.join(mobileSrc, "lib/schoolNotificationSettingsMobile.ts");
const SCREEN_PATH = path.join(mobileSrc, "screens/SchoolNotificationSettingsScreen.tsx");
const VIEW = "SchoolNotificationSettings";

function read(file: string) {
  return fs.readFileSync(file, "utf8");
}

async function loadLib() {
  assert.ok(fs.existsSync(LIB_PATH), "Mobile/src/lib/schoolNotificationSettingsMobile.ts manquant");
  return import(pathToFileURL(LIB_PATH).href);
}

function session(roleLabel: string, permissions: string[], sessionRole?: string) {
  return attachCanonicalRoleIdentity({
    role: sessionRole,
    permissions,
    user: { id: "u-a6", name: "Compte test", schoolCode: "CD-IN-26-001", role: roleLabel, permissions },
  });
}

const settings = {
  schoolCode: "CD-IN-26-001",
  configured: false,
  events: {
    STUDENT_ABSENT: { allowedRecipients: ["PARENT", "SCHOOL_ADMIN"], PARENT: { IN_APP: true, PUSH: false, EMAIL: true } },
    GRADE_PUBLISHED: { allowedRecipients: ["STUDENT"] },
  },
};

test("A6-01 — droits : même règle que les autres écrans Paramètres établissement", () => {
  const admin = session("Admin School", ["Paramètres Établissement:READ", "Paramètres Établissement:UPDATE"]);
  const prefect = session("Préfet des études", ["Paramètres Établissement:READ"]);
  const parent = session("Parent", ["Paramètres Établissement:READ"], "parent");
  const country = session("Admin Pays", ["Paramètres Établissement:READ"], "country_admin");
  assert.equal(canReadView(admin, VIEW), true, "Admin School lit l'écran");
  assert.equal(canReadView(prefect, VIEW), false, "un rôle non opérateur Paramètres est refusé");
  assert.equal(canReadView(parent, VIEW), false, "parent refusé");
  assert.equal(canReadView(country, VIEW), false, "Admin Pays refusé (pas d'accès global aux données scolaires)");
  // Parité de lecture avec les écrans Paramètres existants.
  assert.equal(canReadView(admin, VIEW), canReadView(admin, "SchoolYearSettings"));
});

test("A6-02 — lignes affichées : destinataires autorisés uniquement, canal absent = activé (comme le Web)", async () => {
  const lib = await loadLib();
  const rows = lib.notificationRowsFromSettings(settings);
  assert.deepEqual(
    rows.map((row: { event: string; recipient: string }) => `${row.event}:${row.recipient}`),
    ["STUDENT_ABSENT:PARENT", "STUDENT_ABSENT:SCHOOL_ADMIN", "GRADE_PUBLISHED:STUDENT"],
  );
  assert.equal(lib.notificationChannelOf(settings.events.STUDENT_ABSENT, "PARENT", "PUSH"), false);
  assert.equal(lib.notificationChannelOf(settings.events.STUDENT_ABSENT, "SCHOOL_ADMIN", "PUSH"), true);
});

test("A6-03 — « Enregistrer ces règles » envoie toutes les règles affichées (même patch que le Web)", async () => {
  const lib = await loadLib();
  assert.deepEqual(lib.notificationPatchFromDisplayedRules(settings), {
    events: {
      STUDENT_ABSENT: {
        PARENT: { IN_APP: true, PUSH: false, EMAIL: true },
        SCHOOL_ADMIN: { IN_APP: true, PUSH: true, EMAIL: true },
      },
      GRADE_PUBLISHED: { STUDENT: { IN_APP: true, PUSH: true, EMAIL: true } },
    },
  });
});

test("A6-04 — un interrupteur n'envoie que la cellule modifiée", async () => {
  const lib = await loadLib();
  assert.deepEqual(lib.notificationTogglePatch(settings, "STUDENT_ABSENT", "PARENT", "PUSH"), {
    events: { STUDENT_ABSENT: { PARENT: { PUSH: true } } },
  });
});

test("A6-05 — client : même endpoint que le Web, établissement explicite", () => {
  const api = read(path.join(mobileSrc, "services/schoolSettingsApi.ts"));
  assert.match(api, /export function getSchoolNotificationSettings\(schoolCode: string\)/);
  assert.match(api, /export function patchSchoolNotificationSettings\(\s*schoolCode: string,/);
  assert.match(api, /\/backoffice\/establishments\/\$\{encodeURIComponent\(code\)\}\/notification-settings/);
  assert.match(api, /method: "PATCH"/);
});

test("A6-06 — écran natif : accès, écriture réservée à UPDATE, erreurs visibles, rechargement au focus", () => {
  assert.ok(fs.existsSync(SCREEN_PATH), "SchoolNotificationSettingsScreen.tsx manquant");
  const screen = read(SCREEN_PATH);
  assert.match(screen, /useSchoolSettingsAccess\("SchoolNotificationSettings"\)/);
  assert.match(screen, /<SchoolSettingsDenied/);
  assert.match(screen, /disabled=\{!canEdit/);
  assert.match(screen, /useFocusEffect/);
  assert.match(screen, /Règles par défaut non enregistrées/);
  assert.match(screen, /Enregistrer ces règles/);
  assert.match(screen, /testID="school-notification-settings-error"/);
  assert.match(screen, /setSettings\(previous\)/, "un refus rétablit l'interrupteur");
  assert.doesNotMatch(screen, /catch\s*\(\s*\)\s*\{\s*\}/, "aucune erreur avalée");
});

test("A6-07 — navigation : écran enregistré, atteint depuis l'étape 9, sans septième carte Paramètres (PARITY-019)", () => {
  const nav = read(path.join(mobileSrc, "navigation/AppNavigator.tsx"));
  assert.match(nav, /canReadView\(session, "SchoolNotificationSettings"\)/);
  assert.match(nav, /name="SchoolNotificationSettings" component=\{SchoolNotificationSettingsScreen\}/);
  const guided = read(path.join(mobileSrc, "lib/schoolSetupGuidedMobile.ts"));
  assert.match(guided, /communication: "SchoolNotificationSettings"/, "l'étape 9 ouvre l'écran natif");
  const wizard = read(path.join(mobileSrc, "components/schoolSetup/GuidedSchoolSetupWizard.tsx"));
  assert.match(wizard, /navigation\.navigate\(route\)/, "le lien de l'étape est bien navigué");
  // PARITY-019 : la configuration Mobile garde exactement ses six cartes opérationnelles.
  const config = read(path.join(mobileSrc, "screens/ConfigurationScreen.tsx"));
  const cards = [...config.matchAll(/route:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(cards.length, 6, "pas de septième carte");
  assert.ok(!cards.includes("SchoolNotificationSettings"), "accès Notifications hors des cartes Paramètres");
});
