"use strict";

const { BusinessError } = require("../services/authService");

function resolvePrincipalSchoolCode(principal) {
  const schoolCode = String(principal?.schoolCode ?? "").trim().toUpperCase();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  return schoolCode;
}

function stripClientSchoolCode(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const { schoolCode: _ignored, ...rest } = payload;
  return rest;
}

module.exports = {
  resolvePrincipalSchoolCode,
  stripClientSchoolCode,
};
