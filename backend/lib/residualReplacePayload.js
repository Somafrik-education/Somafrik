"use strict";

const { BusinessError } = require("../services/authService");

const RESIDUAL_FIELD_BY_ROUTE = Object.freeze({
  exams: "exams",
  bulletins: "bulletins",
  documents: "documents",
});

function assertResidualReplacePayload(body, fieldName) {
  const key = RESIDUAL_FIELD_BY_ROUTE[fieldName] ?? fieldName;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BusinessError(400, `Corps de requête invalide : le champ « ${key} » doit être un tableau.`);
  }
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    throw new BusinessError(400, `Champ obligatoire manquant : « ${key} ».`);
  }
  if (!Array.isArray(body[key])) {
    throw new BusinessError(400, `Le champ « ${key} » doit être un tableau.`);
  }

  for (let index = 0; index < body[key].length; index += 1) {
    const item = body[key][index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new BusinessError(400, `Élément ${index + 1} de « ${key} » invalide.`);
    }
    const id = String(item.id ?? "").trim();
    if (!id) {
      throw new BusinessError(400, `Identifiant obligatoire pour l'élément ${index + 1} de « ${key} ».`);
    }
  }

  return body[key];
}

module.exports = {
  RESIDUAL_FIELD_BY_ROUTE,
  assertResidualReplacePayload,
};
