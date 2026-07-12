const crypto = require("crypto");

class TokenService {
  constructor({
    issuer = "somafrik-api",
    accessTokenTtlSeconds = Number(process.env.JWT_ACCESS_TTL_SECONDS || 8 * 60 * 60),
    refreshTokenTtlSeconds = 7 * 24 * 60 * 60,
    secret = process.env.JWT_SECRET || "somafrik-dev-secret-change-me",
  } = {}) {
    this.issuer = issuer;
    this.accessTokenTtlSeconds = Number(accessTokenTtlSeconds);
    this.refreshTokenTtlSeconds = Number(refreshTokenTtlSeconds);
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

  createRefreshToken(subject) {
    const sessionId = crypto.randomUUID();
    const token = this.sign(
      {
        sub: subject.sub,
        sessionId,
        role: subject.role,
        schoolCode: subject.schoolCode,
        countryCode: subject.countryCode,
        authSource: subject.authSource,
        identifier: subject.identifier,
        publicId: subject.publicId,
        typ: "refresh",
      },
      this.refreshTokenTtlSeconds
    );

    return {
      token,
      sessionId,
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

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

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

  hashToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
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
