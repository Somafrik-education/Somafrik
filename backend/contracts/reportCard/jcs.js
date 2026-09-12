"use strict";

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 * Objets : clés triées. Aucun blanc insignifiant.
 * Nombres / chaînes : sérialisation JSON ECMAScript.
 */

function canonicalize(value) {
  return serialize(value);
}

function serialize(value) {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JCS: non-finite number");
    }
    return JSON.stringify(value);
  }
  if (type === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }
  if (type === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError("JCS: only plain objects");
    }
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const key of keys) {
      const field = value[key];
      if (field === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${serialize(field)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`JCS: unsupported type ${type}`);
}

module.exports = { canonicalize };
