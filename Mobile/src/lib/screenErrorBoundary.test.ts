/**
 * npx tsx Mobile/src/lib/screenErrorBoundary.test.ts — PARITE-WEB-MOBILE-RECOVERY-01 / LOT 1 + LOT 7.
 * Une erreur de rendu d'écran est journalisée et affichée explicitement, jamais un écran blanc.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SCREEN_ERROR_COPY, describeScreenError, sanitizeErrorMessage } from "./screenErrorPresentation";

// 1. Message utile mais sans donnée personnelle, longueur bornée.
assert.equal(
  sanitizeErrorMessage("Cannot read property 'name' of undefined"),
  "Cannot read property 'name' of undefined",
);
assert.equal(sanitizeErrorMessage("échec pour parent@exemple.cd au +243 820 000 001"), "échec pour [e-mail] au [numéro]");
assert.equal(sanitizeErrorMessage("ligne 1\nstack interne"), "ligne 1");
assert.equal(sanitizeErrorMessage(""), "Erreur inconnue");
assert.ok(sanitizeErrorMessage("x".repeat(500)).length <= 160);
assert.deepEqual(describeScreenError(new TypeError("undefined is not a function"), "StudentNotes"), {
  kind: "TypeError",
  message: "undefined is not a function",
  route: "StudentNotes",
});
assert.equal(describeScreenError("brut", null).route, "inconnu");
assert.ok(SCREEN_ERROR_COPY.title && SCREEN_ERROR_COPY.retry && SCREEN_ERROR_COPY.back);

// 2. La frontière journalise (logcat ReactNativeJS E) et n'avale rien.
const SRC = path.join(__dirname, "..");
const boundary = fs.readFileSync(path.join(SRC, "components", "ScreenErrorBoundary.tsx"), "utf8");
assert.match(boundary, /static getDerivedStateFromError/);
assert.match(boundary, /componentDidCatch\(/);
assert.match(boundary, /console\.error\(\s*`SCREEN_RENDER_ERROR/);
assert.match(boundary, /testID="screen-render-error"/);

// 3. Tous les écrans de la pile racine et tous les onglets sont couverts.
const stack = fs.readFileSync(path.join(SRC, "navigation", "AppNavigator.tsx"), "utf8");
assert.match(stack, /<Stack\.Navigator[\s\S]{0,400}screenLayout=\{\(\{ children, route, navigation \}\) => \(\s*<ScreenErrorBoundary/);
const tabs = fs.readFileSync(path.join(SRC, "navigation", "BottomTabsNavigator.tsx"), "utf8");
assert.match(tabs, /<Tab\.Navigator[\s\S]{0,300}screenLayout=\{\(\{ children, route \}\) => \(\s*<ScreenErrorBoundary/);

console.log("OK screenErrorBoundary: erreur de rendu journalisée et affichée, pile et onglets couverts");
