/**
 * LOT 1 — vérité des données Mobile (planning, finance, parent, session, démo).
 *
 * Usage : npm run verify:mobile-data-truth
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");
const SRC = path.join(MOBILE, "src");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function rel(file) {
  return path.relative(ROOT, file);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "build", ".expo", "android", "ios", "coverage"].includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function runUnitTests() {
  const result = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", "dataTruth.test.ts")], {
    encoding: "utf8",
    cwd: MOBILE,
  });
  if (result.status !== 0) {
    throw new Error(`dataTruth unit tests failed:\n${result.stderr || result.stdout || result.error}`);
  }
  process.stdout.write(result.stdout);
}

function collectProductionImportGraph(entryFile) {
  const visited = new Set();
  const queue = [entryFile];

  while (queue.length) {
    const file = queue.pop();
    if (!file || visited.has(file) || !fs.existsSync(file)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    visited.add(file);
    const source = stripComments(read(file))
      .replace(/import\s+type\s+[\s\S]*?from\s+["'][^"']+["'];?/g, "")
      .replace(/if\s*\(\s*__DEV__\s*\)\s*\{[\s\S]*?\}/g, "");
    const importRe = /(?:from|require\()\s*["'](\.[^"']+)["']/g;
    let match;
    while ((match = importRe.exec(source))) {
      const resolved = resolveSourceFile(path.dirname(file), match[1]);
      if (resolved) queue.push(resolved);
    }
  }

  return [...visited];
}

function resolveSourceFile(fromDir, spec) {
  const base = path.resolve(fromDir, spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function assertProductionSourceGraph() {
  const graph = collectProductionImportGraph(path.join(MOBILE, "App.tsx"));
  const demoFiles = graph.filter((file) =>
    /DemoLoginButtons\.tsx$|demoCredentials\.ts$/.test(file),
  );
  assert.deepStrictEqual(
    demoFiles.map((file) => rel(file)),
    [],
    `modules démo dans le graphe production: ${demoFiles.map((file) => rel(file)).join(", ")}`,
  );

  const pinHits = graph.filter((file) => /["']1234["']/.test(stripComments(read(file))));
  assert.deepStrictEqual(
    pinHits.map((file) => rel(file)),
    [],
    `PIN 1234 dans le graphe production: ${pinHits.map((file) => rel(file)).join(", ")}`,
  );
  console.log(`OK: graphe production (${graph.length} modules) sans démo login / 1234`);
}

async function assertProductionMetroBundle() {
  const os = require("os");
  const Metro = require(path.join(MOBILE, "node_modules", "metro"));
  const { loadConfig } = require(path.join(MOBILE, "node_modules", "metro-config"));

  process.env.EXPO_PUBLIC_DEMO_MODE = "false";
  process.env.EXPO_PUBLIC_DEMO_PIN = "";
  process.env.EXPO_PUBLIC_RELEASE_PROFILE = "production";
  process.env.EAS_BUILD_PROFILE = "production";
  if (!process.env.EXPO_PUBLIC_API_URL) {
    process.env.EXPO_PUBLIC_API_URL = "https://api.somafrik.app";
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "somafrik-prod-bundle-"));
  const outFile = path.join(outDir, "index.android.js");
  const config = await loadConfig({ cwd: MOBILE });
  await Metro.runBuild(config, {
    entry: path.join(MOBILE, "node_modules", "expo", "AppEntry.js"),
    platform: "android",
    dev: false,
    minify: true,
    out: outFile,
    sourceMap: false,
  });

  const bundleFile = fs.existsSync(outFile) ? outFile : `${outFile}.js`;
  const bundle = read(bundleFile);
  assert.ok(bundle.length > 1000, "bundle production vide");
  assert.doesNotMatch(bundle, /["']1234["']/, "bundle production contient le PIN 1234");
  assert.doesNotMatch(bundle, /Remplir un compte enseignant demo/);
  assert.doesNotMatch(bundle, /Remplir admin établissement demo/);
  assert.doesNotMatch(bundle, /Remplir préfet des études demo/);
  assert.doesNotMatch(bundle, /Remplir secrétaire demo/);
  assert.doesNotMatch(bundle, /Remplir admin pays demo/);
  console.log(`OK: bundle production Metro (${bundle.length} octets) sans credentials démo`);
}

async function main() {
  runUnitTests();

  const srcFiles = walk(SRC).map((file) => ({ file, source: stripComments(read(file)) }));

  const catchEmpty = srcFiles.filter(({ source }) => /\.catch\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/.test(source));
  assert.deepStrictEqual(
    catchEmpty.map(({ file }) => rel(file)),
    [],
    `catch(() => []) interdit: ${catchEmpty.map(({ file }) => rel(file)).join(", ")}`,
  );
  console.log("OK: aucun catch(() => []) sur le client Mobile");

  const timetable = read(path.join(SRC, "screens", "TimetableScreen.tsx"));
  assert.doesNotMatch(timetable, /\btimetable\b/);
  assert.doesNotMatch(timetable, /getTeacherById/);
  assert.match(timetable, /loadPlanningWeekly/);
  assert.match(timetable, /QueryStateView/);
  console.log("OK: planning sans fallback catalog / demo");

  const home = read(path.join(SRC, "screens", "HomeScreen.tsx"));
  assert.doesNotMatch(home, /from ["']\.\.\/data\/catalog["']/);
  assert.doesNotMatch(home, /getStudentById/);
  assert.match(home, /parentAverageDisplay/);
  assert.match(home, /Moyenne indisponible|parentAverageDisplay/);
  assert.match(home, /notesSnapshot|loadNotes|notesData/);
  console.log("OK: dashboard Parent sans catalog.ts");

  const reports = read(path.join(SRC, "screens", "ReportCardsScreen.tsx"));
  assert.doesNotMatch(reports, /from ["']\.\.\/data\/catalog["']/);
  assert.doesNotMatch(reports, /import\s*\{[^}]*\breportCards\b/);
  assert.match(reports, /loadReportCards/);
  assert.match(reports, /emptyBulletins|Aucun bulletin/);
  console.log("OK: bulletins sans liste fictive");

  const paymentsScreen = read(path.join(SRC, "screens", "PaymentsScreen.tsx"));
  const studentPayments = read(path.join(SRC, "screens", "StudentPaymentsScreen.tsx"));
  const api = read(path.join(SRC, "services", "api.ts"));
  assert.match(api, /function getPayments/);
  assert.match(api, /["']\/payments["']/);
  assert.match(paymentsScreen, /loadPayments/);
  assert.match(paymentsScreen, /loadStudentFees/);
  assert.match(paymentsScreen, /getPaymentRateKpi/);
  assert.match(paymentsScreen, /getPaymentCashKpi/);
  assert.match(paymentsScreen, /PaymentReceiptCard/);
  assert.match(studentPayments, /showItems/);
  assert.match(studentPayments, /loadStudentFees/);
  assert.match(studentPayments, /getPaymentRateKpi/);
  assert.match(studentPayments, /getPaymentCashKpi/);
  assert.match(paymentsScreen, /PaymentMutationControls/);
  assert.doesNotMatch(paymentsScreen, /writePaymentsWebOnly/);
  assert.doesNotMatch(paymentsScreen, /AdminCrud/);
  assert.doesNotMatch(paymentsScreen, /paymentStats\.rate/);
  assert.doesNotMatch(paymentsScreen, /des paiements réglés/);
  const adminCrud = read(path.join(SRC, "screens", "AdminCrudScreen.tsx"));
  assert.doesNotMatch(adminCrud, /createSchoolPayment/);
  console.log("OK: finance GET canonique + reçu, POST /payments via écran canonique");

  const persist = api;
  assert.match(persist, /canPersistFullSession/);
  assert.match(persist, /beginRestrictedSession/);
  assert.match(persist, /clearSecureSession/);
  const auth = read(path.join(SRC, "context", "AuthContext.tsx"));
  assert.match(auth, /canRestorePersistedSession/);
  assert.match(auth, /mustChangePassword/);
  const login = read(path.join(SRC, "screens", "LoginScreen.tsx"));
  assert.doesNotMatch(login, /1234/);
  assert.doesNotMatch(login, /import\s+DemoLoginButtons/);
  assert.doesNotMatch(login, /from ["']\.\.\/components\/DemoLoginButtons["']/);
  assert.match(login, /if\s*\(\s*__DEV__\s*\)/);
  assert.match(login, /require\(\s*["']\.\.\/components\/DemoLoginButtons["']\s*\)/);
  assert.match(login, /mustChangePassword/);
  assert.match(login, /pendingSession/);
  const httpClient = read(path.join(SRC, "services", "httpClient.ts"));
  assert.match(httpClient, /assertUnrestrictedApiPath/);
  console.log("OK: mustChangePassword n'ouvre pas de session Home persistée");

  const eas = JSON.parse(read(path.join(MOBILE, "eas.json")).replace(/^\uFEFF/, ""));
  assert.equal(eas.build.production.env.EXPO_PUBLIC_DEMO_MODE, "false");
  assert.equal(eas.build.preview.env.EXPO_PUBLIC_DEMO_MODE, "false");
  assert.equal(eas.build.preproduction.env.EXPO_PUBLIC_DEMO_MODE, "false");
  assert.ok(!Object.prototype.hasOwnProperty.call(eas.build.production.env, "EXPO_PUBLIC_DEMO_PIN"));
  assert.ok(!Object.prototype.hasOwnProperty.call(eas.build.preview.env, "EXPO_PUBLIC_DEMO_PIN"));
  assert.ok(!Object.prototype.hasOwnProperty.call(eas.build.preproduction.env, "EXPO_PUBLIC_DEMO_PIN"));
  const appConfig = read(path.join(MOBILE, "app.config.js"));
  assert.match(appConfig, /EXPO_PUBLIC_DEMO_MODE interdit en production/);
  assert.match(appConfig, /EXPO_PUBLIC_DEMO_PIN interdit en production/);
  const env = read(path.join(SRC, "config", "env.ts"));
  assert.match(env, /shouldShowDemoLogin/);
  assert.match(env, /isDevelopmentRuntime\(\)/);
  assert.match(login, /shouldShowDemoLogin/);
  const demoCreds = read(path.join(SRC, "data", "demoCredentials.ts"));
  assert.doesNotMatch(demoCreds, /1234/);
  assert.match(demoCreds, /EXPO_PUBLIC_DEMO_PIN/);
  assert.match(demoCreds, /sans fallback/);
  console.log("OK: production sans import statique démo / PIN env only");

  assertProductionSourceGraph();
  await assertProductionMetroBundle();

  const dataTruth = read(path.join(SRC, "lib", "dataTruth.ts"));
  const adminCtx = read(path.join(SRC, "context", "AdminDataContext.tsx"));
  assert.doesNotMatch(dataTruth, /backoffice_state/);
  assert.match(api, /BACKOFFICE_STATE_READ_REMOVED/);
  assert.doesNotMatch(adminCtx, /getBackOfficeState\s*\(/);
  assert.doesNotMatch(login, /getBackOfficeState\s*\(/);
  assert.doesNotMatch(timetable, /getBackOfficeState\s*\(/);
  console.log("OK: pas de snapshot global / backoffice_state");

  console.log("verify-mobile-data-truth: SUCCESS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
