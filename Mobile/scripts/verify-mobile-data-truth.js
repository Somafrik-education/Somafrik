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

function main() {
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
  assert.match(timetable, /loadCourseSchedules/);
  assert.match(timetable, /QueryStateView/);
  console.log("OK: planning sans fallback catalog / demo");

  const home = read(path.join(SRC, "screens", "HomeScreen.tsx"));
  assert.doesNotMatch(home, /from ["']\.\.\/data\/catalog["']/);
  assert.doesNotMatch(home, /getStudentById/);
  assert.match(home, /parentAverageDisplay/);
  assert.match(home, /Moyenne indisponible|parentAverageDisplay/);
  assert.match(home, /notesData/);
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
  assert.match(paymentsScreen, /PaymentReceiptCard/);
  assert.match(studentPayments, /showItems/);
  assert.match(paymentsScreen, /writePaymentsWebOnly/);
  const adminCrud = read(path.join(SRC, "screens", "AdminCrudScreen.tsx"));
  assert.doesNotMatch(adminCrud, /createSchoolPayment/);
  console.log("OK: finance GET canonique + reçu, POST legacy désactivé");

  const persist = api;
  assert.match(persist, /canPersistFullSession/);
  assert.match(persist, /beginRestrictedSession/);
  assert.match(persist, /clearSecureSession/);
  const auth = read(path.join(SRC, "context", "AuthContext.tsx"));
  assert.match(auth, /canRestorePersistedSession/);
  assert.match(auth, /mustChangePassword/);
  const login = read(path.join(SRC, "screens", "LoginScreen.tsx"));
  assert.doesNotMatch(login, /1234/);
  assert.match(login, /mustChangePassword/);
  assert.match(login, /pendingSession/);
  const httpClient = read(path.join(SRC, "services", "httpClient.ts"));
  assert.match(httpClient, /assertUnrestrictedApiPath/);
  console.log("OK: mustChangePassword n'ouvre pas de session Home persistée");

  const eas = JSON.parse(read(path.join(MOBILE, "eas.json")).replace(/^\uFEFF/, ""));
  assert.equal(eas.build.production.env.EXPO_PUBLIC_DEMO_MODE, "false");
  assert.equal(eas.build.preview.env.EXPO_PUBLIC_DEMO_MODE, "false");
  const appConfig = read(path.join(MOBILE, "app.config.js"));
  assert.match(appConfig, /EXPO_PUBLIC_DEMO_MODE interdit en production/);
  const env = read(path.join(SRC, "config", "env.ts"));
  assert.match(env, /shouldShowDemoLogin/);
  assert.match(env, /isDevelopmentRuntime\(\)/);
  assert.match(login, /shouldShowDemoLogin/);
  console.log("OK: production sans boutons démo / 1234");

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

main();
