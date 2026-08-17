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

function verifySecret(secret, storedHash) {
  if (!secret || !storedHash) {
    return false;
  }

  if (!String(storedHash).startsWith(`${HASH_PREFIX}$`)) {
    return String(secret) === String(storedHash);
  }

  const [, salt, expectedHash] = String(storedHash).split("$");
  const hash = crypto.scryptSync(String(secret), salt, 64);
  const expected = Buffer.from(expectedHash, "hex");

  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

module.exports = { generateTemporarySecret, hashSecret, verifySecret };
