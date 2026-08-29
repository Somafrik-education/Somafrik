/**
 *   npx tsx Mobile/src/lib/requestSchoolScope.test.ts
 */
import assert from "node:assert/strict";
import {
  SCHOOL_SCOPE_HEADER,
  applyAuthenticatedSchoolScopeHeader,
  clearRequestSchoolScope,
  getRequestSchoolScope,
  isInternalSchoolAlias,
  isSchoolScopedApiPath,
  isV2PublicSchoolCode,
  publicRequestSchoolScope,
  setRequestSchoolScope,
} from "./requestSchoolScope";
import { clearStoredSchoolCode, writeStoredSchoolCode, readStoredSchoolCode } from "./activeSchool";

function headerBag() {
  const values = new Map<string, string>();
  return {
    values,
    set(name: string, value: string) {
      values.set(name, value);
    },
  };
}

function run() {
  assert.equal(SCHOOL_SCOPE_HEADER, "X-Somafrik-School-Code");
  assert.equal(isInternalSchoolAlias("SCH-ABC123"), true);
  assert.equal(isInternalSchoolAlias("CD-IN-26-001"), false);
  assert.equal(isV2PublicSchoolCode("CD-IN-26-001"), true);
  assert.equal(isV2PublicSchoolCode("BI-EC-26-001"), true);
  assert.equal(isV2PublicSchoolCode("CD-2026-0001"), false);
  assert.equal(isV2PublicSchoolCode("NURU"), false);
  assert.equal(publicRequestSchoolScope("CD-IN-26-001"), "CD-IN-26-001");
  assert.equal(publicRequestSchoolScope("sch-abc123"), null);
  assert.equal(publicRequestSchoolScope("CD-2026-0001"), null);
  assert.equal(publicRequestSchoolScope("NURU"), null);
  assert.equal(publicRequestSchoolScope("*"), null);
  assert.equal(publicRequestSchoolScope(""), null);

  assert.equal(isSchoolScopedApiPath("/students"), true);
  assert.equal(isSchoolScopedApiPath("/teachers"), true);
  assert.equal(isSchoolScopedApiPath("/classes"), true);
  assert.equal(isSchoolScopedApiPath("/payments"), true);
  assert.equal(isSchoolScopedApiPath("/presences"), true);
  assert.equal(isSchoolScopedApiPath("/backoffice/establishments"), false);
  assert.equal(isSchoolScopedApiPath("/backoffice/countries"), false);
  assert.equal(isSchoolScopedApiPath("/backoffice/subscriptions"), false);
  assert.equal(isSchoolScopedApiPath("/backoffice/notifications"), false);
  assert.equal(isSchoolScopedApiPath("/mobile/push-devices"), false);
  assert.equal(isSchoolScopedApiPath("/mobile/push-devices/current"), false);
  assert.equal(isSchoolScopedApiPath("/mobile/push-devices/test"), false);
  assert.equal(isSchoolScopedApiPath("/auth/logout"), false);
  assert.equal(isSchoolScopedApiPath("/login"), false);

  clearRequestSchoolScope();
  setRequestSchoolScope("CD-IN-26-001");
  const students = headerBag();
  assert.equal(applyAuthenticatedSchoolScopeHeader(students, "/students"), true);
  assert.equal(students.values.get(SCHOOL_SCOPE_HEADER), "CD-IN-26-001");

  const teachers = headerBag();
  assert.equal(applyAuthenticatedSchoolScopeHeader(teachers, "/teachers"), true);
  assert.equal(teachers.values.get(SCHOOL_SCOPE_HEADER), "CD-IN-26-001");

  const establishments = headerBag();
  assert.equal(applyAuthenticatedSchoolScopeHeader(establishments, "/backoffice/establishments"), false);
  assert.equal(establishments.values.has(SCHOOL_SCOPE_HEADER), false);

  setRequestSchoolScope("SCH-ABC123");
  assert.equal(getRequestSchoolScope(), null);
  const sch = headerBag();
  assert.equal(applyAuthenticatedSchoolScopeHeader(sch, "/students"), false);
  assert.equal(sch.values.has(SCHOOL_SCOPE_HEADER), false);

  setRequestSchoolScope("NURU");
  assert.equal(getRequestSchoolScope(), null);
  const invalid = headerBag();
  assert.equal(applyAuthenticatedSchoolScopeHeader(invalid, "/students"), false);

  setRequestSchoolScope("CD-IN-26-001");
  writeStoredSchoolCode("CD-IN-26-001");
  clearRequestSchoolScope();
  clearStoredSchoolCode();
  assert.equal(getRequestSchoolScope(), null);
  assert.equal(readStoredSchoolCode(), "");
  const afterLogout = headerBag();
  assert.equal(applyAuthenticatedSchoolScopeHeader(afterLogout, "/students"), false);
  assert.equal(afterLogout.values.has(SCHOOL_SCOPE_HEADER), false);

  setRequestSchoolScope("BI-EC-26-001");
  const nextPrincipal = headerBag();
  assert.equal(applyAuthenticatedSchoolScopeHeader(nextPrincipal, "/students"), true);
  assert.equal(nextPrincipal.values.get(SCHOOL_SCOPE_HEADER), "BI-EC-26-001");
  assert.notEqual(nextPrincipal.values.get(SCHOOL_SCOPE_HEADER), "CD-IN-26-001");
  clearRequestSchoolScope();
}

run();
console.log("requestSchoolScope.test.ts OK");
