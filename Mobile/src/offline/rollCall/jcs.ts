/**
 * PR2 — exact I-JSON/JCS semantics of backend/contracts/reportCard/jcs.js.
 * No Buffer, no node:crypto, no native dependencies. Hermes parity remains a separate gate.
 */
function wellFormedUtf16(value: string, label: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("JCS: lone surrogate in " + label);
      }
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("JCS: lone surrogate in " + label);
    }
  }
}

export function canonicalize(value: unknown): string {
  if (value === undefined) throw new TypeError("JCS: undefined is not I-JSON");
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS: non-finite number");
    return JSON.stringify(value);
  }
  if (type === "string") {
    wellFormedUtf16(value as string, "string");
    return JSON.stringify(value);
  }
  if (type === "bigint") throw new TypeError("JCS: bigint is not I-JSON");
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        throw new TypeError("JCS: sparse array is not I-JSON");
      }
      parts.push(canonicalize(value[i]));
    }
    return "[" + parts.join(",") + "]";
  }
  if (type === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError("JCS: only plain objects");
    }
    const fields = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(fields).sort()) {
      wellFormedUtf16(key, "property name");
      if (fields[key] === undefined) {
        throw new TypeError("JCS: undefined property is not I-JSON");
      }
      parts.push(JSON.stringify(key) + ":" + canonicalize(fields[key]));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new TypeError("JCS: unsupported type " + type);
}

/**
 * UTF-8 encoding without TextEncoder/Buffer: works under Hermes even if TextEncoder
 * is unavailable. Refuses lone surrogates rather than replacing them with U+FFFD.
 */
export function utf8(value: string): Uint8Array {
  if (typeof value !== "string") throw new TypeError("UTF8: expected string");
  wellFormedUtf16(value, "string");
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      code = 0x10000 + ((code - 0xd800) << 10) + (value.charCodeAt(++i) - 0xdc00);
    }
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
  }
  return Uint8Array.from(bytes);
}

export function lp(fields: string[]): Uint8Array {
  if (!Array.isArray(fields) || fields.length === 0) throw new TypeError("LP: fields required");
  const encoded = fields.map((f) => utf8(f));
  const size = encoded.reduce((sum, b) => {
    if (b.length > 0xffffffff) throw new TypeError("LP: field too long");
    return sum + 4 + b.length;
  }, 0);
  const output = new Uint8Array(size);
  let index = 0;
  for (const field of encoded) {
    const n = field.length >>> 0;
    output[index++] = n >>> 24;
    output[index++] = (n >>> 16) & 255;
    output[index++] = (n >>> 8) & 255;
    output[index++] = n & 255;
    output.set(field, index);
    index += field.length;
  }
  return output;
}

/** Contract validation before canonicalization; rejects floats, -0, oversized or deep JSON. */
export function canonicalContractJson(value: unknown): { text: string; bytes: Uint8Array } {
  function walk(v: unknown, depth: number): void {
    if (depth > 32) throw new TypeError("JCS: depth limit");
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number") {
      if (!Number.isSafeInteger(v) || Object.is(v, -0)) throw new TypeError("JCS: invalid contract number");
      return;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(v, i)) throw new TypeError("JCS: sparse array");
        walk(v[i], depth + 1);
      }
      return;
    }
    if (v && typeof v === "object") {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new TypeError("JCS: invalid object");
      for (const key of Object.keys(v)) walk((v as Record<string, unknown>)[key], depth + 1);
      return;
    }
    throw new TypeError("JCS: invalid contract type");
  }
  walk(value, 0);
  const text = canonicalize(value);
  const bytes = utf8(text);
  if (bytes.length > 256 * 1024) throw new TypeError("JCS: payload too large");
  return { text, bytes };
}
