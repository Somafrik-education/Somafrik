import assert from "node:assert/strict";
import { CANONICAL_ENTITY_ROUTES, canonicalRouteForEntity, ADMIN_CRUD_ONLY_ENTITIES } from "./canonicalRouteMap";

assert.equal(canonicalRouteForEntity("users"), "Users");
assert.equal(canonicalRouteForEntity("teachers"), "Teachers");
assert.equal(canonicalRouteForEntity("payments"), "Payments");
assert.equal(canonicalRouteForEntity("schools"), null);
assert.ok(ADMIN_CRUD_ONLY_ENTITIES.includes("schools"));
assert.equal(CANONICAL_ENTITY_ROUTES.announcements, "Announcements");
console.log("canonicalRouteMap.test.ts OK");
