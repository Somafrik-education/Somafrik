"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePath,
  safeForwardHeaders,
  shouldFaultRequest,
} = require("./mobile-e2e-fault-proxy");

test("fault proxy targets users GET only by default", () => {
  assert.equal(
    shouldFaultRequest({ method: "GET", url: "/api/backoffice/users?limit=50" }),
    true,
  );
  assert.equal(
    shouldFaultRequest({ method: "POST", url: "/api/backoffice/users" }),
    false,
  );
  assert.equal(
    shouldFaultRequest({ method: "GET", url: "/api/payments" }),
    false,
  );
});

test("fault path is explicit and exact", () => {
  assert.equal(normalizePath("api/teachers"), "/api/teachers");
  assert.equal(
    shouldFaultRequest(
      { method: "GET", url: "/api/teachers" },
      { failPath: "/api/teachers", failMethod: "GET" },
    ),
    true,
  );
  assert.equal(
    shouldFaultRequest(
      { method: "GET", url: "/api/teachers/abc" },
      { failPath: "/api/teachers", failMethod: "GET" },
    ),
    false,
  );
});

test("forwarded headers do not preserve transport-specific host metadata", () => {
  const headers = safeForwardHeaders({
    host: "10.0.2.2:5055",
    connection: "keep-alive",
    "content-length": "123",
    "accept-encoding": "gzip",
    authorization: "Bearer token",
    "x-somafrik-school-code": "BI-EC-26-001",
  });
  assert.equal(headers.host, undefined);
  assert.equal(headers.connection, undefined);
  assert.equal(headers["content-length"], undefined);
  assert.equal(headers["accept-encoding"], undefined);
  assert.equal(headers.authorization, "Bearer token");
  assert.equal(headers["x-somafrik-school-code"], "BI-EC-26-001");
});
