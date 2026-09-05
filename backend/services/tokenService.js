const crypto = require("crypto");
const {
  resolveAccessTokenTtlSeconds,
  resolveRefreshTokenTtlSeconds,
} = require("../lib/authTokenPolicy");

class TokenService {
  constructor({
    issuer = "somafrik-api",
    accessTokenTtlSeconds,
    refreshTokenTtlSeconds,
    secret = process.env.JWT_SECRET || "somafrik-dev-secret-change-me",
    env = process.env,
  } = {}) {
    this.issuer = issuer;
    this.accessTokenTtlSeconds = Number.isFinite(Number(accessTokenTtlSeconds))
      ? Number(accessTokenTtlSeconds)
      : resolveAccessTokenTtlSeconds(env);
    this.refreshTokenTtlSeconds = Number.isFinite(Number(refreshTokenTtlSeconds))
      ? Number(refreshTokenTtlSeconds)
      : resolveRefreshTokenTtlSeconds(env);
    this.secret = secret;
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
      crypto.createHmac("sha256", this.secret).update(signedPart).digest()
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

    const payload = this.decodeJwtJson(encodedPayload, "Charge");

    if (payload.iss !== this.issuer) {
      throw new Error("Emetteur JWT invalide");
    }

    if (payload.typ !== expectedType) {
      throw new Error("Type de token invalide");
    }

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error("Token expire");
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
    const key = crypto.createHash("sha256").update(this.secret).digest();
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
    const key = crypto.createHash("sha256").update(this.secret).digest();
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
      iss: this.issuer,
      iat: now,
      exp: now + ttlSeconds,
    };
    const encodedHeader = this.base64Url(JSON.stringify(header));
    const encodedPayload = this.base64Url(JSON.stringify(completePayload));
    const signature = this.base64Url(
      crypto.createHmac("sha256", this.secret).update(`${encodedHeader}.${encodedPayload}`).digest()
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

module.exports = { TokenService };
