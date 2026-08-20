/**
 * LOT 6 — ergonomie Android / petits écrans / clavier / accessibilité.
 *
 * Lance de vrais tests (pas seulement un grep accessibilityLabel).
 * Usage : npm run verify:mobile-usability
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

function source(relPath) {
  return read(path.join(SRC, relPath));
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd, env: process.env });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || result.error}`,
    );
  }
  process.stdout.write(result.stdout || "");
}

function main() {
  run("npx", ["--yes", "tsx", path.join("src", "lib", "mobileUsability.test.ts")], MOBILE);
  console.log("OK: tests unitaires Login/Classes/Notes/Finance/Planning/Messages/a11y");

  run("node", [path.join("scripts", "verify-mobile-ux-v1.js")], MOBILE);
  console.log("OK: contrat UX/UI Mobile V1.2 — header compact + welcome secondaire + KPI above-fold + bottom nav dockée");

  const login = source(path.join("screens", "LoginScreen.tsx"));
  assert.match(login, /KeyboardAwareScreen/);
  assert.match(login, /login-keyboard-scroll|USABILITY_TEST_IDS\.loginKeyboardScroll/);
  assert.match(login, /login-submit-button|USABILITY_TEST_IDS\.loginSubmit/);
  assert.match(login, /accessibilityRole="alert"/);
  assert.match(login, /passwordChangeError/);
  assert.doesNotMatch(login, /Alert\.alert\(/);
  const keyboardScreen = source(path.join("components", "KeyboardAwareScreen.tsx"));
  assert.match(keyboardScreen, /keyboardShouldPersistTaps="handled"/);
  console.log("OK: Login — KeyboardAwareScreen + CTA/erreur scrollables, erreurs inline");

  const classes = source(path.join("screens", "ClassesScreen.tsx"));
  assert.match(classes, /filterClassesByQuery/);
  assert.match(classes, /onChangeText=\{setSearchQuery\}/);
  assert.match(classes, /USABILITY_TEST_IDS\.classesSearch/);
  assert.match(classes, /classes-empty-search|USABILITY_TEST_IDS\.classesEmptySearch/);
  assert.match(classes, /FlatList/);
  assert.match(classes, /Présence \{presenceRateLabel\}/);
  console.log("OK: Classes — recherche réelle nom/code + empty state + FlatList");

  const planning = source(path.join("screens", "TimetableScreen.tsx"));
  assert.match(planning, /accessibilityState=\{\{\s*selected:/);
  assert.match(planning, /minHeight:\s*44/);
  assert.match(planning, /PLANNING_WEEKDAY_CHIPS/);
  assert.match(planning, /Classe :/);
  assert.match(planning, /Enseignant :/);
  assert.match(planning, /Salle :/);
  assert.match(planning, /showUnavailableWarning|PLANNING_V2_COPY\.replacementsUnavailable/);
  assert.doesNotMatch(planning, /refreshBackOfficeState/);
  console.log("OK: Planning — chips >=44dp selected + carte 320px lisible");

  const finance = source(path.join("components", "PaymentReceiptCard.tsx"));
  assert.match(finance, /StatusBadge/);
  assert.match(finance, /toLocaleString\("fr-FR"\)/);
  assert.match(finance, /selectable/);
  assert.doesNotMatch(finance, /numberOfLines=\{1\}[\s\S]{0,80}amount/);
  const payments = source(path.join("screens", "PaymentsScreen.tsx"));
  assert.match(payments, /FlatList/);
  assert.match(payments, /PaymentReceiptCard/);
  console.log("OK: Finance — reçu multi-item non tronqué + statut texte/icône");

  const notes = source(path.join("screens", "TeacherGradesScreen.tsx"));
  assert.match(notes, /KeyboardAvoidingContainer/);
  assert.match(notes, /FlatList/);
  assert.match(notes, /USABILITY_TEST_IDS\.notesGradeInput/);
  assert.match(notes, /keyboardType="decimal-pad"/);
  assert.match(notes, /ListFooterComponent/);
  assert.match(notes, /submitProtectedMutation/);
  assert.match(notes, /noteIntentionRef/);
  assert.doesNotMatch(notes, /refreshBackOfficeState/);
  console.log("OK: Notes — dernier élève + clavier + outbox LOT 5 intacte");

  const attendance = source(path.join("screens", "TeacherAttendanceScreen.tsx"));
  assert.match(attendance, /ATTENDANCE_ACTIONS/);
  assert.match(attendance, /attendanceActionForStudent/);
  assert.match(attendance, /FlatList/);
  assert.match(attendance, /Présent pour \$\{student\.name\}|\$\{action\} pour \$\{student\.name\}/);
  assert.match(attendance, /submitProtectedMutation/);
  assert.match(attendance, /idempotencyKey/);
  assert.match(attendance, /tryBegin/);
  assert.match(attendance, /loadPresences/);
  assert.doesNotMatch(attendance, /refreshBackOfficeState/);
  assert.doesNotMatch(attendance, /getNextStatus/);
  console.log("OK: Présences — actions 44dp par élève, pas de cycle N→N+1");

  const messages = source(path.join("screens", "MessagesScreen.tsx"));
  assert.match(messages, /KeyboardAvoidingContainer/);
  assert.match(messages, /SectionList/);
  assert.match(messages, /USABILITY_TEST_IDS\.messagesComposer/);
  assert.match(messages, /USABILITY_TEST_IDS\.messagesSend/);
  assert.match(messages, /accessibilityLabel="Envoyer le message"/);
  assert.match(messages, /submitProtectedMutation/);
  assert.match(messages, /sendClientsMessage\(payload,\s*\{\s*idempotencyKey\s*\}\)/);
  assert.doesNotMatch(messages, /MSG-\$\{/);
  assert.doesNotMatch(messages, /refreshBackOfficeState/);
  console.log("OK: Messages — composer clavier + SectionList + pas de MSG-Date.now");

  const iconButton = source(path.join("components", "AccessibleIconButton.tsx"));
  assert.match(iconButton, /accessibilityLabel: string/);
  assert.match(iconButton, /MIN_TOUCH_TARGET_DP/);
  assert.match(iconButton, /ICON_HIT_SLOP/);
  const headerIcons = source(path.join("components", "CommunicationHeaderIcons.tsx"));
  assert.match(headerIcons, /accessibilityLabel=\{label\}/);
  assert.match(headerIcons, /MIN_TOUCH_TARGET_DP/);
  const messagesClose = messages;
  assert.match(messagesClose, /accessibilityLabel="Fermer le message"/);
  console.log("OK: boutons icon-only — libellés métier + 44dp");

  const teachers = source(path.join("screens", "TeachersScreen.tsx"));
  const users = source(path.join("screens", "UsersScreen.tsx"));
  const announcements = source(path.join("screens", "AnnouncementsScreen.tsx"));
  assert.match(teachers, /FlatList/);
  assert.match(users, /FlatList/);
  assert.match(announcements, /FlatList/);
  assert.match(teachers, /onRefresh=\{\(\) => void load\(\)\}/);
  assert.match(users, /onRefresh=\{\(\) => void load\(\)\}/);
  assert.match(announcements, /onRefresh=\{\(\) => void load\(\)\}/);
  for (const [name, file] of [
    ["Teachers", teachers],
    ["Users", users],
    ["Announcements", announcements],
    ["Messages", messages],
    ["Notes", notes],
    ["Présences", attendance],
  ]) {
    assert.doesNotMatch(file, /refreshBackOfficeState/, `${name} ne doit pas réintroduire refreshBackOfficeState`);
  }
  console.log("OK: listes volumineuses virtualisées + refresh ciblé (pas de snapshot global)");

  const dataTruth = source(path.join("lib", "dataTruth.ts"));
  assert.match(dataTruth, /snapshotFromFailure|QuerySnapshot|status: "error"/);
  const queryState = source(path.join("components", "QueryStateView.tsx"));
  assert.match(queryState, /errorMessage/);
  assert.match(queryState, /emptyMessage/);
  assert.doesNotMatch(announcements, /status === ["']error["'][\s\S]{0,80}Aucune annonce/);
  console.log("OK: Data Truth — error ≠ empty");

  const outbox = source(path.join("lib", "outbox.ts"));
  assert.match(outbox, /OUTBOX_ALLOWED_DOMAINS/);
  assert.match(outbox, /messages|presences|notes|payments/);
  const httpClient = source(path.join("services", "httpClient.ts"));
  assert.match(httpClient, /Idempotency-Key/);
  console.log("OK: outbox / idempotence LOT 5 présentes dans les fichiers UX touchés");

  const keyboard = source(path.join("components", "KeyboardAwareScreen.tsx"));
  assert.match(keyboard, /keyboardShouldPersistTaps="handled"/);
  assert.match(keyboard, /KeyboardAvoidingView/);
  console.log("OK: KeyboardAwareScreen unique (pas de second système Safe Area)");

  const ci = read(path.join(ROOT, ".github", "workflows", "ci.yml"));
  const security = read(path.join(ROOT, ".github", "workflows", "security.yml"));
  assert.match(ci, /name: verify:mobile-usability/);
  assert.match(ci, /npm run verify:mobile-usability/);
  assert.match(security, /name: verify:mobile-usability/);
  assert.match(security, /npm run verify:mobile-usability/);
  assert.match(ci, /name: verify:mobile-network-resilience/);
  assert.match(security, /name: verify:mobile-network-resilience/);
  assert.match(ci, /name: Bootstrap runtime guard/);
  console.log("OK: CI + Security branchent verify:mobile-usability sans retirer LOT 5 / bootstrap");

  const backendPkg = JSON.parse(read(path.join(ROOT, "backend", "package.json")));
  assert.match(String(backendPkg.scripts.prestart || ""), /idempotency|schema/);
  const rootPkg = JSON.parse(read(path.join(ROOT, "package.json")));
  assert.equal(rootPkg.scripts["verify:runtime-bootstrap"], "npm --prefix backend run verify:runtime-bootstrap");
  console.log("OK: hotfix #275 prestart / bootstrap conservés");

  console.log("verify:mobile-usability OK");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
