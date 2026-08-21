/**
 * L1 — identités de rôles établissement canoniques (Mobile).
 * Interdit le collapse Directeur/Proviseur/Comptable/Adjoint vers un rôle générique
 * et le bypass RBAC par rôle.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const SRC = path.join(MOBILE, "src");

const RUNTIME_FILES = [
  path.join("lib", "orgHierarchy.ts"),
  path.join("lib", "canonicalRoleIdentity.ts"),
  path.join("lib", "roleHomeConfig.ts"),
  path.join("lib", "format.ts"),
  path.join("domain", "security", "permissions.ts"),
  path.join("context", "AuthContext.tsx"),
  path.join("context", "AdminDataContext.tsx"),
  path.join("navigation", "AppNavigator.tsx"),
  path.join("navigation", "roleTabPreferences.ts"),
  path.join("data", "catalog.ts"),
];

function readSrc(rel) {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function main() {
  const unit = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", "mobileCanonicalRoleIdentity.test.ts")], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || "mobileCanonicalRoleIdentity.test.ts failed");
  }
  process.stdout.write(unit.stdout || "");

  const org = readSrc(path.join("lib", "orgHierarchy.ts"));
  const home = readSrc(path.join("lib", "roleHomeConfig.ts"));
  const catalog = readSrc(path.join("data", "catalog.ts"));
  const permissions = readSrc(path.join("domain", "security", "permissions.ts"));
  const adminCtx = readSrc(path.join("context", "AdminDataContext.tsx"));
  const auth = readSrc(path.join("context", "AuthContext.tsx"));
  const identity = readSrc(path.join("lib", "canonicalRoleIdentity.ts"));

  assert.doesNotMatch(
    org,
    /sessionRole === "principal" \|\| sessionRole === "prefet"/,
    "principal ne doit plus être fusionné avec prefet",
  );
  assert.match(org, /sessionRole === "principal"\) return "Directeur"/);
  assert.match(org, /sessionRole === "proviseur"\) return "Proviseur"/);
  assert.match(org, /sessionRole === "prefet"\) return "Préfet des études"/);

  assert.doesNotMatch(
    catalog,
    /role === "Proviseur" \|\| role === "Directeur" \? "Préfet des études"/,
    "catalog.ts ne doit plus collapse Directeur/Proviseur vers Préfet",
  );

  assert.doesNotMatch(home, /\|\| "school_admin"/);
  assert.doesNotMatch(home, /\?\? SCHOOL_ADMIN/);
  assert.match(home, /return "unknown"/);
  assert.match(home, /\?\? UNKNOWN/);

  assert.doesNotMatch(
    stripComments(permissions),
    /session\?\.role === "school_admin" \|\|[\s\S]{0,80}isSchoolAdminRole\(platformRole\) \|\|/,
    "Configuration ne doit plus ouvrir un accès via school_admin",
  );
  assert.match(permissions, /hasSecurityPermission\(session, "Paramètres Établissement", "READ"\)/);
  assert.match(permissions, /attachCanonicalRoleIdentity/);

  assert.doesNotMatch(
    stripComments(adminCtx),
    /void getEffectivePermissions\(/,
    "AdminDataContext ne doit plus hydrater les permissions live (autorité AuthContext)",
  );
  assert.match(auth, /getEffectivePermissions/);
  assert.match(auth, /payload\.roleKeys/);
  assert.match(identity, /roleKey: string/);
  assert.match(identity, /roleLabel: string/);
  assert.match(identity, /permissions: string\[\]/);

  for (const rel of RUNTIME_FILES) {
    const source = stripComments(readSrc(rel));
    assert.doesNotMatch(
      source,
      /Directeur[^\n]{0,80}school_admin/,
      `${rel}: mapping Directeur -> school_admin interdit`,
    );
    assert.doesNotMatch(
      source,
      /Proviseur[^\n]{0,80}prefet/i,
      `${rel}: mapping Proviseur -> prefet interdit`,
    );
    assert.doesNotMatch(
      source,
      /Comptable[^\n]{0,80}school_admin/,
      `${rel}: mapping Comptable -> school_admin interdit`,
    );
    assert.doesNotMatch(
      source,
      /Adjoint[^\n]{0,80}school_admin/,
      `${rel}: mapping Adjoint -> school_admin interdit`,
    );
  }

  const liveBranch = permissions.slice(permissions.indexOf("export function resolveEffectivePermissions"));
  const liveReturn = liveBranch.slice(0, liveBranch.indexOf("const fromRole"));
  assert.doesNotMatch(
    liveReturn,
    /fromDefaults|rolePermissions\[role\]|getInternalRoleDefaults/,
    "un tableau live ne doit pas être fusionné avec une matrice locale",
  );

  console.log("OK: identités de rôles établissement conservées; permissions live seules font foi");
}

main();
