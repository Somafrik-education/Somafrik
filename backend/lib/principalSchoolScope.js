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

function scopeResidualItems(schoolCode, items = []) {
  const scopedSchoolCode = String(schoolCode ?? "")
    .trim()
    .toUpperCase();
  if (!scopedSchoolCode || scopedSchoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }

  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    const itemSchoolCode = String(item?.schoolCode ?? "")
      .trim()
      .toUpperCase();
    if (itemSchoolCode && itemSchoolCode !== scopedSchoolCode) {
      throw new BusinessError(
        400,
        `Élément hors périmètre établissement (${itemSchoolCode} ≠ ${scopedSchoolCode}).`,
      );
    }
  }

  return list.map((item) => ({
    ...(item && typeof item === "object" ? item : {}),
    schoolCode: scopedSchoolCode,
  }));
}

module.exports = {
  resolvePrincipalSchoolCode,
  stripClientSchoolCode,
  scopeResidualItems,
};
