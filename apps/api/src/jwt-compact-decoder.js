const MAX_COMPACT_TOKEN_LENGTH = 4096;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_DECODE = new Int16Array(128).fill(-1);
for (let index = 0; index < BASE64URL_ALPHABET.length; index += 1) {
  BASE64URL_DECODE[BASE64URL_ALPHABET.charCodeAt(index)] = index;
}

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

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
 * Canonical Base64URL decode: alphabet, length mod 4, strict residual bits via
 * re-encode equality.
 *
 * @param {string} segment
 * @returns {Uint8Array | null}
 */
function decodeBase64UrlCanonical(segment) {
  const length = segment.length;
  if (length === 0 || length % 4 === 1 || !isBase64UrlAlphabet(segment)) {
    return null;
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
      return null;
    }
    bytes[outputIndex] = (a << 2) | (b >> 4);
  } else if (remaining === 3) {
    const a = BASE64URL_DECODE[segment.charCodeAt(inputIndex)];
    const b = BASE64URL_DECODE[segment.charCodeAt(inputIndex + 1)];
    const c = BASE64URL_DECODE[segment.charCodeAt(inputIndex + 2)];
    if ((c & 0x03) !== 0) {
      return null;
    }
    bytes[outputIndex] = (a << 2) | (b >> 4);
    bytes[outputIndex + 1] = ((b & 0x0f) << 4) | (c >> 2);
  }

  if (encodeBase64Url(bytes) !== segment) {
    return null;
  }

  return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string | null}
 */
function decodeUtf8Strict(bytes) {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * @param {string} source
 */
function createJsonParser(source) {
  let index = 0;

  function peek() {
    return index < source.length ? source.charCodeAt(index) : -1;
  }

  function advance() {
    index += 1;
  }

  function skipWhitespace() {
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09) {
        index += 1;
        continue;
      }
      break;
    }
  }

  function expectChar(expected) {
    if (peek() !== expected) {
      throw new Error("json");
    }
    advance();
  }

  function parseString() {
    expectChar(0x22);
    let value = "";
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (code === 0x22) {
        advance();
        return value;
      }
      if (code === 0x5c) {
        advance();
        if (index >= source.length) {
          throw new Error("json");
        }
        const escaped = source.charCodeAt(index);
        advance();
        switch (escaped) {
          case 0x22:
            value += '"';
            break;
          case 0x5c:
            value += "\\";
            break;
          case 0x2f:
            value += "/";
            break;
          case 0x62:
            value += "\b";
            break;
          case 0x66:
            value += "\f";
            break;
          case 0x6e:
            value += "\n";
            break;
          case 0x72:
            value += "\r";
            break;
          case 0x74:
            value += "\t";
            break;
          case 0x75: {
            if (index + 4 > source.length) {
              throw new Error("json");
            }
            let unit = 0;
            for (let offset = 0; offset < 4; offset += 1) {
              const hex = source.charCodeAt(index + offset);
              unit <<= 4;
              if (hex >= 48 && hex <= 57) {
                unit |= hex - 48;
              } else if (hex >= 65 && hex <= 70) {
                unit |= hex - 55;
              } else if (hex >= 97 && hex <= 102) {
                unit |= hex - 87;
              } else {
                throw new Error("json");
              }
            }
            index += 4;
            value += String.fromCharCode(unit);
            break;
          }
          default:
            throw new Error("json");
        }
        continue;
      }
      if (code < 0x20) {
        throw new Error("json");
      }
      value += source[index];
      advance();
    }
    throw new Error("json");
  }

  function parseNumber() {
    const start = index;
    if (peek() === 0x2d) {
      advance();
    }
    if (peek() === 0x30) {
      advance();
    } else if (peek() >= 0x31 && peek() <= 0x39) {
      while (peek() >= 0x30 && peek() <= 0x39) {
        advance();
      }
    } else {
      throw new Error("json");
    }
    if (peek() === 0x2e) {
      advance();
      if (peek() < 0x30 || peek() > 0x39) {
        throw new Error("json");
      }
      while (peek() >= 0x30 && peek() <= 0x39) {
        advance();
      }
    }
    const exponent = peek();
    if (exponent === 0x65 || exponent === 0x45) {
      advance();
      if (peek() === 0x2b || peek() === 0x2d) {
        advance();
      }
      if (peek() < 0x30 || peek() > 0x39) {
        throw new Error("json");
      }
      while (peek() >= 0x30 && peek() <= 0x39) {
        advance();
      }
    }
    const literal = source.slice(start, index);
    const number = Number(literal);
    if (!Number.isFinite(number)) {
      throw new Error("json");
    }
    return number;
  }

  function parseLiteral(expected, value) {
    for (let offset = 0; offset < expected.length; offset += 1) {
      if (source[index + offset] !== expected[offset]) {
        throw new Error("json");
      }
    }
    index += expected.length;
    return value;
  }

  function parseArray() {
    expectChar(0x5b);
    skipWhitespace();
    const values = [];
    if (peek() === 0x5d) {
      advance();
      return values;
    }
    while (true) {
      values.push(parseValue());
      skipWhitespace();
      if (peek() === 0x2c) {
        advance();
        skipWhitespace();
        continue;
      }
      if (peek() === 0x5d) {
        advance();
        return values;
      }
      throw new Error("json");
    }
  }

  function parseObject() {
    expectChar(0x7b);
    skipWhitespace();
    const object = {};
    const seenKeys = new Set();

    if (peek() === 0x7d) {
      advance();
      return object;
    }

    while (true) {
      if (peek() !== 0x22) {
        throw new Error("json");
      }
      const key = parseString();
      if (DANGEROUS_KEYS.has(key) || seenKeys.has(key)) {
        throw new Error("json");
      }
      seenKeys.add(key);
      skipWhitespace();
      expectChar(0x3a);
      skipWhitespace();
      object[key] = parseValue();
      skipWhitespace();
      if (peek() === 0x2c) {
        advance();
        skipWhitespace();
        continue;
      }
      if (peek() === 0x7d) {
        advance();
        return object;
      }
      throw new Error("json");
    }
  }

  function parseValue() {
    skipWhitespace();
    const code = peek();
    if (code === 0x7b) {
      return parseObject();
    }
    if (code === 0x5b) {
      return parseArray();
    }
    if (code === 0x22) {
      return parseString();
    }
    if (code === 0x74) {
      return parseLiteral("true", true);
    }
    if (code === 0x66) {
      return parseLiteral("false", false);
    }
    if (code === 0x6e) {
      return parseLiteral("null", null);
    }
    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) {
      return parseNumber();
    }
    throw new Error("json");
  }

  function parseRootObject() {
    skipWhitespace();
    if (peek() !== 0x7b) {
      throw new Error("json");
    }
    const value = parseObject();
    skipWhitespace();
    if (index !== source.length) {
      throw new Error("json");
    }
    return value;
  }

  return { parseRootObject };
}

