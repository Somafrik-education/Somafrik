"use strict";

const { createAcademicRuleProfilePgStore } = require("../db/academicRuleProfilePgStore");
const { createReportCardSchemaPgStore } = require("../db/reportCardSchemaPgStore");
const { createReportCardConfigurationPgStore } = require("../db/reportCardConfigurationPgStore");
const { createReportCardPublicationPgStore } = require("../db/reportCardPublicationPgStore");
const { createReportCardConfiguration } = require("./reportCard/reportCardConfiguration");
const { createReportCardPublication } = require("./reportCard/reportCardPublication");

function createReportCardHttpRuntime(repository) {
  const db = repository && repository.pool;
  if (!db) {
    return { configuration: null, publication: null };
  }
  const configuration = createReportCardConfiguration({
    profileStore: createAcademicRuleProfilePgStore(db),
    schemaStore: createReportCardSchemaPgStore(db),
    persistence: createReportCardConfigurationPgStore(db),
  });
  let publication = null;
  const pem = process.env.SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM;
  const wrappingB64 = process.env.SOMAFRIK_REPORT_CARD_WRAPPING_KEY_B64;
  if (pem && wrappingB64) {
    const crypto = require("node:crypto");
    const signingKey = {
      signing_key_id: process.env.SOMAFRIK_REPORT_CARD_SIGNING_KEY_ID || "rc-ed25519-1",
      alg: "Ed25519",
      privateKey: crypto.createPrivateKey(pem),
      publicKey: crypto.createPublicKey(pem),
    };
    const wrapping = {
      wrapping_key_id: process.env.SOMAFRIK_REPORT_CARD_WRAPPING_KEY_ID || "rc-wrap-1",
      key: Buffer.from(wrappingB64, "base64"),
    };
    publication = createReportCardPublication({
      signingKey,
      wrapping,
      wrappingKeys: [wrapping],
      signingKeys: [signingKey],
      store: createReportCardPublicationPgStore(db),
    });
  }
  return { configuration, publication };
}

module.exports = { createReportCardHttpRuntime };
