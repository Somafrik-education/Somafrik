/**
 * Idempotence API — évite les doublons sur paiements, présences, notes (sync mobile).
 */
const TTL_MS = 24 * 60 * 60 * 1000;

function normalizeKey(value) {
  return String(value ?? "").trim();
}

class IdempotencyService {
  constructor(repository) {
    this.repository = repository;
    /** @type {Map<string, { routeKey: string, principalId: string, statusCode: number, body: unknown, expiresAt: number }>} */
    this.memory = new Map();
  }

  cacheKey(idempotencyKey, routeKey, principalId = "") {
    return `${normalizeKey(routeKey)}|${normalizeKey(principalId)}|${normalizeKey(idempotencyKey)}`;
  }

  async findReplay(idempotencyKey, routeKey, principalId = "") {
    const key = normalizeKey(idempotencyKey);
    if (!key) return null;

    const cacheId = this.cacheKey(key, routeKey, principalId);
    const memoryHit = this.memory.get(cacheId);
    if (memoryHit && memoryHit.expiresAt > Date.now()) {
      return { statusCode: memoryHit.statusCode, body: memoryHit.body, replay: true };
    }

    if (typeof this.repository.findIdempotencyRecord === "function") {
      const stored = await this.repository.findIdempotencyRecord(cacheId);
      if (stored && new Date(stored.expires_at).getTime() > Date.now()) {
        return {
          statusCode: stored.status_code,
          body: stored.response_body,
          replay: true,
        };
      }
    }

    return null;
  }

  async store(idempotencyKey, routeKey, principalId, statusCode, body) {
    const key = normalizeKey(idempotencyKey);
    if (!key || statusCode < 200 || statusCode >= 300) return;

    const cacheId = this.cacheKey(key, routeKey, principalId);
    const record = {
      routeKey,
      principalId: normalizeKey(principalId),
      statusCode,
      body,
      expiresAt: Date.now() + TTL_MS,
    };
    this.memory.set(cacheId, record);

    if (typeof this.repository.saveIdempotencyRecord === "function") {
      await this.repository.saveIdempotencyRecord({
        cacheId,
        routeKey,
        principalId: normalizeKey(principalId),
        statusCode,
        responseBody: body,
        expiresAt: new Date(record.expiresAt).toISOString(),
      });
    }
  }
}

function readIdempotencyKey(req) {
  return normalizeKey(req.get("Idempotency-Key") ?? req.get("idempotency-key"));
}

async function withIdempotency({ req, res, routeKey, principal, handler }) {
  const idempotencyKey = readIdempotencyKey(req);
  const service = req.app.locals.idempotencyService;

  if (idempotencyKey && service) {
    const replay = await service.findReplay(idempotencyKey, routeKey, principal?.sub);
    if (replay) {
      return res.status(replay.statusCode).json({ ...replay.body, idempotentReplay: true });
    }
  }

  const result = await handler();
  if (idempotencyKey && service && result?.statusCode >= 200 && result.statusCode < 300) {
    await service.store(idempotencyKey, routeKey, principal?.sub, result.statusCode, result.body);
  }
  return res.status(result.statusCode).json(result.body);
}

module.exports = { IdempotencyService, readIdempotencyKey, withIdempotency };
