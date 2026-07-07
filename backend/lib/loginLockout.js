const failedLoginAttempts = new Map();
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

function getLoginAttemptKey(schoolCode, identifier) {
  return `${String(schoolCode ?? "").trim().toUpperCase()}:${String(identifier ?? "").trim().toLowerCase()}`;
}

function assertLoginNotLocked(key) {
  const current = failedLoginAttempts.get(key);
  if (!current?.lockedUntil) return;
  if (current.lockedUntil <= Date.now()) {
    failedLoginAttempts.delete(key);
    return;
  }
  throw new Error("LOCKED");
}

function recordFailedLoginAttempt(key) {
  const current = failedLoginAttempts.get(key) ?? { count: 0, lockedUntil: null };
  const count = current.count + 1;
  failedLoginAttempts.set(key, {
    count,
    lockedUntil: count >= MAX_FAILED_LOGIN_ATTEMPTS ? Date.now() + LOGIN_LOCK_DURATION_MS : null,
  });
}

function clearFailedLoginAttempts(key) {
  failedLoginAttempts.delete(key);
}

module.exports = {
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOGIN_LOCK_DURATION_MS,
  getLoginAttemptKey,
  assertLoginNotLocked,
  recordFailedLoginAttempt,
  clearFailedLoginAttempts,
};
