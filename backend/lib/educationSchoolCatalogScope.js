"use strict";

const { resolvePrincipalSchoolCode } = require("./principalSchoolScope");

function resolveEducationCatalogSchoolCode(principal, querySchoolCode) {
  const requested = String(querySchoolCode ?? "").trim().toUpperCase();
  if (requested) return requested;
  return resolvePrincipalSchoolCode(principal);
}

function applyEducationCatalogDeprecationHeaders(res, successorPath = "/api/education-reference/catalog") {
  if (!res || typeof res.set !== "function") return;
  res.set("Deprecation", "true");
  res.set("Link", `<${successorPath}>; rel="successor-version"`);
}

module.exports = {
  resolveEducationCatalogSchoolCode,
  applyEducationCatalogDeprecationHeaders,
};
