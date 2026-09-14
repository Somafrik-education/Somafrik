"use strict";

const crypto = require("node:crypto");
const { createAcademicRuleProfilePgStore } = require("../db/academicRuleProfilePgStore");
const { createReportCardSchemaPgStore } = require("../db/reportCardSchemaPgStore");
const { createReportCardConfigurationPgStore } = require("../db/reportCardConfigurationPgStore");
const { createReportCardPublicationPgStore } = require("../db/reportCardPublicationPgStore");
const { createReportCardConfiguration } = require("./reportCard/reportCardConfiguration");
const { createReportCardPublication } = require("./reportCard/reportCardPublication");

const HISTORICAL_SIGNING_ENV = "SOMAFRIK_REPORT_CARD_SIGNING_HISTORICAL_PUBLIC_KEYS_JSON";
const HISTORICAL_WRAPPING_ENV = "SOMAFRIK_REPORT_CARD_WRAPPING_HISTORICAL_KEYS_JSON";

function parseJsonArray(raw, envName) {
  if (raw == null || String(raw).trim() === "") return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error(`${envName}_INVALID`);
    err.code = "SIGNING_KEY_RING_INVALID";
    throw err;
  }
  if (!Array.isArray(parsed)) {
    const err = new Error(`${envName}_INVALID`);
    err.code = "SIGNING_KEY_RING_INVALID";
    throw err;
  }
  return parsed;
}

function parseHistoricalSigningPublicKeys(raw) {
  const items = parseJsonArray(raw, HISTORICAL_SIGNING_ENV);
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || !item.signing_key_id || !item.publicKeyPem) {
      const err = new Error(`${HISTORICAL_SIGNING_ENV}_INVALID`);
      err.code = "SIGNING_KEY_RING_INVALID";
      err.index = index;
      throw err;
    }
    return {
      signing_key_id: String(item.signing_key_id),
      alg: "Ed25519",
      publicKey: crypto.createPublicKey(item.publicKeyPem),
    };
  });
}

function parseHistoricalWrappingKeys(raw) {
  const items = parseJsonArray(raw, HISTORICAL_WRAPPING_ENV);
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || !item.wrapping_key_id || !item.keyB64) {
      const err = new Error(`${HISTORICAL_WRAPPING_ENV}_INVALID`);
      err.code = "SIGNING_KEY_RING_INVALID";
      err.index = index;
      throw err;
    }
    return {
      wrapping_key_id: String(item.wrapping_key_id),
      key: Buffer.from(String(item.keyB64), "base64"),
    };
  });
}

function loadReportCardHttpCrypto(env = process.env) {
  const pem = env.SOMAFRIK_REPORT_CARD_SIGNING_PRIVATE_KEY_PEM;
  const wrappingB64 = env.SOMAFRIK_REPORT_CARD_WRAPPING_KEY_B64;
  if (!pem || !wrappingB64) {
    return { signingKey: null, wrapping: null, signingKeys: [], wrappingKeys: [] };
  }
  const signingKey = {
    signing_key_id: env.SOMAFRIK_REPORT_CARD_SIGNING_KEY_ID || "rc-ed25519-1",
    alg: "Ed25519",
    privateKey: crypto.createPrivateKey(pem),
    publicKey: crypto.createPublicKey(pem),
  };
  const wrapping = {
    wrapping_key_id: env.SOMAFRIK_REPORT_CARD_WRAPPING_KEY_ID || "rc-wrap-1",
    key: Buffer.from(wrappingB64, "base64"),
  };
  const historicalSigning = parseHistoricalSigningPublicKeys(env[HISTORICAL_SIGNING_ENV]);
  const signingKeys = [signingKey];
  const seenSigning = new Set([signingKey.signing_key_id]);
  for (const historical of historicalSigning) {
    if (seenSigning.has(historical.signing_key_id)) continue;
    signingKeys.push(historical);
    seenSigning.add(historical.signing_key_id);
  }
  const historicalWrapping = parseHistoricalWrappingKeys(env[HISTORICAL_WRAPPING_ENV]);
  const wrappingKeys = [wrapping];
  const seenWrapping = new Set([wrapping.wrapping_key_id]);
  for (const historical of historicalWrapping) {
    if (seenWrapping.has(historical.wrapping_key_id)) continue;
    wrappingKeys.push(historical);
    seenWrapping.add(historical.wrapping_key_id);
  }
  return { signingKey, wrapping, signingKeys, wrappingKeys };
}

function createReportCardHttpRuntime(repository, env = process.env) {
  const db = repository && repository.pool;
  if (!db) {
    return { configuration: null, publication: null };
  }
  const configuration = createReportCardConfiguration({
    profileStore: createAcademicRuleProfilePgStore(db),
    schemaStore: createReportCardSchemaPgStore(db),
    persistence: createReportCardConfigurationPgStore(db),
  });
  const keys = loadReportCardHttpCrypto(env);
  let publication = null;
  if (keys.signingKey && keys.wrapping) {
    publication = createReportCardPublication({
      signingKey: keys.signingKey,
      wrapping: keys.wrapping,
      wrappingKeys: keys.wrappingKeys,
      signingKeys: keys.signingKeys,
      store: createReportCardPublicationPgStore(db),
    });
  }
  return { configuration, publication };
}

module.exports = {
  createReportCardHttpRuntime,
  loadReportCardHttpCrypto,
  HISTORICAL_SIGNING_ENV,
  HISTORICAL_WRAPPING_ENV,
};
