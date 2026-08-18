"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  isUuid,
  uuidOrNull,
  resolvePrincipalSub,
  grantedByUserId,
} = require("./principalIdentity");

const PG_USER_ID = "550e8400-e29b-41d4-a716-446655440099";

assert.equal(isUuid(PG_USER_ID), true);
assert.equal(isUuid("actor-1"), false);
assert.equal(isUuid("anonymous"), false);
assert.equal(isUuid("USER-T1"), false);
assert.equal(uuidOrNull("actor-1"), null);
assert.equal(uuidOrNull(PG_USER_ID), PG_USER_ID);

assert.equal(resolvePrincipalSub({ id: PG_USER_ID, publicId: "USR-1" }), PG_USER_ID);
assert.equal(isUuid(resolvePrincipalSub({ id: PG_USER_ID })), true);
assert.equal(resolvePrincipalSub({ id: "USER-T1" }), "USER-T1");
assert.equal(resolvePrincipalSub({ publicId: "CD-IN-EL-26-001" }), "CD-IN-EL-26-001");
assert.equal(resolvePrincipalSub({}), "anonymous");

assert.equal(grantedByUserId({ sub: PG_USER_ID }), PG_USER_ID);
assert.equal(grantedByUserId({ sub: "actor-1" }), null);
assert.equal(grantedByUserId({ sub: "USER-T1" }), null);
assert.equal(grantedByUserId({ sub: "anonymous" }), null);
assert.equal(grantedByUserId({}), null);

const serverSrc = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
assert.match(serverSrc, /resolvePrincipalSub/);
assert.match(serverSrc, /sub:\s*resolvePrincipalSub\(user\)/);

const parentLinkingSrc = fs.readFileSync(path.join(__dirname, "./parentLinking.js"), "utf8");
assert.match(parentLinkingSrc, /grantedByUserId/);
assert.match(parentLinkingSrc, /grantedBy:\s*grantedByUserId\(principal\)/);

const pgStoreSrc = fs.readFileSync(path.join(__dirname, "../db/clientsPgStore.js"), "utf8");
assert.match(pgStoreSrc, /uuidOrNull\(row\.grantedBy\)/);
assert.match(pgStoreSrc, /uuidOrNull\(entry\.userId\)/);

const schemaSql = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS users \([\s\S]*?\bid UUID PRIMARY KEY/);
assert.match(schemaSql, /granted_by UUID REFERENCES users\(id\)/);
assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS audit_logs \([\s\S]*?\buser_id UUID REFERENCES users\(id\)/);

console.log("principalIdentity.test.js OK");
