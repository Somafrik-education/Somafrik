/**
 * Contrat auth plateforme Mobile : pas d'école fictive PLATFORM / PLATFORM-CD.
 *   npx tsx Mobile/src/lib/platformLogin.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildMobileLoginPayload,
  buildPlatformLoginParams,
  isPlatformMobileRole,
} from "./platformLogin";

assert.equal(isPlatformMobileRole("super_admin"), true);
assert.equal(isPlatformMobileRole("country_admin"), true);
assert.equal(isPlatformMobileRole("school_admin"), false);

const superadmin = buildPlatformLoginParams("global");
assert.deepEqual(superadmin.platformContext, { kind: "global" });
assert.equal(superadmin.accessRole, "super_admin");
assert.equal(superadmin.accessIdentifier, "superadmin");
assert.equal("school" in superadmin, false);

const countryAdmin = buildPlatformLoginParams("country", "CD");
assert.deepEqual(countryAdmin.platformContext, { kind: "country", countryCode: "CD" });
assert.equal(countryAdmin.accessRole, "country_admin");
assert.equal(countryAdmin.accessIdentifier, "admin-rdc");
assert.equal("school" in countryAdmin, false);

const platformPayload = buildMobileLoginPayload({
  role: "super_admin",
  identifier: "superadmin",
  pin: "1234",
  platformContext: { kind: "global" },
  schoolCode: "PLATFORM",
});
assert.equal("schoolCode" in platformPayload, false);
assert.equal(platformPayload.role, "super_admin");

const schoolPayload = buildMobileLoginPayload({
  role: "school_admin",
  identifier: "admin",
  pin: "1234",
  schoolCode: "CD-IN-26-001",
});
assert.equal(schoolPayload.schoolCode, "CD-IN-26-001");

const ROOT = path.join(__dirname, "..", "..", "..");
const roleSelection = fs.readFileSync(
  path.join(ROOT, "Mobile/src/screens/RoleSelectionScreen.tsx"),
  "utf8",
);
const loginScreen = fs.readFileSync(
  path.join(ROOT, "Mobile/src/screens/LoginScreen.tsx"),
  "utf8",
);
assert.match(roleSelection, /buildPlatformLoginParams\("global"\)/);
assert.match(roleSelection, /buildPlatformLoginParams\("country"/);
assert.doesNotMatch(roleSelection, /getPlatformSchool/);
assert.doesNotMatch(roleSelection, /code:\s*isGlobal\s*\?\s*"PLATFORM"/);
assert.doesNotMatch(roleSelection, /PLATFORM-\$\{scope\}/);
assert.match(loginScreen, /buildMobileLoginPayload/);
assert.doesNotMatch(loginScreen, /await login\(\{\s*role: identity\.role,\s*schoolCode: school\.code/);

console.log("OK platformLogin: Superadmin/Admin Pays sans école fictive ; établissement garde schoolCode");
