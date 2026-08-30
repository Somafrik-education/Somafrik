"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mapUserRow } = require("./clientsManagement");
const { tenantSchoolCodeFromPrincipal } = require("./pedagogyManagement");
const { TenantScopeService } = require("../services/tenantScopeService");

test("mapUserRow : schoolCode API = login_code, identifier = user_code", () => {
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
    login_code: "GK-26-00001",
    identity_code: "CD-IN-JPK-26-00004",
    profile_payload: { identifier: "admin-overlay" },
  });

  assert.equal(mapped.id, "11111111-1111-1111-1111-111111111111");
  assert.equal(mapped.schoolCode, "CD-IN-26-001");
  assert.equal(mapped.schoolPublicCode, "CD-IN-26-001");
  assert.equal(mapped.schoolName, "INSTITUT NURU");
  assert.equal(mapped.userCode, "USR-JPK");
  assert.equal(mapped.identifier, "USR-JPK");
  assert.equal(mapped.publicId, "USR-JPK");
  assert.notEqual(mapped.identifier, "GK-26-00001");
  assert.notEqual(mapped.identifier, "admin-overlay");
  assert.notEqual(mapped.schoolCode, "CD-2026-0001");
});

test("tenantSchoolCodeFromPrincipal = login_code JWT, ignore school_code interne", () => {
  assert.equal(
    tenantSchoolCodeFromPrincipal({
      schoolCode: "CD-IN-26-001",
      schoolPublicCode: "CD-IN-26-001",
    }),
    "CD-IN-26-001",
  );
});

test("tenantScopeService filtre sur login_code, pas school_code", () => {
  const service = new TenantScopeService();
  const rows = [
    { id: "same", schoolCode: "CD-IN-26-001", school_code: "CD-2026-0001" },
    { id: "other", schoolCode: "BI-LB-26-001", school_code: "CD-2026-0001" },
  ];
  const filtered = service.filterRows(rows, {
    role: "Préfet des études",
    schoolCode: "CD-IN-26-001",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "same");
});
