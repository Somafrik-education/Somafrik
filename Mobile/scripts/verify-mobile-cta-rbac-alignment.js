/**
 * L9b — alignement CTA Mobile / contrat RBAC backend.
 * Usage : npm run verify:mobile-cta-rbac-alignment
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const ROOT = path.join(MOBILE, "..");
const SRC = path.join(MOBILE, "src");

function readSrc(rel) {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function main() {
  const unit = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", "mobileCtaRbacAlignment.test.ts")], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || "mobileCtaRbacAlignment.test.ts failed");
  }
  process.stdout.write(unit.stdout || "");

  const messages = stripComments(readSrc(path.join("screens", "MessagesScreen.tsx")));
  assert.match(messages, /resolveMessagesRouteAccess\(session\)/);
  assert.match(messages, /canSend = messagesAccess\.canCompose/);
  assert.doesNotMatch(
    messages,
    /canMutateEntity\(session,\s*["']messages["'],\s*["']CREATE["']\)\s*\|\|/,
    "Messages composer ne doit plus unionner un grant CREATE local",
  );
  assert.match(
    messages,
    /\(\(role === ["']parent_student["']\s*\|\|\s*role === ["']teacher["']\) && canSend\) \|\| showStaffComposer/,
    "Parent/Teacher restent sur canSend ; le staff exige la source destinataires canonique",
  );
  assert.match(messages, /showComposer &&/);
  assert.match(messages, /canShowStaffMessagesComposer\(session\)/);
  assert.match(messages, /getMessageRecipients\(/);
  assert.match(messages, /uploadCommunicationAttachment\(/);
  assert.match(messages, /attachmentIds/);
  assert.doesNotMatch(messages, /getCanonicalContacts\(\)/);
  assert.doesNotMatch(messages, /getCanonicalRelations\(\)/);
  assert.doesNotMatch(messages, /messages-staff-composer-blocked/);
  assert.doesNotMatch(messages, /staffStudentId/);
  assert.doesNotMatch(
    messages,
    /selectedStudentId:\s*staffStudentId/,
    "le payload staff ne doit plus partir d'un studentId de studentsData",
  );
  assert.doesNotMatch(
    messages,
    /else \{\s*const student = teacherStudents\.find/,
    "le chemin staff ne doit plus fallback sur teacherStudents[0]",
  );

  const ctaLib = stripComments(readSrc(path.join("lib", "mobileCtaRbacAlignment.ts")));
  assert.match(ctaLib, /direction:\s*["']École vers parent["']/);
  assert.match(ctaLib, /participantUserIds:\s*\[parentUserId\]/);
  assert.match(ctaLib, /export function canAccessMessagesRoute/);
  assert.match(ctaLib, /export function resolveMessagesRouteAccess/);
  assert.match(ctaLib, /export function canShowStaffMessagesComposer/);
  assert.match(ctaLib, /export function buildStaffSchoolToParentMessagePayload/);
  assert.match(ctaLib, /MESSAGES_READ_ALLOWLIST/);
  assert.match(ctaLib, /"Messages:READ"/);
  assert.match(ctaLib, /"Gérer messages"/);
  assert.match(ctaLib, /"COUNTRY_PRIVILEGES"/);
  assert.match(ctaLib, /"ALL_PRIVILEGES"/);
  assert.doesNotMatch(ctaLib, /"Messages:R"/);
  assert.doesNotMatch(ctaLib, /"Messages:CRUD"/);
  assert.doesNotMatch(
    ctaLib,
    /parentPhone/,
    "le payload staff ne doit plus envoyer parentPhone comme substitut de participant",
  );
  assert.match(
    ctaLib,
    /liveHasExact\(getEffectivePermissionsForSession\(session\), MESSAGES_READ_ALLOWLIST\)/,
    "canReadBackofficeMessagesList doit matcher l'allowlist backend exacte",
  );

  const navigator = stripComments(readSrc(path.join("navigation", "AppNavigator.tsx")));
  assert.match(navigator, /canAccessMessagesRoute\(session\)/);
  assert.doesNotMatch(
    navigator,
    /canReadRoute\(session,\s*["']Messages["']\)/,
    "AppNavigator ne doit plus n'enregistrer Messages que via READ",
  );

  const drawer = stripComments(readSrc(path.join("navigation", "roleDrawerPreferences.ts")));
  assert.match(drawer, /canAccessMessagesRoute\(session\)/);
  const home = stripComments(readSrc(path.join("screens", "HomeScreen.tsx")));
  assert.match(home, /canAccessMessagesRoute\(session\)/);
  const headerIcons = stripComments(readSrc(path.join("components", "CommunicationHeaderIcons.tsx")));
  assert.match(headerIcons, /canAccessMessagesRoute\(session\)/);
  const appHeader = stripComments(readSrc(path.join("components", "MobileAppHeader.tsx")));
  assert.match(appHeader, /canAccessMessagesRoute\(session\)/);

  const announcements = stripComments(readSrc(path.join("screens", "AnnouncementsScreen.tsx")));
  assert.match(announcements, /canArchiveAnnouncement\(session\)/);
  assert.match(announcements, /const canArchive = canArchiveAnnouncement/);
  assert.doesNotMatch(
    announcements,
    /canMutateEntity\(session,\s*["']announcements["'],\s*["']DELETE["']\)/,
    "Archive annonce ne doit plus s'aligner sur DELETE",
  );
  assert.match(announcements, /\{canArchive && \(/);

  const permissions = stripComments(readSrc(path.join("domain", "security", "permissions.ts")));
  assert.match(permissions, /export function hasPlatformBackofficePrivilege/);
  assert.match(permissions, /if \(viewName === ["']PlatformNotifications["']\)/);
  assert.match(permissions, /if \(routeName === ["']PlatformNotifications["']\)/);
  assert.doesNotMatch(
    permissions,
    /const communicationViews = new Set\(\[[\s\S]*PlatformNotifications[\s\S]*\]\)/,
    "PlatformNotifications ne doit plus hériter de Notifications:READ via communicationViews",
  );

  const platformScreen = stripComments(readSrc(path.join("screens", "PlatformNotificationsScreen.tsx")));
  assert.match(platformScreen, /hasPlatformBackofficePrivilege\(session\)/);
  assert.match(platformScreen, /platform-notifications-denied/);
  assert.doesNotMatch(platformScreen, /hasSecurityPermission\(session,\s*["']Notifications["'],\s*["']CREATE["']\)/);

  const adminCtx = stripComments(readSrc(path.join("context", "AdminDataContext.tsx")));
  assert.match(adminCtx, /if \(!hasPlatformBackofficePrivilege\(session\)\) return;/);

  const safety = readSrc(path.join("lib", "mobileMutationSafety.ts"));
  assert.match(safety, /MOBILE_GENERIC_ADMIN_CRUD_IN_RC1 = false/);

  const liveNavFiles = [
    path.join("screens", "HomeScreen.tsx"),
    path.join("navigation", "roleDrawerPreferences.ts"),
    path.join("navigation", "roleTabPreferences.ts"),
    path.join("lib", "roleHomeConfig.ts"),
    path.join("components", "MobileAppHeader.tsx"),
    path.join("components", "CommunicationHeaderIcons.tsx"),
  ];
  for (const rel of liveNavFiles) {
    const source = stripComments(readSrc(rel));
    assert.doesNotMatch(
      source,
      /navigate\(["']AdminCrud["'],\s*\{\s*entity:\s*["']courses["']/,
      `${rel}: pas de CTA live AdminCrud courses`,
    );
    assert.doesNotMatch(
      source,
      /navigate\(["']AdminCrud["'],\s*\{\s*entity:\s*["']assignments["']/,
      `${rel}: pas de CTA live AdminCrud assignments`,
    );
    assert.doesNotMatch(
      source,
      /entity:\s*["']courses["']/,
      `${rel}: courses ne doit pas être une entrée de navigation live`,
    );
    assert.doesNotMatch(
      source,
      /entity:\s*["']assignments["']/,
      `${rel}: assignments ne doit pas être une entrée de navigation live`,
    );
  }

  const rbac = fs.readFileSync(path.join(ROOT, "backend", "services", "rbacService.js"), "utf8");
  assert.match(rbac, /const MESSAGE_READ_ALIASES = \["Messages parents", "Messages école"\];/);
  assert.match(rbac, /const MESSAGE_WRITE_ALIASES = \["Messages parents", "Messages école"\];/);
  assert.match(
    rbac,
    /"GET \/api\/backoffice\/messages":\s*\["Messages:READ",\s*\.\.\.MESSAGE_READ_ALIASES,\s*"Gérer messages",\s*"COUNTRY_PRIVILEGES",\s*"ALL_PRIVILEGES"\]/,
  );
  assert.match(
    rbac,
    /"GET \/api\/backoffice\/messages\/recipients":\s*\["Messages:READ",\s*"Messages:CREATE",\s*\.\.\.MESSAGE_READ_ALIASES,\s*\.\.\.MESSAGE_WRITE_ALIASES,\s*"Gérer messages",\s*"COUNTRY_PRIVILEGES",\s*"ALL_PRIVILEGES"\]/,
  );
  assert.match(
    rbac,
    /"GET \/api\/backoffice\/contacts":\s*\["Contacts:READ",\s*"Gérer utilisateurs",\s*"COUNTRY_PRIVILEGES",\s*"ALL_PRIVILEGES"\]/,
  );
  assert.match(
    rbac,
    /"GET \/api\/backoffice\/relations":\s*\["Relations:READ",\s*"Gérer utilisateurs",\s*"COUNTRY_PRIVILEGES",\s*"ALL_PRIVILEGES"\]/,
  );
  assert.match(
    rbac,
    /"POST \/api\/backoffice\/announcements\/:announcementId\/archive":\s*\["Announcements:UPDATE",\s*"Gérer annonces",\s*"COUNTRY_PRIVILEGES",\s*"ALL_PRIVILEGES"\]/,
  );
  assert.match(
    rbac,
    /"GET \/api\/backoffice\/notifications":\s*\["ALL_PRIVILEGES",\s*"COUNTRY_PRIVILEGES"\]/,
  );
  assert.match(
    rbac,
    /"POST \/api\/backoffice\/notifications":\s*\["ALL_PRIVILEGES",\s*"COUNTRY_PRIVILEGES"\]/,
  );
  assert.match(
    rbac,
    /"PATCH \/api\/backoffice\/notifications\/:notificationId":\s*\["ALL_PRIVILEGES",\s*"COUNTRY_PRIVILEGES"\]/,
  );

  for (const rel of [
    path.join("screens", "PaymentsScreen.tsx"),
    path.join("screens", "AnnouncementsScreen.tsx"),
    path.join("screens", "StudentsScreen.tsx"),
    path.join("screens", "UsersScreen.tsx"),
    path.join("screens", "TeachersScreen.tsx"),
    path.join("screens", "ClassesScreen.tsx"),
  ]) {
    const source = stripComments(readSrc(rel));
    assert.doesNotMatch(
      source,
      /navigate\(["']AdminCrud["']/,
      `${rel}: les CTA live ne doivent plus ouvrir AdminCrud`,
    );
  }

  // Le gate CTA est obligatoire sur les PR Mobile (PR Gates) et rejoué en profondeur
  // dans la régression nightly. Il n'a plus besoin d'un step dédié dans chaque workflow.
  const prGates = fs.readFileSync(path.join(ROOT, ".github", "workflows", "pr-gates.yml"), "utf8");
  const ci = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const mobilePkg = JSON.parse(fs.readFileSync(path.join(MOBILE, "package.json"), "utf8"));
  assert.equal(mobilePkg.scripts["verify:mobile-cta-rbac-alignment"], "node scripts/verify-mobile-cta-rbac-alignment.js");
  assert.equal(rootPkg.scripts["verify:mobile-cta-rbac-alignment"], "npm --prefix Mobile run verify:mobile-cta-rbac-alignment");
  assert.match(
    prGates,
    /- name: Mobile safety[\s\S]*?npm run verify:mobile-cta-rbac-alignment/,
    "PR Gates doit exécuter le verifier CTA dans le gate Mobile safety",
  );
  assert.match(
    ci,
    /- name: Full domain regression[\s\S]*?npm run verify:mobile-cta-rbac-alignment/,
    "la régression nightly doit rejouer le verifier CTA",
  );

  console.log("OK: CTA Messages/Archive/Plateforme/SafeAdminCrud alignés sur le contrat RBAC live");
}

main();
