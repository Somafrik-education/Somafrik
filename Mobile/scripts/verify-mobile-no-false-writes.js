/**
 * L0b — aucune action Mobile ne doit annoncer/presenter une mutation locale
 * comme une écriture canonique PostgreSQL.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const SRC = path.join(MOBILE, "src");

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

function main() {
  const unit = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", "mobileMutationSafety.test.ts")], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || "mobileMutationSafety.test.ts failed");
  }
  process.stdout.write(unit.stdout || "");

  const navigator = read(path.join("navigation", "AppNavigator.tsx"));
  const gate = read(path.join("screens", "SafeAdminCrudScreen.tsx"));
  const permissions = read(path.join("screens", "PermissionsScreen.tsx"));
  const rawAdminCrud = read(path.join("screens", "AdminCrudScreen.tsx"));
  const users = read(path.join("screens", "UsersScreen.tsx"));

  assert.match(navigator, /SafeAdminCrudScreen/);
  assert.doesNotMatch(
    navigator,
    /component=\{AdminCrudScreen\}/,
    "AppNavigator ne doit jamais exposer AdminCrudScreen sans gate fail-closed",
  );
  assert.match(gate, /canRunGenericAdminCrud/);
  assert.match(gate, /Aucune modification locale n&apos;est appliquée/);
  assert.match(gate, /SAFE_ADMIN_CRUD_ENTITIES|canRunGenericAdminCrud/);

  assert.doesNotMatch(
    permissions,
    /updateRoleFeatureAccess/,
    "PermissionsScreen ne doit plus simuler un GRANT\/REVOKE local",
  );
  assert.doesNotMatch(permissions, /synchronis[ée]s automatiquement/i);
  assert.match(permissions, /Modification Mobile désactivée/);
  assert.match(permissions, /GRANT\/REVOKE ne sont plus simulés localement/);

  // Le code historique reste encapsulé pour courses/assignments uniquement :
  // ces deux branches appellent explicitement les API avant le fallback générique.
  assert.match(rawAdminCrud, /if \(entity === "assignments"\)[\s\S]*?await createTeacherAssignment/);
  assert.match(rawAdminCrud, /if \(entity === "courses"\)[\s\S]*?await createCourse/);
  assert.match(rawAdminCrud, /if \(entity === "assignments"\)[\s\S]*?deleteTeacherAssignment/);
  assert.match(rawAdminCrud, /if \(entity === "courses"\)[\s\S]*?deleteCourse/);

  const safety = read(path.join("lib", "mobileMutationSafety.ts"));
  assert.match(safety, /MOBILE_GENERIC_ADMIN_CRUD_IN_RC1 = false/);

  // L'écran canonique Utilisateurs est lecture seule : le reset local de
  // l'ancien AdminCrud ne peut plus être atteint par la navigation runtime.
  assert.doesNotMatch(users, /resetUserPassword|temporaryPassword|updateItem\(/);

  console.log("OK: faux writes AdminCrud/RBAC bloqués; courses/assignments câblés mais hors RC1 Mobile");
}

main();
