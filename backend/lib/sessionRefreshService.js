"use strict";

const { BusinessError } = require("../services/authService");
const { REFRESH_REUSE_GRACE_MS } = require("./authTokenPolicy");

function unauthorized(message, code) {
  const error = new BusinessError(401, message);
  error.code = code;
  return error;
}

function sessionUserId(session) {
  return session?.user_id ?? session?.userId ?? null;
}

function hashOf(session, key) {
  return String(session?.[key] ?? "").trim();
}

function rotatedAtMs(session) {
  const raw = session?.refresh_rotated_at ?? session?.refreshRotatedAt;
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isExpired(session, nowMs) {
  const expires = session?.expires_at ?? session?.expiresAt;
  if (!expires) return false;
  return new Date(expires).getTime() <= nowMs;
}

function sealedCurrentRefresh(session) {
  return session?.refresh_token_grace ?? session?.refreshTokenGrace ?? "";
}

function currentRefreshForGrace(tokenService, session, currentHash) {
  try {
    const opened = tokenService.openRefreshToken(sealedCurrentRefresh(session));
    if (opened && tokenService.hashToken(opened) === currentHash) {
      return opened;
    }
  } catch {
    // Grâce sans jeton courant reconstitutable : ne jamais renvoyer l'ancien.
  }
  return null;
}

async function rotateRefreshSession({
  repository,
  tokenService,
  refreshToken,
  now = Date.now(),
  graceMs = REFRESH_REUSE_GRACE_MS,
}) {
  let payload;
  try {
    payload = tokenService.verify(refreshToken, "refresh");
  } catch (error) {
    throw unauthorized("Session expirée ou révoquée", "REFRESH_INVALID");
  }

  const presentedHash = tokenService.hashToken(refreshToken);
  const sessionId = String(payload.sessionId ?? "").trim();
  if (!sessionId || typeof repository.findSessionByCode !== "function") {
    throw unauthorized("Session expirée ou révoquée", "SESSION_NOT_FOUND");
  }

  const session = await repository.findSessionByCode(sessionId);
  if (!session) {
    throw unauthorized("Session expirée ou révoquée", "SESSION_NOT_FOUND");
  }
  if (session.revoked_at || isExpired(session, now)) {
    throw unauthorized("Session expirée ou révoquée", "SESSION_REVOKED");
  }

  const currentHash = hashOf(session, "refresh_token_hash");
  const previousHash = hashOf(session, "previous_refresh_token_hash");
  const matchesCurrent = currentHash && currentHash === presentedHash;
  const inGrace =
    previousHash &&
    previousHash === presentedHash &&
    rotatedAtMs(session) > 0 &&
    now - rotatedAtMs(session) < graceMs;

  if (!matchesCurrent && previousHash === presentedHash && !inGrace) {
    if (typeof repository.revokeAllSessionsForUser === "function") {
      await repository.revokeAllSessionsForUser(sessionUserId(session), "refresh_reuse");
    } else {
      await repository.revokeSession(sessionId, "refresh_reuse");
    }
    throw unauthorized("Session expirée ou révoquée", "REFRESH_REUSE_DETECTED");
  }

  if (!matchesCurrent && !inGrace) {
    throw unauthorized("Session expirée ou révoquée", "SESSION_REVOKED");
  }

  if (inGrace) {
    const currentToken = currentRefreshForGrace(tokenService, session, currentHash);
    if (!currentToken) {
      throw unauthorized("Session expirée ou révoquée", "SESSION_REVOKED");
    }
    return {
      refreshToken: currentToken,
      rotated: false,
      session,
      payload,
    };
  }

  const nextRefresh = tokenService.createRefreshToken(
    {
      sub: payload.sub ?? sessionUserId(session),
      role: session.role ?? payload.role,
      schoolCode: session.school_code ?? payload.schoolCode,
      countryCode: session.country_code ?? payload.countryCode,
      authSource: payload.authSource,
      identifier: payload.identifier,
      publicId: payload.publicId,
    },
    { sessionId },
  );

  await repository.rotateSessionRefresh({
    sessionId,
    newHash: tokenService.hashToken(nextRefresh.token),
    previousHash: presentedHash,
    expiresAt: nextRefresh.expiresAt,
    refreshTokenGrace: tokenService.sealRefreshToken(nextRefresh.token),
  });

  return {
    refreshToken: nextRefresh.token,
    rotated: true,
    session,
    payload,
  };
}

module.exports = {
  rotateRefreshSession,
};
