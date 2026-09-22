"use strict";

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS), constrained to I-JSON (RFC 7493).
 * Rejet : undefined, non-finite, lone UTF-16 surrogates, types non JSON.
 */

function canonicalize(value) {
  return serialize(value);
}

function assertWellFormedUtf16(str, label) {
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = str.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`JCS: lone surrogate in ${label}`);
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`JCS: lone surrogate in ${label}`);
    }
  }
}

function serialize(value) {
  if (value === undefined) {
    throw new TypeError("JCS: undefined is not I-JSON");
  }
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JCS: non-finite number");
    }
    return JSON.stringify(value);
  }
  if (type === "string") {
    assertWellFormedUtf16(value, "string");
    return JSON.stringify(value);
  }
  if (type === "bigint") {
    throw new TypeError("JCS: bigint is not I-JSON");
  }
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        throw new TypeError("JCS: sparse array is not I-JSON");
      }
      parts.push(serialize(value[i]));
    }
    return `[${parts.join(",")}]`;
  }
  if (type === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError("JCS: only plain objects");
    }
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const key of keys) {
      assertWellFormedUtf16(key, "property name");
      const field = value[key];
      if (field === undefined) {
        throw new TypeError("JCS: undefined property is not I-JSON");
      }
      parts.push(`${JSON.stringify(key)}:${serialize(field)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`JCS: unsupported type ${type}`);
}

module.exports = { canonicalize };
