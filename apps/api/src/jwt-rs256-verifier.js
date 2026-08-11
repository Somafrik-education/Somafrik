const MAX_SIGNING_INPUT_LENGTH = 4094;
const ALLOWED_MODULUS_LENGTHS = new Set([2048, 3072, 4096]);
const REQUIRED_PUBLIC_EXPONENT = 65537n;
const VERIFY_ALGORITHM = Object.freeze({ name: "RSASSA-PKCS1-v1_5" });
const TEXT_ENCODER = new TextEncoder();

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_DECODE = new Int16Array(128).fill(-1);
for (let index = 0; index < BASE64URL_ALPHABET.length; index += 1) {
  BASE64URL_DECODE[BASE64URL_ALPHABET.charCodeAt(index)] = index;
}

/**
 * @param {string} segment
 * @returns {boolean}
 */
function isBase64UrlAlphabet(segment) {
  for (let index = 0; index < segment.length; index += 1) {
    const codeUnit = segment.charCodeAt(index);
    if (codeUnit >= 128 || BASE64URL_DECODE[codeUnit] < 0) {
      return false;
    }
  }
  return true;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function encodeBase64Url(bytes) {
  let output = "";
  const length = bytes.length;
  let index = 0;

  while (index + 2 < length) {
    const value =
      (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output +=
      BASE64URL_ALPHABET[(value >> 18) & 63] +
      BASE64URL_ALPHABET[(value >> 12) & 63] +
      BASE64URL_ALPHABET[(value >> 6) & 63] +
      BASE64URL_ALPHABET[value & 63];
    index += 3;
  }

  if (index < length) {
    const remaining = length - index;
    if (remaining === 1) {
      const value = bytes[index] << 16;
      output +=
        BASE64URL_ALPHABET[(value >> 18) & 63] +
        BASE64URL_ALPHABET[(value >> 12) & 63];
    } else {
      const value = (bytes[index] << 16) | (bytes[index + 1] << 8);
      output +=
        BASE64URL_ALPHABET[(value >> 18) & 63] +
        BASE64URL_ALPHABET[(value >> 12) & 63] +
        BASE64URL_ALPHABET[(value >> 6) & 63];
    }
  }

  return output;
}

/**
 * @param {string} segment
 * @returns {boolean}
 */
function isCanonicalBase64UrlSegment(segment) {
  const length = segment.length;
  if (length === 0 || length % 4 === 1 || !isBase64UrlAlphabet(segment)) {
    return false;
  }

  const outputLength = Math.floor((length * 3) / 4);
  const bytes = new Uint8Array(outputLength);
  let inputIndex = 0;
  let outputIndex = 0;

  while (inputIndex + 3 < length) {
    const a = BASE64URL_DECODE[segment.charCodeAt(inputIndex)];
    const b = BASE64URL_DECODE[segment.charCodeAt(inputIndex + 1)];
    const c = BASE64URL_DECODE[segment.charCodeAt(inputIndex + 2)];
    const d = BASE64URL_DECODE[segment.charCodeAt(inputIndex + 3)];
    const value = (a << 18) | (b << 12) | (c << 6) | d;
    bytes[outputIndex] = (value >> 16) & 255;
    bytes[outputIndex + 1] = (value >> 8) & 255;
    bytes[outputIndex + 2] = value & 255;
    inputIndex += 4;
    outputIndex += 3;
  }

  const remaining = length - inputIndex;
  if (remaining === 2) {
    const a = BASE64URL_DECODE[segment.charCodeAt(inputIndex)];
    const b = BASE64URL_DECODE[segment.charCodeAt(inputIndex + 1)];
    if ((b & 0x0f) !== 0) {
      return false;
    }
    bytes[outputIndex] = (a << 2) | (b >> 4);
  } else if (remaining === 3) {
    const a = BASE64URL_DECODE[segment.charCodeAt(inputIndex)];
    const b = BASE64URL_DECODE[segment.charCodeAt(inputIndex + 1)];
    const c = BASE64URL_DECODE[segment.charCodeAt(inputIndex + 2)];
    if ((c & 0x03) !== 0) {
      return false;
    }
    bytes[outputIndex] = (a << 2) | (b >> 4);
    bytes[outputIndex + 1] = ((b & 0x0f) << 4) | (c >> 2);
  }

  return encodeBase64Url(bytes) === segment;
}

/**
 * @param {unknown} signingInput
 * @returns {boolean}
 */
function isValidSigningInput(signingInput) {
  if (typeof signingInput !== "string") {
    return false;
  }
  const length = signingInput.length;
  if (length < 1 || length > MAX_SIGNING_INPUT_LENGTH) {
    return false;
  }

  const segments = [];
  let start = 0;
  for (let index = 0; index < length; index += 1) {
    if (signingInput.charCodeAt(index) === 46) {
      segments.push(signingInput.slice(start, index));
      start = index + 1;
    }
  }
  segments.push(signingInput.slice(start));

  if (segments.length !== 2) {
    return false;
  }
  if (segments[0].length === 0 || segments[1].length === 0) {
    return false;
  }
  return (
    isCanonicalBase64UrlSegment(segments[0]) &&
    isCanonicalBase64UrlSegment(segments[1])
  );
}

/**
 * @param {unknown} signature
 * @returns {signature is Uint8Array}
 */
function isExactNonEmptyUint8Array(signature) {
  return (
    signature instanceof Uint8Array &&
    signature.constructor === Uint8Array &&
    signature.byteLength >= 1
  );
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
 * @param {unknown} verificationKey
 * @returns {boolean}
 */
function isCompatibleVerificationKey(verificationKey) {
  if (typeof CryptoKey === "undefined" || !(verificationKey instanceof CryptoKey)) {
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
 * Pure RS256 signature verifier (V2.1s / V2.1t).
 *
 * Returns true only for SIGNATURE_VALID. Never authenticates, never authorizes,
 * never resolves kid, and never rejects/throws to the caller.
 *
 * @param {unknown} signingInput
 * @param {unknown} signature
 * @param {unknown} verificationKey
 * @returns {Promise<boolean>}
 */
export async function verifyJwtRs256Signature(
  signingInput,
  signature,
  verificationKey,
) {
  try {
    if (!isValidSigningInput(signingInput)) {
      return false;
    }
    if (!isExactNonEmptyUint8Array(signature)) {
      return false;
    }
    if (!isCompatibleVerificationKey(verificationKey)) {
      return false;
    }

    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle || typeof subtle.verify !== "function") {
      return false;
    }

    const verified = await subtle.verify(
      VERIFY_ALGORITHM,
      verificationKey,
      signature,
      TEXT_ENCODER.encode(signingInput),
    );
    return verified === true;
  } catch {
    return false;
  }
}
