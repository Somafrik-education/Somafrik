import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const host = read("help/HelpHost.tsx");
const sheet = read("help/HelpSheet.tsx");
const trigger = read("help/HelpTrigger.tsx");
const navigator = read("navigation/AppNavigator.tsx");
const support = read("screens/MvpUtilityScreens.tsx");

assert.match(navigator, /<HelpHost \/>/);
assert.match(navigator, /isMetierRenderable/);
assert.match(host, /buildMobileHelpContext/);
assert.match(host, /isHelpAvailable/);
assert.match(host, /isMobileHelpSessionReady/);
assert.match(read("help/buildMobileHelpContext.ts"), /isMetierRenderable/);
assert.doesNotMatch(
  host,
  /permissionsBootstrap === ["']ready["']/,
  "HelpHost must keep help on ready_offline, not only live ready",
);
assert.doesNotMatch(host, /accessToken|\bjwt\b|studentId/);
assert.doesNotMatch(host.replaceAll("mustChangePassword", ""), /password/i);
assert.match(trigger, /Besoin d’aide \?/);
assert.match(trigger, /Ouvrir l’aide/);
assert.match(sheet, /groupHelpArticlesByCategory/);
assert.match(sheet, /Je n’ai pas trouvé la réponse|assistance\/contact/);
assert.doesNotMatch(sheet, /Intercom|Crisp|Zendesk|\/api\/help/);
assert.doesNotMatch(sheet, /api\.(post|put|patch|delete)/);

assert.match(support, /Contactez l'administration de l'etablissement/);
assert.doesNotMatch(support, /help-catalog/);
assert.doesNotMatch(support, /HelpHost/);
