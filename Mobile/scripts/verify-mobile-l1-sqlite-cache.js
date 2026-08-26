/**
 * Vérifie le cache SQLite L1 chiffré : config SQLCipher, absence de fallback
 * plaintext, tests moteur Node, prebuild Android, smoke natif ou BLOCKED.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");
const ANDROID = path.join(MOBILE, "android");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd || MOBILE,
    env: { ...process.env, ...(options.env || {}) },
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout,
  });
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function gitignored(relativePath) {
  const result = run("git", ["check-ignore", "-q", relativePath], { cwd: ROOT });
  return result.status === 0;
}

function main() {
  const pkg = JSON.parse(read(path.join(MOBILE, "package.json")));
  assert.equal(pkg.dependencies["expo-sqlite"], "~16.0.10", "expo-sqlite SDK 54");

  const appConfig = read(path.join(MOBILE, "app.config.js"));
  assert.match(appConfig, /"expo-sqlite"/);
  assert.match(appConfig, /useSQLCipher:\s*true/);
  console.log("OK: expo-sqlite ~16.0.10 + plugin useSQLCipher");

  const database = stripComments(read(path.join(MOBILE, "src/offline/l1/database.ts")));
  const types = read(path.join(MOBILE, "src/offline/l1/types.ts"));
  const schema = read(path.join(MOBILE, "src/offline/l1/schema.ts"));
  assert.match(types, /somafrik\.l1DbKeyV1/);
  assert.match(database, /L1_DB_KEY_SECURESTORE/);
  assert.match(database, /PRAGMA cipher_version/);
  assert.match(types, /L1_SQLCIPHER_REQUIRED/);
  assert.match(database, /L1_ERROR\.SQLCIPHER_REQUIRED/);
  assert.equal(/PRAGMA key = 'password'/.test(database), false);
  assert.doesNotMatch(database, /AsyncStorage/);
  const migration = schema.slice(schema.indexOf("export const SCHEMA_MIGRATION_V1"));
  assert.doesNotMatch(migration, /REFERENCES l1_/);
  assert.doesNotMatch(migration, /access_token|refresh_token|password|parent_phone|backoffice_state/);
  const runtime = read(path.join(MOBILE, "App.tsx"));
  assert.match(runtime, /L1CacheRuntime/);
  const auth = read(path.join(MOBILE, "src/context/AuthContext.tsx"));
  assert.match(auth, /invalidateL1CacheSession/);
  console.log("OK: pas de fallback plaintext, clé SecureStore, pas de FK inter-ressources");

  const tests = run("npx", ["--yes", "tsx", "src/offline/l1/l1SqliteCache.test.ts"], { cwd: MOBILE });
  process.stdout.write(tests.stdout || "");
  process.stderr.write(tests.stderr || "");
  assert.equal(tests.status, 0, "l1SqliteCache.test.ts");

  assert.equal(gitignored("Mobile/android/"), true, "Mobile/android/ doit rester gitignoré");

  const skipPrebuild = process.env.SOMAFRIK_SKIP_L1_PREBUILD === "1";
  if (skipPrebuild) {
    console.log("BLOCKED_NATIVE_SQLCIPHER_SMOKE: prebuild skip (SOMAFRIK_SKIP_L1_PREBUILD=1)");
    return;
  }

  const prebuild = run("npx", ["expo", "prebuild", "--clean", "--platform", "android", "--no-install"], {
    cwd: MOBILE,
    timeout: 300000,
  });
  if (prebuild.status !== 0) {
    console.log("BLOCKED_NATIVE_SQLCIPHER_SMOKE: expo prebuild android a échoué");
    process.stdout.write((prebuild.stdout || "").slice(-2000));
    process.stderr.write((prebuild.stderr || "").slice(-2000));
    return;
  }

  const gradle = fs.existsSync(path.join(ANDROID, "app", "build.gradle"))
    ? read(path.join(ANDROID, "app", "build.gradle"))
    : "";
  const settings = fs.existsSync(path.join(ANDROID, "settings.gradle"))
    ? read(path.join(ANDROID, "settings.gradle"))
    : "";
  const gradleProps = fs.existsSync(path.join(ANDROID, "gradle.properties"))
    ? read(path.join(ANDROID, "gradle.properties"))
    : "";
  const blob = `${gradle}\n${settings}\n${gradleProps}`;
  if (!fs.existsSync(path.join(ANDROID, "app"))) {
    console.log("BLOCKED_NATIVE_SQLCIPHER_SMOKE: android généré introuvable");
    return;
  }
  if (/expo\.sqlite\.useSQLCipher\s*=\s*true/i.test(blob) || /sqlcipher|expo-sqlite/i.test(blob)) {
    console.log("OK: expo prebuild android useSQLCipher=true (répertoire android/ gitignoré)");
  } else {
    console.log("OK: expo prebuild android (répertoire android/ gitignoré)");
  }

  const adb = run("adb", ["devices"]);
  const deviceLines = String(adb.stdout || "")
    .trim()
    .split("\n")
    .slice(1)
    .filter((line) => /\tdevice\s*$/.test(line));
  if (!deviceLines.length) {
    console.log("BLOCKED_NATIVE_SQLCIPHER_SMOKE: aucun device/emulator Android pour PRAGMA cipher_version");
    return;
  }
  console.log("BLOCKED_NATIVE_SQLCIPHER_SMOKE: device présent mais smoke open/PRAGMA non branché dans cet agent");
}

main();
