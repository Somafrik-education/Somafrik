const crypto = require("crypto");

const HASH_PREFIX = "scrypt";

/**
 * Secret temporaire élève — contrat Somafrik (Tmp- + octets CSPRNG).
 * Jamais dérivé du matricule. Hash seul en base. Clair uniquement dans la réponse CREATE.
 */
function generateTemporarySecret() {
  return `Tmp-${crypto.randomBytes(16).toString("hex")}`;
}

function hashSecret(secret) {
  if (!secret) {
    return null;
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(secret), salt, 64).toString("hex");
  return `${HASH_PREFIX}$${salt}$${hash}`;
}

function isHashedSecret(value) {
  return String(value ?? "").startsWith(`${HASH_PREFIX}$`);
}

function firstPlainSecret(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && !isHashedSecret(text)) {
      return text;
    }
  }
  return "";
}

/**
 * P0-02 — materialise passwordHash/pinHash depuis les champs clair de confiance
 * (password / pin / temporaryPassword des fixtures démo). Ne réécrit jamais un
 * hash scrypt déjà présent. Un passwordHash/pinHash non-scrypt n'est jamais
 * promu : verifySecret reste fail-closed.
 */
function materializeAccountSecretHashes(user) {
  if (!user || typeof user !== "object") {
    return user;
  }

  if (!isHashedSecret(user.passwordHash)) {
    const secret = firstPlainSecret(user.password, user.temporaryPassword);
    if (secret) {
      user.passwordHash = hashSecret(secret);
    }
  }

  if (!isHashedSecret(user.pinHash)) {
    const secret = firstPlainSecret(user.pin, user.temporaryPassword, user.password);
    if (secret) {
      user.pinHash = hashSecret(secret);
    }
  }

  return user;
}

function verifySecret(secret, storedHash) {
  if (!secret || !storedHash) {
    return false;
  }

  const stored = String(storedHash);
  if (!stored.startsWith(`${HASH_PREFIX}$`)) {
    return false;
  }

  const parts = stored.split("$");
  if (parts.length !== 3 || !parts[1] || !parts[2]) {
    return false;
  }

  const expected = Buffer.from(parts[2], "hex");
  if (expected.length === 0) {
    return false;
  }

  const hash = crypto.scryptSync(String(secret), parts[1], 64);
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

module.exports = {
  generateTemporarySecret,
  hashSecret,
  verifySecret,
  isHashedSecret,
  materializeAccountSecretHashes,
};
