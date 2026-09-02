import assert from "node:assert/strict";
import test from "node:test";

import { AUTHORIZATION_DECISION } from "../../../packages/auth/src/index.js";
import { authorizationDecisionToHttpStatus } from "../src/index.js";

test("maps AUTHORIZED UNAUTHENTICATED and FORBIDDEN to exact HTTP statuses", () => {
  assert.equal(
    authorizationDecisionToHttpStatus(AUTHORIZATION_DECISION.AUTHORIZED),
    200,
  );
  assert.equal(
    authorizationDecisionToHttpStatus(AUTHORIZATION_DECISION.UNAUTHENTICATED),
    401,
  );
  assert.equal(
    authorizationDecisionToHttpStatus(AUTHORIZATION_DECISION.FORBIDDEN),
    403,
  );
});

test("maps every unknown or invalid decision to 401 fail-closed", () => {
  assert.equal(authorizationDecisionToHttpStatus("AUTHORIZED"), 401);
  assert.equal(authorizationDecisionToHttpStatus("authorized "), 401);
  assert.equal(authorizationDecisionToHttpStatus("FORBIDDEN"), 401);
  assert.equal(authorizationDecisionToHttpStatus("Forbidden"), 401);
  assert.equal(authorizationDecisionToHttpStatus("unknown"), 401);
  assert.equal(authorizationDecisionToHttpStatus(""), 401);
  assert.equal(authorizationDecisionToHttpStatus(null), 401);
  assert.equal(authorizationDecisionToHttpStatus(undefined), 401);
  assert.equal(authorizationDecisionToHttpStatus(200), 401);
  assert.equal(authorizationDecisionToHttpStatus(true), 401);
  assert.equal(authorizationDecisionToHttpStatus({}), 401);
  assert.equal(authorizationDecisionToHttpStatus([]), 401);
});

test("never throws on hostile objects or proxies", () => {
  let getterCalls = 0;
  const hostile = {
    get value() {
      getterCalls += 1;
      throw new Error("hostile getter");
    },
  };
  assert.equal(authorizationDecisionToHttpStatus(hostile), 401);
  assert.equal(getterCalls, 0);

  const hostileProxy = new Proxy(
    {},
    {
      get() {
        throw new Error("hostile proxy");
      },
      ownKeys() {
        throw new Error("hostile proxy");
      },
    },
  );
  assert.equal(authorizationDecisionToHttpStatus(hostileProxy), 401);
});

test("reuses AUTHORIZATION_DECISION values without granting an implicit 200", () => {
  assert.equal(AUTHORIZATION_DECISION.AUTHORIZED, "authorized");
  assert.equal(AUTHORIZATION_DECISION.UNAUTHENTICATED, "unauthenticated");
  assert.equal(AUTHORIZATION_DECISION.FORBIDDEN, "forbidden");

  assert.equal(authorizationDecisionToHttpStatus("ok"), 401);
  assert.equal(authorizationDecisionToHttpStatus("success"), 401);
  assert.equal(authorizationDecisionToHttpStatus("allow"), 401);
  assert.notEqual(authorizationDecisionToHttpStatus(null), 200);
});

test("ignores Object.prototype pollution without widening access", () => {
  const hadAuthorized = Object.hasOwn(Object.prototype, "authorized");
  const previousAuthorized = Object.prototype.authorized;

  Object.prototype.authorized = 200;

  try {
    assert.equal(
      authorizationDecisionToHttpStatus(AUTHORIZATION_DECISION.AUTHORIZED),
      200,
    );
    assert.equal(authorizationDecisionToHttpStatus("unknown"), 401);
    assert.equal(authorizationDecisionToHttpStatus("toString"), 401);
  } finally {
    if (hadAuthorized) Object.prototype.authorized = previousAuthorized;
    else delete Object.prototype.authorized;
  }
});
