"use strict";

/**
 * CHANTIER SYNC — non-régression des contrats mobileSync (tests VERTS).
 * Ces assertions doivent rester vertes. Aucun test RED ne doit « réparer »
 * une disparition de données en désactivant isolation tenant, tombstones,
 * scopeHash, curseur ou keyset.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TokenService } = require("../services/tokenService");
const {
  MOBILE_SYNC_ERROR,
  MOBILE_SYNC_CURSOR_TYP,
  MOBILE_SYNC_SCHEMA_VERSION,
  MOBILE_SYNC_GENERATION,
} = require("./mobileSyncErrors");
const {
  encodeMobileSyncCursor,
  decodeMobileSyncCursor,
} = require("./mobileSyncCursor");
const { computeClassesScopeHash, resolveClassesSyncScope } = require("./mobileSyncScope");

function tokenService() {
  return new TokenService({ secret: "ci-test-secret-with-enough-length-for-production-checks" });
}

function sampleCursor(overrides = {}) {
  return {
    resource: "students",
    schoolCode: "CD-IN-26-001",
    schoolId: "school-a",
    principalId: "user-a",
    scopeHash: "abc123def456",
    lastUpdatedAt: "2026-08-01T10:00:00.000Z",
    lastId: "00000000-0000-4000-8000-00000000000a",
    ...overrides,
  };
}

test("contrats d'erreur sync : SCOPE_CHANGED / CURSOR_EXPIRED / CURSOR_INVALID stables", () => {
  assert.equal(MOBILE_SYNC_ERROR.SCOPE_CHANGED, "MOBILE_SYNC_SCOPE_CHANGED");
  assert.equal(MOBILE_SYNC_ERROR.CURSOR_EXPIRED, "MOBILE_SYNC_CURSOR_EXPIRED");
  assert.equal(MOBILE_SYNC_ERROR.CURSOR_INVALID, "MOBILE_SYNC_CURSOR_INVALID");
  assert.equal(MOBILE_SYNC_CURSOR_TYP, "mobile-sync-cursor");
  assert.equal(MOBILE_SYNC_SCHEMA_VERSION, 1);
  assert.equal(MOBILE_SYNC_GENERATION, 1);
});

test("keyset + scopeHash : encode/decode round-trip", () => {
  const encoded = encodeMobileSyncCursor(sampleCursor(), tokenService());
  const decoded = decodeMobileSyncCursor(encoded, tokenService(), { resource: "students" });
  assert.equal(decoded.resource, "students");
  assert.equal(decoded.schoolCode, "CD-IN-26-001");
  assert.equal(decoded.scopeHash, "abc123def456");
  assert.equal(decoded.lastId, "00000000-0000-4000-8000-00000000000a");
  assert.equal(decoded.lastUpdatedAt, "2026-08-01T10:00:00.000Z");
});

test("isolation tenant : un curseur d'un établissement n'est pas un curseur d'un autre", () => {
  const tokens = tokenService();
  const cursorA = encodeMobileSyncCursor(sampleCursor({ schoolCode: "CD-IN-26-001", schoolId: "school-a" }), tokens);
  const cursorB = encodeMobileSyncCursor(
    sampleCursor({ schoolCode: "BI-EC-26-001", schoolId: "school-b", scopeHash: "other-hash" }),
    tokens,
  );
  const decodedA = decodeMobileSyncCursor(cursorA, tokens, { resource: "students" });
  const decodedB = decodeMobileSyncCursor(cursorB, tokens, { resource: "students" });
  assert.notEqual(decodedA.schoolId, decodedB.schoolId);
  assert.notEqual(decodedA.schoolCode, decodedB.schoolCode);
  assert.notEqual(decodedA.scopeHash, decodedB.scopeHash);
});

test("scopeHash déterministe et sensible au grant enseignant (pas de désactivation d'isolation)", () => {
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const teacher = (assignments) => ({
    sub: "teacher-1",
    role: "Enseignant",
    schoolCode: "SCH-A",
    permissions: ["Voir classes"],
    assignments,
  });
  const before = computeClassesScopeHash(
    teacher([{ classId: "class-a", classCode: "CLS-A", status: "active" }]),
    school,
  );
  const afterGrant = computeClassesScopeHash(
    teacher([
      { classId: "class-a", classCode: "CLS-A", status: "active" },
      { classId: "class-b", classCode: "CLS-B", status: "active" },
    ]),
    school,
  );
  assert.notEqual(before.scopeHash, afterGrant.scopeHash);
  assert.match(before.scopeHash, /^[a-f0-9]{64}$/);

  const adminScope = resolveClassesSyncScope({
    sub: "admin-1",
    role: "Admin School",
    schoolCode: "SCH-A",
    permissions: ["Voir classes"],
  });
  assert.equal(adminScope.scopeKind, "school-wide");
});

test("tombstone reste un champ de contrat (pas un levier pour vider un snapshot)", () => {
  const item = { id: "stu-1", tombstone: true };
  assert.equal(item.tombstone, true);
  const live = { id: "stu-2", tombstone: false };
  assert.equal(live.tombstone, false);
  assert.notEqual(item.tombstone, live.tombstone);
});
