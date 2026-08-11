const MAX_KID_LENGTH = 128;
const MAX_CANDIDATES = 256;
const ALLOWED_STATUSES = new Set(["active", "inactive"]);
const ALLOWED_MODULUS_LENGTHS = new Set([2048, 3072, 4096]);
const REQUIRED_PUBLIC_EXPONENT = 65537n;
const CANDIDATE_KEYS = ["kid", "status", "verificationKey"];

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isStrictAsciiKid(value) {
  if (typeof value !== "string") {
    return false;
  }

  const length = value.length;
  if (length < 1 || length > MAX_KID_LENGTH) {
    return false;
  }

  for (let index = 0; index < length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const isUpper = codeUnit >= 65 && codeUnit <= 90;
    const isLower = codeUnit >= 97 && codeUnit <= 122;
    const isDigit = codeUnit >= 48 && codeUnit <= 57;
    const isAllowedPunctuation =
      codeUnit === 46 ||
      codeUnit === 95 ||
      codeUnit === 58 ||
      codeUnit === 45;
    if (!isUpper && !isLower && !isDigit && !isAllowedPunctuation) {
      return false;
    }
  }

  return true;
}

/**
 * @param {object} object
 * @param {string} key
 * @returns {boolean}
 */
function isOwnDataProperty(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return (
    descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    !Object.hasOwn(descriptor, "get") &&
    !Object.hasOwn(descriptor, "set")
  );
}

/**
 * @param {object} object
 * @param {string} key
 * @returns {unknown}
 */
function ownDataValue(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor === undefined ? undefined : descriptor.value;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isOrdinaryObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return false;
  }

  const names = Object.getOwnPropertyNames(value);
  for (let index = 0; index < names.length; index += 1) {
    if (!isOwnDataProperty(value, names[index])) {
      return false;
    }
  }

  return true;
}

/**
 * @param {object} object
 * @param {readonly string[]} expectedKeys
 * @returns {boolean}
 */
function hasExactOwnDataKeys(object, expectedKeys) {
  const names = Object.getOwnPropertyNames(object);
  if (names.length !== expectedKeys.length) {
    return false;
  }

  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    if (!Object.hasOwn(object, key) || !isOwnDataProperty(object, key)) {
      return false;
    }
  }

  return true;
}

/**
 * @param {unknown} usages
 * @returns {boolean}
 */
function hasVerifyUsage(usages) {
  if (usages === null || typeof usages !== "object" || !("length" in usages)) {
    return false;
  }
  const length = usages.length;
  if (typeof length !== "number" || length < 1) {
    return false;
  }
  for (let index = 0; index < length; index += 1) {
    if (usages[index] === "verify") {
      return true;
    }
  }
  return false;
}

/**
 * @param {unknown} exponent
 * @returns {boolean}
 */
function isPublicExponent65537(exponent) {
  if (!(exponent instanceof Uint8Array) || exponent.byteLength < 1) {
    return false;
  }
  let value = 0n;
  for (let index = 0; index < exponent.byteLength; index += 1) {
    value = (value << 8n) | BigInt(exponent[index]);
    if (value > REQUIRED_PUBLIC_EXPONENT) {
      return false;
    }
  }
  return value === REQUIRED_PUBLIC_EXPONENT;
}

/**
 * Semantic reuse of V2.1s/V2.1t CryptoKey constraints (no crypto executed).
 *
 * @param {unknown} verificationKey
 * @returns {boolean}
 */
function isCompatibleVerificationKey(verificationKey) {
  if (typeof CryptoKey === "undefined") {
    return false;
  }
  if (!(verificationKey instanceof CryptoKey)) {
    return false;
  }
  // Genuine WebCrypto keys expose type/usages/algorithm via prototype accessors
  // backed by internal slots — not own data properties.
  if (
    Object.hasOwn(verificationKey, "type") ||
    Object.hasOwn(verificationKey, "usages") ||
    Object.hasOwn(verificationKey, "algorithm")
  ) {
    return false;
  }
  if (verificationKey.type !== "public") {
    return false;
  }
  if (!hasVerifyUsage(verificationKey.usages)) {
    return false;
  }

  const algorithm = verificationKey.algorithm;
  if (algorithm === null || typeof algorithm !== "object") {
    return false;
  }
  if (algorithm.name !== "RSASSA-PKCS1-v1_5") {
    return false;
  }

  const hash = algorithm.hash;
  if (hash === null || typeof hash !== "object" || hash.name !== "SHA-256") {
    return false;
  }

  if (!ALLOWED_MODULUS_LENGTHS.has(algorithm.modulusLength)) {
    return false;
  }

  return isPublicExponent65537(algorithm.publicExponent);
}

