"use strict";

// Limité au POC Workers. Wrangler l'alias à la place d'iconv-lite 0.4,
// dont require("./streams") casse le runtime. Ce fichier n'est pas branché
// sur le backend Somafrik. UTF-8 seulement, rejet fail-closed.

function invalid(encoding) {
  const error = new Error(`Encoding not recognized: ${encoding ?? ""}`);
  return error;
}

function normalized(encoding) {
  return String(encoding).toLowerCase().replace(/[-_\s]/g, "");
}

function assertUtf8(encoding) {
  if (encoding == null || String(encoding).trim() === "") throw invalid(encoding);
  const name = normalized(encoding);
  if (name !== "utf8" && name !== "ascii" && name !== "usascii") throw invalid(encoding);
  return name;
}

function asBuffer(value) {
  if (typeof value === "string") {
    if (typeof value.isWellFormed === "function" && !value.isWellFormed()) throw invalid("utf-8");
    return Buffer.from(value, "utf8");
  }
  if (value == null) return Buffer.alloc(0);
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function assertAsciiBytes(buf) {
  for (const byte of buf) {
    if (byte > 0x7f) throw invalid("us-ascii");
  }
}

function decodeStrict(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw invalid("utf-8");
  }
}

function createDecoder(encodingName) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return {
    write(chunk) {
      if (chunk == null) return "";
      const buf = asBuffer(chunk);
      if (encodingName === "ascii" || encodingName === "usascii") assertAsciiBytes(buf);
      try {
        return decoder.decode(buf, { stream: true });
      } catch {
        throw invalid("utf-8");
      }
    },
    end() {
      try {
        return decoder.decode();
      } catch {
        throw invalid("utf-8");
      }
    },
  };
}

exports.decode = function decode(buf, encoding) {
  const name = encoding == null ? "utf8" : assertUtf8(encoding);
  const bytes = asBuffer(buf);
  if (name === "ascii" || name === "usascii") assertAsciiBytes(bytes);
  return decodeStrict(bytes);
};

exports.encode = function encode(str, encoding) {
  const name = encoding == null ? "utf8" : assertUtf8(encoding);
  const text = String(str ?? "");
  if (typeof text.isWellFormed === "function" && !text.isWellFormed()) throw invalid("utf-8");
  if ((name === "ascii" || name === "usascii") && /[^\u0000-\u007f]/.test(text)) throw invalid(encoding);
  return Buffer.from(text, "utf8");
};

exports.encodingExists = function encodingExists(encoding) {
  try {
    assertUtf8(encoding);
    return true;
  } catch {
    return false;
  }
};

exports.getDecoder = function getDecoder(encoding) {
  return createDecoder(assertUtf8(encoding));
};

exports.getEncoder = function getEncoder(encoding) {
  const name = assertUtf8(encoding);
  return {
    write(str) {
      return exports.encode(str, name);
    },
    end() {
      return Buffer.alloc(0);
    },
  };
};
