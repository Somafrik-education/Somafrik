/**
 * LOT 1 — PARITY-018 / 019 frontière Web-only.
 *   npx --yes tsx Mobile/src/lib/pariteLot1PlatformSettingsBoundary.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(srcRoot, rel), "utf8");
}

function run() {
  const config = read("screens/ConfigurationScreen.tsx");
  const cards = [...config.matchAll(/route:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    cards,
    [
      "EstablishmentProfile",
      "SchoolSetup",
      "SchoolYearSettings",
      "SchoolPedagogicalStructure",
      "SchoolAssignableRoles",
      "Users",
    ],
    "PARITY-019 : exactement 6 cartes opérationnelles, pas de hub Web recopié",
  );
  assert.doesNotMatch(config, /Pays|Établissements|Abonnements|Apparence|Intégrations|Sécurité/);
  assert.doesNotMatch(config, /AdminCrud|PlatformNotifications|Permissions/);
  assert.doesNotMatch(config, /alignée sur l.interface Web/);

  const login = read("screens/LoginScreen.tsx");
  const home = read("screens/HomeScreen.tsx");
  const navigator = read("navigation/AppNavigator.tsx");
  const live = `${login}\n${home}\n${navigator}\n${config}`;
  assert.doesNotMatch(live, /navigate\(\s*["']AdminCrud["']/);
  assert.doesNotMatch(live, /navigate\(\s*["']PlatformNotifications["']/);
  assert.doesNotMatch(live, /navigate\(\s*["']Permissions["']/);
  assert.doesNotMatch(navigator, /name=["']AdminCrud["']/);
  assert.doesNotMatch(navigator, /name=["']PlatformNotifications["']/);
  assert.doesNotMatch(navigator, /name=["']Permissions["']/);

  const docs = fs.readFileSync(
    path.join(srcRoot, "..", "..", "docs/audits/parite-web-mobile-lot1-referentiels-etablissement.md"),
    "utf8",
  );
  assert.match(docs, /PARITY-018/);
  assert.match(docs, /WEB-ONLY|Web-only/);
  assert.match(docs, /PARITY-019/);
  assert.match(docs, /PARITY-029/);
  assert.match(docs, /PARITY-037/);

  console.log("pariteLot1PlatformSettingsBoundary.test.ts OK");
}

run();