/**
 * @param {unknown} keyCandidates
 * @returns {boolean}
 */
function isAdmissibleCandidateArray(keyCandidates) {
  if (keyCandidates === null || typeof keyCandidates !== "object") {
    return false;
  }
  if (!Array.isArray(keyCandidates)) {
    return false;
  }
  if (Object.getPrototypeOf(keyCandidates) !== Array.prototype) {
    return false;
  }
  if (Object.getOwnPropertySymbols(keyCandidates).length !== 0) {
    return false;
  }
  if (!isOwnDataProperty(keyCandidates, "length")) {
    return false;
  }

  const length = ownDataValue(keyCandidates, "length");
  if (typeof length !== "number" || !Number.isInteger(length)) {
    return false;
  }
  if (length < 0 || length > MAX_CANDIDATES) {
    return false;
  }

  const names = Object.getOwnPropertyNames(keyCandidates);
  if (names.length !== length + 1) {
    return false;
  }

  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    if (!Object.hasOwn(keyCandidates, key) || !isOwnDataProperty(keyCandidates, key)) {
      return false;
    }
  }

  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (name === "length") {
      continue;
    }
    if (!/^(0|[1-9][0-9]*)$/.test(name)) {
      return false;
    }
    const numeric = Number(name);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric >= length) {
      return false;
    }
  }

  return true;
}

/**
 * @param {unknown} candidate
 * @returns {boolean}
 */
function isAdmissibleCandidate(candidate) {
  if (!isOrdinaryObject(candidate)) {
    return false;
  }
  if (!hasExactOwnDataKeys(candidate, CANDIDATE_KEYS)) {
    return false;
  }

  const kid = ownDataValue(candidate, "kid");
  if (!isStrictAsciiKid(kid)) {
    return false;
  }

  const status = ownDataValue(candidate, "status");
  if (typeof status !== "string" || !ALLOWED_STATUSES.has(status)) {
    return false;
  }

  // verificationKey presence is structural; compatibility checked after uniqueness.
  const verificationKey = ownDataValue(candidate, "verificationKey");
  if (verificationKey === null || verificationKey === undefined) {
    return false;
  }

  return true;
}

/**
 * Pure strict kid → CryptoKey resolver (V2.1u / V2.1v).
 *
 * Returns a CryptoKey only for KEY_RESOLVED. Never authenticates, never
 * authorizes, never verifies signatures, never imports keys, and never throws
 * to the caller.
 *
 * @param {unknown} kid
 * @param {unknown} keyCandidates
 * @returns {CryptoKey | null}
 */
export function resolveJwtRs256VerificationKey(kid, keyCandidates) {
  try {
    if (!isStrictAsciiKid(kid)) {
      return null;
    }
    if (!isAdmissibleCandidateArray(keyCandidates)) {
      return null;
    }

    const length = /** @type {number} */ (ownDataValue(keyCandidates, "length"));
    let matchCount = 0;
    /** @type {object | null} */
    let matchedCandidate = null;

    for (let index = 0; index < length; index += 1) {
      const candidate = ownDataValue(keyCandidates, String(index));
      if (!isAdmissibleCandidate(candidate)) {
        return null;
      }

      const candidateKid = ownDataValue(candidate, "kid");
      if (candidateKid === kid) {
        matchCount += 1;
        matchedCandidate = candidate;
      }
    }

    if (matchCount !== 1 || matchedCandidate === null) {
      return null;
    }

    const status = ownDataValue(matchedCandidate, "status");
    if (status !== "active") {
      return null;
    }

    const verificationKey = ownDataValue(matchedCandidate, "verificationKey");
    if (!isCompatibleVerificationKey(verificationKey)) {
      return null;
    }

    return /** @type {CryptoKey} */ (verificationKey);
  } catch {
    return null;
  }
}
