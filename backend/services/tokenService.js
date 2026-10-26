const crypto = require("crypto");
const {
  MAX_ACCESS_TOKEN_LIFETIME_SECONDS,
  resolveAccessTokenTtlSeconds,
  resolveRefreshTokenTtlSeconds,
} = require("../lib/authTokenPolicy");

/** SEC-JWT-01a — audience des jetons d'accès (émise et exigée). */
const ACCESS_TOKEN_AUDIENCE = "somafrik-api";
/** Tolérance d'horloge explicite pour iat / nbf (secondes), strictement bornée. */
const CLOCK_SKEW_SECONDS = 60;
/** Mode HS256 : seuls ces paramètres d'en-tête sont admis (kid, jku, x5u, jwk, x5c, crit… refusés). */
const ALLOWED_HEADER_PARAMS = new Set(["alg", "typ"]);

/**
 * SEC-JWT-01a — aucun secret public de repli. JWT_SECRET absent :
 * - production : refus (en plus du contrôle de démarrage assertProductionSecrets) ;
 * - ailleurs : secret aléatoire éphémère propre au processus (jetons invalides au
 *   redémarrage). Les tests reproductibles et les déploiements multi-instance
 *   doivent définir JWT_SECRET explicitement.
 */
let ephemeralDevelopmentSecret = null;
function resolveSigningSecret(env = process.env) {
  const configured = String(env.JWT_SECRET ?? "");
  if (configured) return configured;
  // Production : aucun secret → aucune signature ni vérification (requireSecret) ;
  // le démarrage est refusé par assertProductionSecrets avec la liste complète.
  if (String(env.NODE_ENV ?? "").trim().toLowerCase() === "production") return null;
  if (!ephemeralDevelopmentSecret) {
    ephemeralDevelopmentSecret = crypto.randomBytes(48).toString("base64url");
  }
  return ephemeralDevelopmentSecret;
}

