/**
 * Prebuild hermétique : une variable parent polluée ne doit plus détourner Preview.
 */
"use strict";

const assert = require("assert");
const {
  CANONICAL_API_URLS,
  assertReleaseApiUrl,
  resolveApiUrlForProfile,
} = require("../config/releaseEnvironments");
const {
  PROFILE_API_ENV_KEYS,
  prebuildEnvForProfile,
  mergeSpawnEnv,
} = require("./verify-native-prebuild");

const STALE_RENDER_API = "https://somafrik-api-preprod.onrender.com";

assert.equal(PROFILE_API_ENV_KEYS.preview, "EXPO_PUBLIC_API_URL_PREVIEW");
assert.equal(PROFILE_API_ENV_KEYS.preproduction, "EXPO_PUBLIC_API_URL_PREPRODUCTION");
assert.equal(PROFILE_API_ENV_KEYS.production, "EXPO_PUBLIC_API_URL_PRODUCTION");

assert.equal(CANONICAL_API_URLS.preview, "https://api-preprod.somafrik.app");
assert.equal(CANONICAL_API_URLS.production, "https://api.somafrik.app");

const pollutedPreviewParent = {
  EXPO_PUBLIC_API_URL: STALE_RENDER_API,
  EXPO_PUBLIC_API_URL_PREVIEW: STALE_RENDER_API,
};
const previewSpawn = mergeSpawnEnv(prebuildEnvForProfile("preview"), pollutedPreviewParent);
assert.equal(previewSpawn.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.preview);
assert.equal(previewSpawn.EXPO_PUBLIC_API_URL_PREVIEW, CANONICAL_API_URLS.preview);
assert.equal(resolveApiUrlForProfile("preview", previewSpawn), CANONICAL_API_URLS.preview);
assert.equal(
  assertReleaseApiUrl("preview", resolveApiUrlForProfile("preview", previewSpawn)),
  CANONICAL_API_URLS.preview,
);
assert.notEqual(previewSpawn.EXPO_PUBLIC_API_URL_PREVIEW, STALE_RENDER_API);

assert.throws(
  () => assertReleaseApiUrl("preview", STALE_RENDER_API),
  /api-preprod\.somafrik\.app/,
);

const pollutedPreprodParent = {
  EXPO_PUBLIC_API_URL: STALE_RENDER_API,
  EXPO_PUBLIC_API_URL_PREPRODUCTION: STALE_RENDER_API,
};
const preprodSpawn = mergeSpawnEnv(
  prebuildEnvForProfile("preproduction"),
  pollutedPreprodParent,
);
assert.equal(preprodSpawn.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.preproduction);
assert.equal(preprodSpawn.EXPO_PUBLIC_API_URL_PREPRODUCTION, CANONICAL_API_URLS.preproduction);
assert.equal(
  resolveApiUrlForProfile("preproduction", preprodSpawn),
  CANONICAL_API_URLS.preproduction,
);

const pollutedProductionParent = {
  EXPO_PUBLIC_API_URL: STALE_RENDER_API,
  EXPO_PUBLIC_API_URL_PRODUCTION: STALE_RENDER_API,
};
const productionSpawn = mergeSpawnEnv(
  prebuildEnvForProfile("production"),
  pollutedProductionParent,
);
assert.equal(productionSpawn.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.production);
assert.equal(productionSpawn.EXPO_PUBLIC_API_URL_PRODUCTION, CANONICAL_API_URLS.production);
assert.equal(
  resolveApiUrlForProfile("production", productionSpawn),
  CANONICAL_API_URLS.production,
);

const iosSpawn = mergeSpawnEnv(
  prebuildEnvForProfile("production"),
  { EXPO_PUBLIC_API_URL_PRODUCTION: STALE_RENDER_API },
);
assert.equal(iosSpawn.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.production);
assert.equal(iosSpawn.EXPO_PUBLIC_API_URL_PRODUCTION, CANONICAL_API_URLS.production);

console.log("OK: prebuild env hermétique — parent pollué Render ignoré");
