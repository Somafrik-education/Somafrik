"use strict";

const { isPlatformScopePrincipal, isSchoolRolePrincipal } = require("./platformScopePrincipal");
const { assertSchoolCanConnect } = require("../services/schoolSubscriptionAccessService");
const { BusinessError } = require("../services/authService");

const SESSION_CLOSING_PATHS = new Set(["/api/auth/logout", "/api/auth/revoke-all"]);

/**
 * Live subscription gate for every authenticated school request.
 * Do not trust a subscription status carried by an already-issued JWT.
 * Only session-closing routes are exempt so the user can log out.
 */
async function assertActiveSchoolRequest(principal, path, loadState) {
  if (SESSION_CLOSING_PATHS.has(path)) return;
  if (isPlatformScopePrincipal(principal) || !isSchoolRolePrincipal(principal)) return;
  const schoolCode = String(principal?.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(403, "Rattachement établissement requis.");
  }
  const state = await loadState();
  assertSchoolCanConnect(schoolCode, state);
}

module.exports = { assertActiveSchoolRequest };
