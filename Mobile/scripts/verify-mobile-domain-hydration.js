/**
 * LOT MOBILE 4 — hydratation canonique Enseignants / Utilisateurs / Annonces / Messages.
 *
 * Usage: npm run verify:mobile-domain-hydration
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");
const SRC = path.join(MOBILE, "src");
const BACKEND = path.join(ROOT, "backend");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || result.error}`);
  }
  process.stdout.write(result.stdout || "");
}

function source(pathFromSrc) {
  return read(path.join(SRC, pathFromSrc));
}

function main() {
  run("npx", ["--yes", "tsx", path.join("src", "lib", "dataTruth.test.ts")], MOBILE);

  const server = read(path.join(BACKEND, "server.js"));
  assert.match(server, /app\.get\("\/api\/teachers"/);
  assert.match(server, /app\.get\("\/api\/backoffice\/users"/);
  assert.match(server, /app\.get\("\/api\/backoffice\/announcements"/);
  assert.match(server, /app\.get\("\/api\/backoffice\/messages"/);
  assert.match(server, /\/api\/backoffice\/announcements\/:announcementId\/archive/);
  assert.match(server, /\/api\/backoffice\/messages\/:messageId\/read/);
  assert.match(server, /repository\.listClientsProjection\(\)/);
  console.log("OK: endpoints canoniques réels présents côté backend");

  const api = source(path.join("services", "domainHydrationApi.ts"));
  assert.match(api, /httpRequest<unknown>\("\/teachers"\)/);
  assert.match(api, /httpRequest<unknown>\("\/backoffice\/users"\)/);
  assert.match(api, /httpRequest<unknown>\("\/backoffice\/announcements"\)/);
  assert.match(api, /httpRequest<unknown>\("\/backoffice\/messages"\)/);
  assert.match(api, /archiveCanonicalAnnouncement/);
  assert.match(api, /markCanonicalMessageRead/);
  assert.doesNotMatch(api, /\bfetch\s*\(/);
  assert.doesNotMatch(api, /\baxios\b/);
  assert.doesNotMatch(api, /tenantId\s*:/);
  assert.doesNotMatch(api, /schoolCode\s*:/);
  console.log("OK: client domaine via httpClient, sans scope tenant envoyé par le client");

  const hook = source(path.join("hooks", "useCanonicalResource.ts"));
  assert.match(hook, /snapshotFromSuccess/);
  assert.match(hook, /snapshotFromFailure/);
  assert.doesNotMatch(hook, /catch\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/);
  console.log("OK: error/offline distincts de empty");

  const teachers = source(path.join("screens", "TeachersScreen.tsx"));
  assert.match(teachers, /getCanonicalTeachers/);
  assert.match(teachers, /useFocusEffect/);
  assert.match(teachers, /QueryStateView/);
  assert.match(teachers, /Impossible de charger les enseignants/);
  assert.doesNotMatch(teachers, /refreshBackOfficeState/);
  assert.doesNotMatch(teachers, /AdminCrud/);
  console.log("OK: Enseignants hydratés à l'ouverture, actions no-op retirées");

  const users = source(path.join("screens", "UsersScreen.tsx"));
  assert.match(users, /getCanonicalUsers/);
  assert.match(users, /activeRoles/);
  assert.match(users, /useFocusEffect/);
  assert.match(users, /QueryStateView/);
  assert.doesNotMatch(users, /AdminCrudScreen/);
  assert.doesNotMatch(users, /refreshBackOfficeState/);
  console.log("OK: Utilisateurs + rôles actifs hydratés au relaunch");

  const announcements = source(path.join("screens", "AnnouncementsScreen.tsx"));
  assert.match(announcements, /getCanonicalAnnouncements/);
  assert.match(announcements, /archiveCanonicalAnnouncement/);
  assert.match(announcements, /useFocusEffect/);
  assert.match(announcements, /QueryStateView/);
  assert.doesNotMatch(announcements, /deleteItem/);
  assert.doesNotMatch(announcements, /refreshBackOfficeState/);
  console.log("OK: Annonces GET canonique + archivage serveur");

  const messages = source(path.join("screens", "MessagesScreen.tsx"));
  assert.match(messages, /getCanonicalMessages/);
  assert.match(messages, /markCanonicalMessageRead/);
  assert.match(messages, /await sendClientsMessage\(payload\)/);
  assert.match(messages, /await loadMessages\(\)/);
  assert.match(messages, /sending/);
  assert.match(messages, /QueryStateView/);
  assert.doesNotMatch(messages, /MessageService\.create\(/);
  assert.doesNotMatch(messages, /MSG-\$\{/);
  assert.doesNotMatch(messages, /updateItem\("messages"/);
  assert.doesNotMatch(messages, /createItem\("messages"/);
  assert.doesNotMatch(messages, /refreshBackOfficeState/);
  assert.doesNotMatch(messages, /catch\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/);
  console.log("OK: Messages existants chargés, POST confirmé serveur, aucun ID client inventé");

  const configuration = source(path.join("screens", "ConfigurationScreen.tsx"));
  const navigator = source(path.join("navigation", "AppNavigator.tsx"));
  assert.match(configuration, /route:\s*"Users"/);
  assert.match(configuration, /navigate\("Users"\)/);
  assert.doesNotMatch(configuration, /navigate\("Utilisateurs"\)/);
  assert.match(navigator, /Users:\s*undefined/);
  assert.match(navigator, /name="Users"/);
  console.log("OK: Configuration → Utilisateurs n'est plus un no-op");

  for (const file of [teachers, users, announcements, messages]) {
    assert.doesNotMatch(file, /\.catch\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/);
    assert.doesNotMatch(file, /\bfetch\s*\(/);
    assert.doesNotMatch(file, /\baxios\b/);
  }

  console.log("verify:mobile-domain-hydration OK");
}

main();
