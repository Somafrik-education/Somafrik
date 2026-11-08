/**
 * NFC-PRES-LOCAL-PR2 — preuve native Android : gate Hermes S13 + base d'appel SQLCipher.
 *
 * Prérequis : APK compilé avec SOMAFRIK_RC_NATIVE_PROOF_ENTRY=1 (entrée App.rcNativeProof.tsx),
 * appareil ou émulateur Android visible par adb.
 *
 *   ANDROID_APK=app-release.apk node Mobile/scripts/run-rc-offline-native-proof.js [--evidence dir]
 *
 * Étapes :
 *  1. installation propre (désinstallation préalable : aucune donnée héritée) ;
 *  2. lancement 1 : S13 sous Hermes (27/27, engine=hermes) ; base créée, cipher_version non vide,
 *     en-tête chiffré, 3 scans écrits, connexion fermée (persist=init) ;
 *  3. arrêt forcé de l'application (am force-stop) ;
 *  4. lancement 2 : S13 de nouveau ; réouverture avec la bonne clé, mêmes 3 scans relus, brouillon
 *     repris (persist=ok) ; ouverture refusée avec une mauvaise clé et sans clé.
 *
 * Sortie : 0 uniquement si tout est prouvé. Aucun appareil → HERMES_S13_NOT_RUN et
 * ANDROID_SQLCIPHER_NOT_RUN, code 3 (jamais un succès). Échec d'une preuve → code 1.
 * Les journaux ne contiennent que des identifiants de cas et des booléens (aucune clé).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ANDROID_PACKAGE } = require("../config/releaseEnvironments");

const TAG = "RC_NATIVE_PROOF";
const WAIT_MS = Number(process.env.RC_PROOF_WAIT_MS || 120000);
const EXPECTED_CASES = 27;

function adb(args, timeout = 30000) {
  return spawnSync("adb", args, { encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 });
}

function sleep(ms) {
  spawnSync("sleep", [String(ms / 1000)]);
}

function devices() {
  const out = adb(["devices"]);
  if (out.error) return [];
  return String(out.stdout || "")
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /\tdevice$/.test(line))
    .map((line) => line.split("\t")[0]);
}

function proofLines() {
  const out = adb(["logcat", "-d", "-v", "raw"], 30000);
  return String(out.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(TAG))
    .map((line) => line.slice(line.indexOf(TAG)));
}

function launch(label) {
  adb(["logcat", "-c"]);
  const started = adb(["shell", "monkey", "-p", ANDROID_PACKAGE, "-c", "android.intent.category.LAUNCHER", "1"]);
  if (started.status !== 0) adb(["shell", "am", "start", "-n", `${ANDROID_PACKAGE}/.MainActivity`]);
  const deadline = Date.now() + WAIT_MS;
  let lines = [];
  while (Date.now() < deadline) {
    lines = proofLines();
    if (lines.some((line) => line === `${TAG} done` || line.startsWith(`${TAG} error=`))) return lines;
    sleep(2000);
  }
  throw new Error(`${label} : marqueur « done » absent après ${WAIT_MS} ms\n${lines.join("\n")}`);
}

function expectLine(lines, pattern, label) {
  const line = lines.find((entry) => pattern.test(entry));
  if (!line) throw new Error(`${label} : ${pattern} absent\n${lines.join("\n")}`);
  return line;
}

function checkS13(lines, label) {
  const summary = expectLine(lines, new RegExp(`^${TAG} S13 `), `${label} S13`);
  const match = /engine=(\S+) passed=(\d+) total=(\d+) failed=(\S+)/.exec(summary);
  if (!match) throw new Error(`${label} : résumé S13 illisible : ${summary}`);
  const [, engine, passed, total, failed] = match;
  if (engine !== "hermes") throw new Error(`${label} : moteur ${engine}, Hermes attendu`);
  if (Number(total) !== EXPECTED_CASES || Number(passed) !== EXPECTED_CASES || failed !== "none") {
    throw new Error(`${label} : S13 ${passed}/${total}, échecs ${failed}`);
  }
  // Un même cas peut être journalisé plusieurs fois (relecture du tampon logcat) : on exige les
  // 27 identifiants distincts, chacun uniquement « ok », jamais un résultat contradictoire.
  const cases = lines.filter((line) => line.startsWith(`${TAG} S13_CASE `));
  const outcomes = new Map();
  for (const line of cases) {
    const [, id, outcome] = /S13_CASE (\S+) (\S+)$/.exec(line) || [];
    if (!id) throw new Error(`${label} : ligne S13 illisible : ${line}`);
    outcomes.set(id, new Set([...(outcomes.get(id) || []), outcome]));
  }
  const bad = [...outcomes].filter(([, set]) => set.size !== 1 || !set.has("ok")).map(([id]) => id);
  if (outcomes.size !== EXPECTED_CASES || bad.length > 0) {
    throw new Error(`${label} : cas S13 incomplets ou en échec (${outcomes.size} distincts, échecs : ${bad.join(",") || "aucun"})\n${cases.join("\n")}`);
  }
  const summaries = lines.filter((line) => line.startsWith(`${TAG} S13 `));
  if (new Set(summaries).size !== 1) throw new Error(`${label} : résumés S13 divergents\n${summaries.join("\n")}`);
  return { engine, passed: Number(passed), total: Number(total) };
}

function main() {
  const evidenceIndex = process.argv.indexOf("--evidence");
  const evidenceDir = evidenceIndex > 0 ? process.argv[evidenceIndex + 1] : null;
  const serials = devices();
  if (serials.length === 0) {
    console.log("HERMES_S13_NOT_RUN: aucun appareil ni émulateur Android visible par adb");
    console.log("ANDROID_SQLCIPHER_NOT_RUN: aucun appareil ni émulateur Android visible par adb");
    process.exit(3);
  }
  const apk = process.env.ANDROID_APK || "";
  if (!apk || !fs.existsSync(apk)) throw new Error("ANDROID_APK : APK de recette introuvable");
  const model = String(adb(["shell", "getprop", "ro.product.model"]).stdout || "").trim();
  const sdk = String(adb(["shell", "getprop", "ro.build.version.sdk"]).stdout || "").trim();
  const abi = String(adb(["shell", "getprop", "ro.product.cpu.abi"]).stdout || "").trim();
  console.log(`appareil : ${serials[0]} modèle=${model} sdk=${sdk} abi=${abi}`);

  adb(["uninstall", ANDROID_PACKAGE], 60000);
  const installed = adb(["install", "-r", apk], 300000);
  if (installed.status !== 0) throw new Error(`adb install : ${installed.stdout}${installed.stderr}`);

  const first = launch("lancement 1");
  const s13First = checkS13(first, "lancement 1");
  const cipher = expectLine(first, new RegExp(`^${TAG} cipher_version=`), "lancement 1 cipher_version");
  if (/=EMPTY$/.test(cipher)) throw new Error("cipher_version vide : SQLCipher absent");
  expectLine(first, new RegExp(`^${TAG} header=encrypted$`), "lancement 1 en-tête chiffré");
  expectLine(first, new RegExp(`^${TAG} meta_guard=refused$`), "lancement 1 gardes SQL des révocations et de l'horloge");
  expectLine(first, new RegExp(`^${TAG} closed=ok$`), "lancement 1 fermeture");
  expectLine(first, new RegExp(`^${TAG} persist=init scans=3$`), "lancement 1 écriture");
  expectLine(first, new RegExp(`^${TAG} pr3=ok first=recorded again=duplicate proof=V-4$`), "lancement 1 parcours PR3 (preuve V-4, doublon, clôture)");

  adb(["shell", "am", "force-stop", ANDROID_PACKAGE]);
  sleep(2000);
  const pid = String(adb(["shell", "pidof", ANDROID_PACKAGE]).stdout || "").trim();
  if (pid) throw new Error(`processus encore actif après force-stop (pid ${pid})`);

  const second = launch("lancement 2");
  const s13Second = checkS13(second, "lancement 2");
  expectLine(second, new RegExp(`^${TAG} cipher_version=(?!EMPTY)`), "lancement 2 cipher_version");
  expectLine(second, new RegExp(`^${TAG} header=encrypted$`), "lancement 2 en-tête chiffré");
  expectLine(second, new RegExp(`^${TAG} persist=ok scans=3 state=draft$`), "lancement 2 relecture après arrêt forcé");
  expectLine(second, new RegExp(`^${TAG} wrong_key=refused no_key=refused$`), "lancement 2 refus mauvaise clé / sans clé");
  expectLine(second, new RegExp(`^${TAG} meta_persist=ok$`), "lancement 2 révocations et horloge relues après force-stop");
  expectLine(second, new RegExp(`^${TAG} pr3_persist=ok$`), "lancement 2 appel PR3 clôturé relu après force-stop");

  const evidence = {
    device: { model, sdk, abi },
    hermesS13: { launch1: s13First, launch2: s13Second },
    sqlcipher: {
      cipherVersion: cipher.slice(`${TAG} cipher_version=`.length),
      header: "encrypted",
      persistAfterForceStop: true,
      wrongKey: "refused",
      noKey: "refused",
      securityStateGuards: "refused",
      securityStatePersisted: true,
    },
    pr3Pipeline: { proofMatchesV4: true, duplicateRefused: true, closedSurvivesForceStop: true },
    logcat: { launch1: first, launch2: second },
  };
  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, "rc-offline-native-proof.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(`HERMES_S13_PASSED: engine=hermes ${s13Second.passed}/${s13Second.total} (deux lancements)`);
  console.log(`ANDROID_SQLCIPHER_PASSED: ${evidence.sqlcipher.cipherVersion} ; écriture → fermeture → force-stop → relecture ; mauvaise clé et absence de clé refusées ; en-tête chiffré ; recul des révocations et de l'horloge refusé par SQLite natif`);
  console.log("PR3_PIPELINE_PASSED: carte vecteur → preuve V-4 sous Hermes → rapprochement → COMMIT → doublon refusé → clôture → relue après force-stop");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("HERMES_S13_NOT_PROVEN / ANDROID_SQLCIPHER_NOT_PROVEN");
  process.exit(1);
}
