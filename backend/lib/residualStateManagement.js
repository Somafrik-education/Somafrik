"use strict";

const DOMAIN_TO_RECORD = Object.freeze({
  exam: "exam",
  exams: "exam",
  bulletin: "bulletin",
  bulletins: "bulletin",
  document: "document",
  documents: "document",
});

function normalizeDomain(domain) {
  return DOMAIN_TO_RECORD[domain] ?? domain;
}

async function recordResidualReplace(_repository, domain) {
  const { assertLegacyResidualWriteForbidden } = require("./documentsExamsManagement");
  assertLegacyResidualWriteForbidden(domain);
}

module.exports = {
  DOMAIN_TO_RECORD,
  normalizeDomain,
  recordResidualReplace,
};
