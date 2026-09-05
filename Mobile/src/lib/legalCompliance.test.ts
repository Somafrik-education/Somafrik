/**
 * P0 Play #482 — garde-fou liens légaux du drawer réellement monté.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ACCOUNT_DELETION_URL,
  isAllowedProductionLegalUrl,
  LEGAL_COPY,
  PRIVACY_POLICY_URL,
  SOMAFRIK_LEGAL_ORIGIN,
} from "./legalCompliance";

const ROOT = path.join(__dirname, "..", "..", "..");
const drawer = fs.readFileSync(
  path.join(ROOT, "Mobile/src/components/RoleNavigationDrawer.tsx"),
  "utf8",
);

assert.equal(SOMAFRIK_LEGAL_ORIGIN, "https://somafrik.app");
assert.equal(PRIVACY_POLICY_URL, "https://somafrik.app/confidentialite");
assert.equal(ACCOUNT_DELETION_URL, "https://somafrik.app/suppression-compte");
assert.match(LEGAL_COPY.privacy, /confidentialité/i);
assert.match(LEGAL_COPY.deletion, /suppression/i);
assert.notEqual(PRIVACY_POLICY_URL, ACCOUNT_DELETION_URL);

assert.equal(isAllowedProductionLegalUrl(PRIVACY_POLICY_URL), true);
assert.equal(isAllowedProductionLegalUrl(ACCOUNT_DELETION_URL), true);
assert.equal(isAllowedProductionLegalUrl("http://somafrik.app/confidentialite"), false);
assert.equal(isAllowedProductionLegalUrl("https://preprod.somafrik.app/confidentialite"), false);
assert.equal(isAllowedProductionLegalUrl("https://somafrik.app/autre"), false);

assert.match(drawer, /mobile-role-drawer-privacy/);
assert.match(drawer, /mobile-role-drawer-account-deletion/);
assert.match(drawer, /PRIVACY_POLICY_URL/);
assert.match(drawer, /ACCOUNT_DELETION_URL/);
assert.match(drawer, /isAllowedProductionLegalUrl/);
assert.match(drawer, /Linking\.openURL/);
assert.match(drawer, /accessibilityRole="link"/);
assert.doesNotMatch(drawer, /api-preprod|preprod\.somafrik|localhost/);

const welcome = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/WelcomeScreen.tsx"), "utf8");
assert.match(welcome, /welcome-privacy-policy/);
assert.match(welcome, /welcome-account-deletion/);
assert.match(welcome, /ACCOUNT_DELETION_URL/);
assert.match(welcome, /PRIVACY_POLICY_URL/);

console.log("OK legalCompliance #482: drawer réel + URLs prod HTTPS + fail-closed");
