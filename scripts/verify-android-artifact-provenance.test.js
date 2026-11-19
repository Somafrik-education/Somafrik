"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRegistryEntry, parseArgs } = require("./verify-android-artifact-provenance");

const SHA = "8467944526563b956bfd50370079af9e9355b533";
const OTHER = "99cb7915190dfc11dc1d21742df7507bb21b789f";

function appConfig(provenance) {
  return {
    version: "1.2.1",
    android: { package: "com.somafrik.app", versionCode: 25 },
    extra: { releaseProfile: "preview", apiUrl: "https://api-preprod.somafrik.app", ...(provenance ? { buildProvenance: provenance } : {}) },
  };
}

const PROVENANCE = { gitSha: SHA, gitBranch: "develop", profile: "preview", channel: "github-actions", versionCodeSource: "app-config", easBuildId: null };

test("APK traçable : entrée de registre complète, aucun écart", () => {
  const { entry, errors } = buildRegistryEntry({
    kind: "apk",
    file: "/tmp/app-release.apk",
    fileSha256: "ab".repeat(32),
    appConfig: appConfig(PROVENANCE),
    badging: { packageName: "com.somafrik.app", versionCode: "25", versionName: "1.2.1" },
    signature: { subject: "CN=Android Debug, O=Android", sha256: "fa".repeat(32) },
    options: { expectSha: SHA, channel: "smoke préprod (non distribué)" },
  });
  assert.deepEqual(errors, []);
  assert.equal(entry.gitSha, SHA);
  assert.equal(entry.versionCode, "25");
  assert.equal(entry.profile, "preview");
  assert.equal(entry.buildChannel, "github-actions");
});

test("Binaire sans provenance (antérieur au LOT 2) : refusé", () => {
  const { errors } = buildRegistryEntry({ kind: "apk", file: "x.apk", fileSha256: "0", appConfig: appConfig(null), options: {} });
  assert.ok(errors.some((error) => error.startsWith("PROVENANCE_ABSENTE")));
});

test("Commit différent de l'attendu : refusé (cas « v25 » ambigu)", () => {
  const { errors } = buildRegistryEntry({ kind: "apk", file: "x.apk", fileSha256: "0", appConfig: appConfig({ ...PROVENANCE, gitSha: OTHER }), options: { expectSha: SHA } });
  assert.ok(errors.some((error) => error.startsWith("SHA_DIFFERENT")));
});

test("AAB EAS : versionCode distant fourni explicitement", () => {
  const { entry, errors } = buildRegistryEntry({
    kind: "aab",
    file: "somafrik-production.aab",
    fileSha256: "cd".repeat(32),
    appConfig: appConfig({ ...PROVENANCE, profile: "production", channel: "eas", versionCodeSource: "eas-remote", easBuildId: "b-1" }),
    signature: { subject: "CN=Somafrik Upload", sha256: "12".repeat(32) },
    options: { expectSha: SHA, versionCode: "27", channel: "Play (non publié)" },
  });
  assert.deepEqual(errors, []);
  assert.equal(entry.versionCode, "27");
  assert.equal(entry.versionCodeSource, "eas-remote");
});

test("Signature de test sur un canal Play : refusée", () => {
  const { errors } = buildRegistryEntry({
    kind: "apk", file: "x.apk", fileSha256: "0", appConfig: appConfig(PROVENANCE),
    badging: { versionCode: "25" }, signature: { subject: "CN=Android Debug", sha256: "fa".repeat(32) }, options: { expectSha: SHA, channel: "Play production" },
  });
  assert.ok(errors.some((error) => error.startsWith("SIGNATURE_TEST_SUR_CANAL_PRODUCTION")));
});

test("Mention négative du Play Store dans le canal : pas de faux positif", () => {
  const { errors } = buildRegistryEntry({
    kind: "apk", file: "x.apk", fileSha256: "0", appConfig: appConfig(PROVENANCE),
    badging: { versionCode: "25" }, signature: { subject: "CN=Android Debug", sha256: "fa".repeat(32) },
    options: { expectSha: SHA, channel: "Validation testeurs préprod (signature de test, non distribuable Play)" },
  });
  assert.deepEqual(errors, []);
});

test("Champ sérialisé en {} par Expo : traité comme absent", () => {
  const { entry, errors } = buildRegistryEntry({
    kind: "apk", file: "x.apk", fileSha256: "0", appConfig: appConfig({ ...PROVENANCE, easBuildId: {}, gitSha: {} }),
    badging: { versionCode: "25" }, options: {},
  });
  assert.equal(entry.easBuildId, null);
  assert.ok(errors.some((error) => error.startsWith("SHA_ABSENT")));
});

test("Revue CTO : commit attendu obligatoire et complet", () => {
  const base = { kind: "apk", file: "x.apk", fileSha256: "0", appConfig: appConfig(PROVENANCE), badging: { versionCode: "25" }, signature: { subject: "CN=X", sha256: "fa".repeat(32) } };
  for (const expectSha of [undefined, "", "6e91be1"]) {
    const { errors } = buildRegistryEntry({ ...base, options: { expectSha } });
    assert.ok(errors.some((error) => error.startsWith("EXPECT_SHA_MANQUANT")), String(expectSha));
  }
  assert.deepEqual(buildRegistryEntry({ ...base, options: { expectSha: SHA } }).errors, []);
});

test("Revue CTO : signature non extraite = échec, jamais une vérification réussie", () => {
  for (const signature of [{}, { subject: "CN=X", sha256: null }, { subject: "CN=X", sha256: "abc" }]) {
    const { errors } = buildRegistryEntry({
      kind: "apk", file: "x.apk", fileSha256: "0", appConfig: appConfig(PROVENANCE),
      badging: { versionCode: "25" }, signature, options: { expectSha: SHA },
    });
    assert.ok(errors.some((error) => error.startsWith("SIGNATURE_ABSENTE")), JSON.stringify(signature));
  }
});

test("Revue CTO : registre écrit seulement après succès (ordre dans la CLI)", () => {
  const source = require("node:fs").readFileSync(require.resolve("./verify-android-artifact-provenance"), "utf8");
  const cli = source.slice(source.indexOf("if (require.main === module)"));
  assert.ok(cli.indexOf("process.exit(1)") < cli.indexOf("appendFileSync"), "appendFileSync doit suivre le contrôle d'erreurs");
  assert.match(cli, /!options\.file \|\| !FULL_SHA\.test/);
});

test("parseArgs", () => {
  assert.deepEqual(parseArgs(["a.apk", "--expect-sha", SHA.toUpperCase(), "--channel", "smoke", "--registry", "r.jsonl"]), {
    file: "a.apk", expectSha: SHA, channel: "smoke", registry: "r.jsonl",
  });
});
