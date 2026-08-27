/**
 * Idempotence API — une intention logique = une mutation.
 * Réutilise la table PostgreSQL `idempotency_keys` (pas de second mécanisme).
 */
const crypto = require("crypto");
const { getIdempotencyTx } = require("../lib/idempotencyTxContext");

const TTL_DEFAULT_MS = 24 * 60 * 60 * 1000;
const TTL_PAYMENTS_MS = 7 * 24 * 60 * 60 * 1000;
/** TTL ciblé des routes autorisées au replay outbox (présences). Ne pas appliquer au TTL global. */
const TTL_OFFLINE_REPLAY_MS = 35 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED";
const OFFLINE_REPLAY_ROUTE_KEYS = [/^POST \/api\/presences$/i];

function normalizeKey(value) {
  return String(value ?? "").trim();
}

function stableSerialize(value) {
  if (value == null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function hashPayload(body) {
  return crypto.createHash("sha256").update(stableSerialize(logicalPayload(body))).digest("hex");
}

/** Payload logique : ignore le scope client forgé (schoolCode, createdBy, …). */
function logicalPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body ?? null;
  const next = { ...body };
  delete next.schoolId;
  delete next.schoolCode;
  delete next.country;
  delete next.createdBy;
  delete next.triggeredBy;
  return next;
}

let beforeStoreHook = null;
function setIdempotencyBeforeStoreHook(fn) {
  beforeStoreHook = typeof fn === "function" ? fn : null;
}

function ttlForRoute(routeKey) {
  const key = String(routeKey ?? "");
  if (/\/payments(\/|$)/i.test(key)) return TTL_PAYMENTS_MS;
  if (OFFLINE_REPLAY_ROUTE_KEYS.some((pattern) => pattern.test(key))) return TTL_OFFLINE_REPLAY_MS;
  return TTL_DEFAULT_MS;
}

function lockInt(cacheId) {
  const digest = crypto.createHash("sha256").update(String(cacheId)).digest();
  return digest.readInt32BE(0);
}

function createIdempotencyConflictError() {
  const error = new Error("Idempotency-Key déjà utilisée avec un payload différent.");
  error.statusCode = 409;
  error.code = IDEMPOTENCY_KEY_REUSED;
  return error;
}

class IdempotencyService {
  constructor(repository) {
    this.repository = repository;
    /** @type {Map<string, { requestHash: string, statusCode: number, body: unknown, expiresAt: number }>} */
    this.memory = new Map();
    /** @type {Map<string, Promise<void>>} */
    this.locks = new Map();
  }

  cacheKey(idempotencyKey, routeKey, principalId = "", schoolScope = "") {
    return [
      normalizeKey(routeKey),
      normalizeKey(schoolScope).toUpperCase(),
      normalizeKey(principalId),
      normalizeKey(idempotencyKey),
    ].join("|");
  }

  async findReplay(idempotencyKey, routeKey, principalId = "", schoolScope = "") {
    const key = normalizeKey(idempotencyKey);
    if (!key) return null;
    const cacheId = this.cacheKey(key, routeKey, principalId, schoolScope);
    if (!getIdempotencyTx()) {
      const memoryHit = this.memory.get(cacheId);
      if (memoryHit && memoryHit.expiresAt > Date.now()) {
        return {
          statusCode: memoryHit.statusCode,
          body: memoryHit.body,
          requestHash: memoryHit.requestHash,
          replay: true,
        };
      }
    }

    if (typeof this.repository.findIdempotencyRecord === "function") {
      const stored = await this.repository.findIdempotencyRecord(cacheId);
      if (stored && new Date(stored.expires_at).getTime() > Date.now()) {
        return {
          statusCode: stored.status_code,
          body: stored.response_body,
          requestHash: stored.request_hash || "",
          replay: true,
        };
      }
    }
    return null;
  }

  async store(idempotencyKey, routeKey, principalId, schoolScope, requestHash, statusCode, body) {
    const key = normalizeKey(idempotencyKey);
    if (!key || statusCode < 200 || statusCode >= 300) return;
    const cacheId = this.cacheKey(key, routeKey, principalId, schoolScope);
    const record = {
      requestHash: normalizeKey(requestHash),
      statusCode,
      body,
      expiresAt: Date.now() + ttlForRoute(routeKey),
    };
    if (typeof this.repository.saveIdempotencyRecord === "function") {
      await this.repository.saveIdempotencyRecord({
        cacheId,
        routeKey,
        principalId: normalizeKey(principalId),
        schoolScope: normalizeKey(schoolScope).toUpperCase(),
        requestHash: record.requestHash,
        statusCode,
        responseBody: body,
        expiresAt: new Date(record.expiresAt).toISOString(),
      });
    }
    if (!getIdempotencyTx()) {
      this.memory.set(cacheId, record);
      if (typeof this.repository.purgeExpiredIdempotencyRecords === "function") {
        await this.repository.purgeExpiredIdempotencyRecords().catch(() => undefined);
      }
    }
  }

  async withLock(idempotencyKey, routeKey, principalId, schoolScope, fn) {
    const cacheId = this.cacheKey(idempotencyKey, routeKey, principalId, schoolScope);
    if (typeof this.repository.withIdempotencyLock === "function") {
      return this.repository.withIdempotencyLock(cacheId, fn);
    }
    const previous = this.locks.get(cacheId) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    this.locks.set(cacheId, previous.then(() => gate));
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

function readIdempotencyKey(req) {
  return normalizeKey(req.get("Idempotency-Key") ?? req.get("idempotency-key"));
}

async function withIdempotency({ req, res, routeKey, principal, handler }) {
  const idempotencyKey = readIdempotencyKey(req);
  const service = req.app?.locals?.idempotencyService;
  const schoolScope = String(principal?.schoolCode ?? "").trim().toUpperCase();
  const principalId = String(principal?.sub ?? principal?.id ?? "");
  const requestHash = hashPayload(req.body);

  const runHandler = async () => {
    const result = await handler();
    return result;
  };

  if (!idempotencyKey || !service) {
    const result = await runHandler();
    return res.status(result.statusCode).json(result.body);
  }

  const execute = async () => {
    const replay = await service.findReplay(idempotencyKey, routeKey, principalId, schoolScope);
    if (replay) {
      if (replay.requestHash && replay.requestHash !== requestHash) {
        throw createIdempotencyConflictError();
      }
      return {
        statusCode: replay.statusCode,
        body: attachReplayFlag(replay.body),
      };
    }
    const result = await runHandler();
    if (result?.statusCode >= 200 && result.statusCode < 300) {
      if (beforeStoreHook) await beforeStoreHook();
      await service.store(
        idempotencyKey,
        routeKey,
        principalId,
        schoolScope,
        requestHash,
        result.statusCode,
        result.body,
      );
    }
    return result;
  };

  const cacheId = service.cacheKey(idempotencyKey, routeKey, principalId, schoolScope);
  const result =
    typeof service.repository?.withIdempotencyTransaction === "function"
      ? await service.repository.withIdempotencyTransaction(cacheId, execute)
      : await service.withLock(idempotencyKey, routeKey, principalId, schoolScope, execute);
  if (result?.statusCode >= 200 && result.statusCode < 300 && !getIdempotencyTx()) {
    const replayBody =
      result.body && typeof result.body === "object" && !Array.isArray(result.body) && result.body.idempotentReplay
        ? Object.fromEntries(Object.entries(result.body).filter(([key]) => key !== "idempotentReplay"))
        : result.body;
    service.memory.set(cacheId, {
      requestHash,
      statusCode: result.statusCode,
      body: replayBody,
      expiresAt: Date.now() + ttlForRoute(routeKey),
    });
  }
  return res.status(result.statusCode).json(result.body);
}

function attachReplayFlag(body) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return { ...body, idempotentReplay: true };
  }
  return body;
}

module.exports = {
  IdempotencyService,
  readIdempotencyKey,
  withIdempotency,
  hashPayload,
  logicalPayload,
  stableSerialize,
  IDEMPOTENCY_KEY_REUSED,
  lockInt,
  ttlForRoute,
  setIdempotencyBeforeStoreHook,
  TTL_DEFAULT_MS,
  TTL_PAYMENTS_MS,
  TTL_OFFLINE_REPLAY_MS,
};