function isIntegerSeconds(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

class TokenService {
  constructor({
    issuer = "somafrik-api",
    accessTokenTtlSeconds,
    refreshTokenTtlSeconds,
    secret,
    env = process.env,
  } = {}) {
    this.issuer = issuer;
    this.audience = ACCESS_TOKEN_AUDIENCE;
    this.accessTokenTtlSeconds = Number.isFinite(Number(accessTokenTtlSeconds))
      ? Number(accessTokenTtlSeconds)
      : resolveAccessTokenTtlSeconds(env);
    this.refreshTokenTtlSeconds = Number.isFinite(Number(refreshTokenTtlSeconds))
      ? Number(refreshTokenTtlSeconds)
      : resolveRefreshTokenTtlSeconds(env);
    this.secret = secret || resolveSigningSecret(env);
  }

  requireSecret() {
    if (!this.secret) throw new Error("JWT_SECRET est obligatoire en production.");
    return this.secret;
  }

  createAccessToken(subject) {
    return this.sign(
      {
        ...subject,
        typ: "access",
      },
      this.accessTokenTtlSeconds
    );
  }

  createRefreshToken(subject, { sessionId } = {}) {
    const resolvedSessionId = sessionId || crypto.randomUUID();
    const token = this.sign(
      {
        sub: subject.sub,
        sessionId: resolvedSessionId,
        role: subject.role,
        schoolCode: subject.schoolCode,
        countryCode: subject.countryCode,
        authSource: subject.authSource,
        identifier: subject.identifier,
        publicId: subject.publicId,
        jti: crypto.randomUUID(),
        typ: "refresh",
      },
      this.refreshTokenTtlSeconds
    );

    return {
      token,
      sessionId: resolvedSessionId,
      expiresAt: new Date(Date.now() + this.refreshTokenTtlSeconds * 1000),
    };
  }

  verify(token, expectedType = "access") {
    const [encodedHeader, encodedPayload, signature] = String(token ?? "").split(".");

    if (!encodedHeader || !encodedPayload || !signature) {
      throw new Error("Token JWT invalide");
    }

    const signedPart = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = this.base64Url(
      crypto.createHmac("sha256", this.requireSecret()).update(signedPart).digest()
    );

    const actual = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw new Error("Signature JWT invalide");
    }

    const header = this.decodeJwtJson(encodedHeader, "En-tête");
    if (!Object.prototype.hasOwnProperty.call(header, "alg") || header.alg !== "HS256") {
      throw new Error("Algorithme JWT invalide");
    }
    if (!Object.prototype.hasOwnProperty.call(header, "typ") || header.typ !== "JWT") {
      throw new Error("Type d'en-tête JWT invalide");
    }
    // SEC-JWT-01a : politique fermée — la clé n'est jamais désignée par le jeton.
    for (const param of Object.keys(header)) {
      if (!ALLOWED_HEADER_PARAMS.has(param)) {
        throw new Error("Paramètre d'en-tête JWT non autorisé");
      }
    }

    const payload = this.decodeJwtJson(encodedPayload, "Charge");

    if (payload.iss !== this.issuer) {
      throw new Error("Emetteur JWT invalide");
    }

    if (payload.typ !== expectedType) {
      throw new Error("Type de token invalide");
    }

    // SEC-JWT-01a : exp et iat obligatoires et numériques pour tout jeton signé
    // (accès, refresh, curseur) ; tous les jetons émis par sign() les portent déjà.
    if (!isIntegerSeconds(payload.exp) || !isIntegerSeconds(payload.iat)) {
      throw new Error("Validité JWT invalide");
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new Error("Token expire");
    }
    if (payload.iat > now + CLOCK_SKEW_SECONDS) {
      throw new Error("Emission JWT dans le futur");
    }
    if (Object.prototype.hasOwnProperty.call(payload, "nbf")) {
      if (!isIntegerSeconds(payload.nbf) || payload.nbf > now + CLOCK_SKEW_SECONDS) {
        throw new Error("Token pas encore valide");
      }
    }

    if (expectedType === "access") {
      if (payload.exp - payload.iat > MAX_ACCESS_TOKEN_LIFETIME_SECONDS) {
        throw new Error("Duree de vie JWT excessive");
      }
      // Audience exacte (chaîne) : un jeton d'accès sans aud (émis avant SEC-JWT-01a)
      // est refusé ; les clients le renouvellent par refresh.
      if (payload.aud !== this.audience) {
        throw new Error("Audience JWT invalide");
      }
    }

    return payload;
  }

  decodeJwtJson(encoded, label) {
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new Error(`${label} JWT invalide`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} JWT invalide`);
    }
    return parsed;
  }

  hashToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
  }

  sealRefreshToken(token) {
    const key = crypto.createHash("sha256").update(this.requireSecret()).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(String(token), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${this.base64Url(iv)}.${this.base64Url(encrypted)}.${this.base64Url(tag)}`;
  }

  openRefreshToken(sealed) {
    const parts = String(sealed ?? "").split(".");
    if (parts.length !== 4 || parts[0] !== "v1") {
      throw new Error("Jeton de grâce invalide");
    }
    const key = crypto.createHash("sha256").update(this.requireSecret()).digest();
    const iv = Buffer.from(parts[1], "base64url");
    const encrypted = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  sign(payload, ttlSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT" };
    const completePayload = {
      ...payload,
      // SEC-JWT-01a : audience imposée par le serveur pour les jetons d'accès.
      ...(payload?.typ === "access" ? { aud: this.audience } : {}),
      iss: this.issuer,
      iat: now,
      exp: now + ttlSeconds,
    };
    const encodedHeader = this.base64Url(JSON.stringify(header));
    const encodedPayload = this.base64Url(JSON.stringify(completePayload));
    const signature = this.base64Url(
      crypto.createHmac("sha256", this.requireSecret()).update(`${encodedHeader}.${encodedPayload}`).digest()
    );

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  base64Url(value) {
    return Buffer.from(value)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  }
}

module.exports = { TokenService, ACCESS_TOKEN_AUDIENCE, CLOCK_SKEW_SECONDS };
