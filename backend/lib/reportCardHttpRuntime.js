"use strict";

const crypto = require("node:crypto");
const { createAcademicRuleProfilePgStore } = require("../db/academicRuleProfilePgStore");
const { createReportCardSchemaPgStore } = require("../db/reportCardSchemaPgStore");
const { createReportCardConfigurationPgStore } = require("../db/reportCardConfigurationPgStore");
const { createReportCardPublicationPgStore } = require("../db/reportCardPublicationPgStore");
const {
  createReportCardFactsPgStore,
  identitiesFromSnapshot,
  resolveFacts,
  isUndefinedRelation,
} = require("../db/reportCardFactsStore");
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

function createReportCardHttpRuntime(repository, env = process.env, overrides = {}) {
  const db = overrides.db || (repository && repository.pool);
  const profileStore =
    overrides.profileStore || (db ? createAcademicRuleProfilePgStore(db) : null);
  const schemaStore = overrides.schemaStore || (db ? createReportCardSchemaPgStore(db) : null);
  const persistence =
    overrides.configurationPersistence || (db ? createReportCardConfigurationPgStore(db) : null);
  if (!profileStore || !schemaStore) {
    return { configuration: null, publication: null, getFacts: null, getProfile: null, getSchema: null };
  }
  const configuration = createReportCardConfiguration({
    profileStore,
    schemaStore,
    persistence,
  });
  const keys = overrides.keys || loadReportCardHttpCrypto(env);
  let publication = overrides.publication || null;
  if (!publication && keys.signingKey && keys.wrapping) {
    publication = createReportCardPublication({
      signingKey: keys.signingKey,
      wrapping: keys.wrapping,
      wrappingKeys: keys.wrappingKeys || [keys.wrapping],
      signingKeys: keys.signingKeys || [keys.signingKey],
      store: overrides.publicationStore || (db ? createReportCardPublicationPgStore(db) : undefined),
    });
  }
  const factsStore =
    overrides.factsStore || (db ? createReportCardFactsPgStore(db) : null);

  async function getFacts({ tenant, schoolId, reportCardId, sourceVersion } = {}) {
    const sid = schoolId || (tenant && tenant.schoolId);
    if (!factsStore || typeof factsStore.listFacts !== "function") return null;
    if (!publication || reportCardId == null || sourceVersion == null) return null;
    let identities = null;
    try {
      const payload = await Promise.resolve(
        publication.payloadForRender({
          tenant: { schoolId: sid, actorSchoolId: sid },
          reportCardId,
          version: Number(sourceVersion),
        })
      );
      identities = identitiesFromSnapshot(payload);
    } catch {
      return null;
    }
    if (!identities) return null;
    let listed;
    try {
      listed = await Promise.resolve(factsStore.listFacts({ schoolId: sid, reportCardId, sourceVersion }));
    } catch (err) {
      if (isUndefinedRelation(err) || (err && err.code === "FACTS_REQUIRED")) return null;
      throw err;
    }
    return resolveFacts(identities, listed);
  }

  async function getProfile({ tenant, ref } = {}) {
    if (!ref || !configuration || typeof configuration.lookupProfileSpec !== "function") return null;
    return configuration.lookupProfileSpec({
      schoolId: tenant && tenant.schoolId,
      profileId: ref.id,
      version: ref.version,
      specSha256: ref.spec_sha256,
    });
  }

  async function getSchema({ tenant, ref } = {}) {
    if (!ref || !configuration || typeof configuration.lookupSchemaSpec !== "function") return null;
    return configuration.lookupSchemaSpec({
      schoolId: tenant && tenant.schoolId,
      schemaId: ref.id,
      version: ref.version,
      specSha256: ref.spec_sha256,
    });
  }

  return { configuration, publication, getFacts, getProfile, getSchema, factsStore };
}

function createReportCardHttpBindings({
  repository,
  env = process.env,
  createPdf,
  getTemplate,
  resolveActor,
  resolveSchoolId,
  internalAuth,
  logger,
  overrides,
} = {}) {
  let runtime = null;
  function getRuntime() {
    if (!runtime) runtime = createReportCardHttpRuntime(repository, env, overrides);
    return runtime;
  }
  return {
    getConfiguration: () => getRuntime().configuration,
    getPublication: () => getRuntime().publication,
    getPdf: () => {
      const publication = getRuntime().publication;
      if (!publication || typeof createPdf !== "function") return null;
      return createPdf(publication);
    },
    getTemplate:
      typeof getTemplate === "function"
        ? getTemplate
        : ({ tenant, schoolId, templateId, version }) => {
            const configuration = getRuntime().configuration;
            if (!configuration || typeof configuration.lookupRenderingTemplateSpec !== "function") {
              return null;
            }
            const sid = schoolId || (tenant && tenant.schoolId) || tenant;
            return configuration.lookupRenderingTemplateSpec({ schoolId: sid, templateId, version });
          },
    getFacts: (args) => getRuntime().getFacts && getRuntime().getFacts(args),
    getProfile: (args) => getRuntime().getProfile && getRuntime().getProfile(args),
    getSchema: (args) => getRuntime().getSchema && getRuntime().getSchema(args),
    resolveActor,
    resolveSchoolId,
    internalAuth,
    logger,
  };
}

module.exports = {
  createReportCardHttpRuntime,
  createReportCardHttpBindings,
  loadReportCardHttpCrypto,
  HISTORICAL_SIGNING_ENV,
  HISTORICAL_WRAPPING_ENV,
};
