"use strict";

const assert = require("node:assert/strict");
const { createRateLimiter } = require("./rateLimit");

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function main() {
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 2,
    keyFn: (req) => `push-selftest:${req.principal.sub}`,
    message: "Trop de tests push. Réessayez dans une minute.",
  });
  const req = { principal: { sub: "user-a" } };
  let nextCount = 0;
  const next = () => {
    nextCount += 1;
  };

  limiter(req, mockRes(), next);
  limiter(req, mockRes(), next);
  const blocked = mockRes();
  const result = limiter(req, blocked, next);
  assert.equal(blocked.statusCode, 429);
  assert.equal(nextCount, 2);
  assert.equal(blocked.body.message.includes("tests push"), true);
  assert.equal(result, blocked);

  const other = mockRes();
  limiter({ principal: { sub: "user-b" } }, other, next);
  assert.equal(nextCount, 3, "le quota est par utilisateur");

  console.log("rateLimit.push-selftest.test.js OK");
}

main();
