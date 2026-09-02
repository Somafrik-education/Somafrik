"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mapUserRow } = require("./clientsManagement");
const { tenantSchoolCodeFromPrincipal } = require("./pedagogyManagement");
const { TenantScopeService } = require("../services/tenantScopeService");

test("mapUserRow sépare schoolCode tenant et schoolPublicCode canonique", () => {
  const mapped = mapUserRow({
    id: "11111111-1111-1111-1111-111111111111",
    user_code: "USR-JPK",
    first_name: "Jean Pierre",
    last_name: "Kimwemwe",
    role: "PREFET_ETUDES",
    status: "active",
    school_id: "22222222-2222-2222-2222-222222222222",
    school_code: "CD-2026-0001",
    school_login_code: "CD-IN-26-001",
    school_name: "INSTITUT NURU",
    login_code: "CD-IN-JPK-26-00004",
    identity_code: "CD-IN-JPK-26-00004",
    profile_payload: {},
  });

  assert.equal(mapped.schoolCode, "CD-2026-0001");
  assert.equal(mapped.schoolPublicCode, "CD-IN-26-001");
  assert.equal(mapped.schoolName, "INSTITUT NURU");
  assert.equal(mapped.loginCode, "CD-IN-JPK-26-00004");
  assert.notEqual(mapped.schoolPublicCode, mapped.schoolCode);
  assert.notEqual(mapped.loginCode, mapped.schoolPublicCode);
});

test("tenantSchoolCodeFromPrincipal ignore schoolPublicCode", () => {
  assert.equal(
    tenantSchoolCodeFromPrincipal({
      schoolCode: "CD-2026-0001",
      schoolPublicCode: "CD-IN-26-001",
    }),
    "CD-2026-0001",
  );
});

test("tenantScopeService filtre toujours sur schoolCode historique", () => {
  const service = new TenantScopeService();
  const rows = [
    { id: "same", schoolCode: "CD-2026-0001", schoolPublicCode: "CD-IN-26-001" },
    { id: "other", schoolCode: "BI-2026-0002", schoolPublicCode: "CD-IN-26-001" },
  ];
  const filtered = service.filterRows(rows, {
    role: "Préfet des études",
    schoolCode: "CD-2026-0001",
    schoolPublicCode: "CD-IN-26-001",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "same");
});
