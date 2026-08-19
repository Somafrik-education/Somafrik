"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  ANDROID_PACKAGE,
  ANDROID_VERSION_CODE,
  APP_VERSION,
  CANONICAL_API_URLS,
  DISPLAY_NAMES,
  RELEASE_PROFILES,
  artifactForProfile,
  assertReleaseApiUrl,
  distributionForProfile,
  profileAllowsCleartext,
  resolveApiUrlForProfile,
  resolveReleaseProfile,
} = require("./releaseEnvironments");

assert.deepStrictEqual(RELEASE_PROFILES, ["development", "preview", "preproduction", "production"]);
assert.equal(CANONICAL_API_URLS.preproduction, "https://somafrik-api-preprod.onrender.com");
assert.equal(CANONICAL_API_URLS.preview, CANONICAL_API_URLS.preproduction);
assert.equal(CANONICAL_API_URLS.production, "https://api.somafrik.app");
assert.notEqual(CANONICAL_API_URLS.preproduction, CANONICAL_API_URLS.production);
assert.equal(ANDROID_PACKAGE, "com.somafrik.app");
assert.equal(APP_VERSION, "1.2.1");
assert.equal(ANDROID_VERSION_CODE, 13);
assert.ok(Number.isInteger(ANDROID_VERSION_CODE) && ANDROID_VERSION_CODE > 0);
assert.equal(DISPLAY_NAMES.preproduction, "Somafrik Préprod");
assert.equal(DISPLAY_NAMES.production, "Somafrik");
assert.equal(DISPLAY_NAMES.development, "Somafrik");
assert.doesNotMatch(DISPLAY_NAMES.production, /SchoolLink|Expo App|Somafrik Dev/);

assert.equal(resolveReleaseProfile({ EXPO_PUBLIC_RELEASE_PROFILE: "preproduction" }), "preproduction");
assert.equal(resolveReleaseProfile({ EAS_BUILD_PROFILE: "production" }), "production");
assert.equal(resolveReleaseProfile({}), "development");

assert.equal(
  resolveApiUrlForProfile("preproduction", {}),
  CANONICAL_API_URLS.preproduction,
);
assert.equal(resolveApiUrlForProfile("production", {}), CANONICAL_API_URLS.production);
assert.equal(
  resolveApiUrlForProfile("preview", { EXPO_PUBLIC_API_URL_PREVIEW: "https://somafrik-api-preprod.onrender.com" }),
  CANONICAL_API_URLS.preview,
);
assert.equal(resolveApiUrlForProfile("development", {}), "");

assert.equal(artifactForProfile("preview"), "apk");
assert.equal(artifactForProfile("preproduction"), "aab");
assert.equal(artifactForProfile("production"), "aab");
assert.equal(distributionForProfile("preproduction"), "store");
assert.equal(distributionForProfile("preview"), "internal");
assert.equal(profileAllowsCleartext("development"), true);
assert.equal(profileAllowsCleartext("preproduction"), false);
assert.equal(profileAllowsCleartext("production"), false);

assert.throws(
  () => assertReleaseApiUrl("preproduction", "http://localhost:5000"),
  /HTTPS|localhost/i,
);
assert.throws(
  () => assertReleaseApiUrl("production", "http://localhost:5000"),
  /HTTPS|localhost/i,
);
assert.throws(
  () => assertReleaseApiUrl("production", CANONICAL_API_URLS.preproduction),
  /préproduction/,
);
assert.throws(
  () => assertReleaseApiUrl("preproduction", CANONICAL_API_URLS.production),
  /production/,
);
assert.throws(
  () => assertReleaseApiUrl("preview", "http://10.0.2.2:5000"),
  /HTTPS|localhost|émulateur/i,
);
assert.equal(
  assertReleaseApiUrl("preproduction", CANONICAL_API_URLS.preproduction),
  CANONICAL_API_URLS.preproduction,
);
assert.equal(
  assertReleaseApiUrl("production", CANONICAL_API_URLS.production),
  CANONICAL_API_URLS.production,
);

console.log("OK: 4 profils, preprod ≠ prod, fail-closed HTTPS, pas de fallback localhost store");

const eas = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "eas.json"), "utf8").replace(/^\uFEFF/, ""));
assert.notEqual(
  eas.cli.appVersionSource === "local"
    && eas.build.preproduction.autoIncrement
    && eas.build.production.autoIncrement,
  true,
  "local + autoIncrement preprod/prod interdit",
);
assert.equal(eas.cli.appVersionSource, "remote");
assert.equal(eas.build.preproduction.autoIncrement, true);
assert.equal(eas.build.production.autoIncrement, true);
console.log("OK: contrat EAS remote versionCode — préprod puis prod incrémentent le même compteur Android");