/**
 * @param {string} text
 * @returns {object | null}
 */
function parseSecureJsonObject(text) {
  try {
    return createJsonParser(text).parseRootObject();
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function freezeDeep(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      freezeDeep(value[index]);
    }
    return Object.freeze(value);
  }
  const keys = Object.getOwnPropertyNames(value);
  for (let index = 0; index < keys.length; index += 1) {
    freezeDeep(value[keys[index]]);
  }
  return Object.freeze(value);
}

/**
 * Pure strict compact JWT decoder (V2.1q / V2.1r).
 *
 * Returns STRUCTURALLY_DECODED material only. Never authenticates, never
 * authorizes, never verifies signatures.
 *
 * @param {unknown} compactToken
 * @returns {{
 *   protectedHeader: object,
 *   payload: object,
 *   signingInput: string,
 *   signature: Uint8Array,
 * } | null}
 */
export function decodeJwtCompactStrict(compactToken) {
  try {
    if (typeof compactToken !== "string") {
      return null;
    }
    const length = compactToken.length;
    if (length < 1 || length > MAX_COMPACT_TOKEN_LENGTH) {
      return null;
    }

    const segments = [];
    let start = 0;
    for (let index = 0; index < length; index += 1) {
      if (compactToken.charCodeAt(index) === 46) {
        segments.push(compactToken.slice(start, index));
        start = index + 1;
      }
    }
    segments.push(compactToken.slice(start));

    if (segments.length !== 3) {
      return null;
    }

    const headerSegment = segments[0];
    const payloadSegment = segments[1];
    const signatureSegment = segments[2];
    if (
      headerSegment.length === 0 ||
      payloadSegment.length === 0 ||
      signatureSegment.length === 0
    ) {
      return null;
    }

    const headerBytes = decodeBase64UrlCanonical(headerSegment);
    const payloadBytes = decodeBase64UrlCanonical(payloadSegment);
    const signatureBytes = decodeBase64UrlCanonical(signatureSegment);
    if (
      headerBytes === null ||
      payloadBytes === null ||
      signatureBytes === null ||
      signatureBytes.byteLength === 0
    ) {
      return null;
    }

    const headerText = decodeUtf8Strict(headerBytes);
    const payloadText = decodeUtf8Strict(payloadBytes);
    if (headerText === null || payloadText === null) {
      return null;
    }

    const protectedHeader = parseSecureJsonObject(headerText);
    const payload = parseSecureJsonObject(payloadText);
    if (protectedHeader === null || payload === null) {
      return null;
    }

    const signingInput = `${headerSegment}.${payloadSegment}`;
    // Fresh Uint8Array view (never a Buffer). Do not freeze typed arrays:
    // Object.freeze throws on array-buffer views with elements in Node.js.
    const signature = new Uint8Array(signatureBytes);

    return Object.freeze({
      protectedHeader: freezeDeep(protectedHeader),
      payload: freezeDeep(payload),
      signingInput,
      signature,
    });
  } catch {
    return null;
  }
}
