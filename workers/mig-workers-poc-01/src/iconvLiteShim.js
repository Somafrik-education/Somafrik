"use strict";

// Workers + nodejs_compat exécute la branche Node d'iconv-lite 0.4, alors que
// le champ "browser" du paquet neutralise ./streams. require("./streams")
// n'est alors pas une fonction et le runtime tombe au démarrage d'Express.
// Ce module ne couvre que UTF-8 : les routes du POC ne lisent pas de corps.

function normalized(encoding) {
  return String(encoding || "utf-8").toLowerCase().replace(/[-_\s]/g, "");
}

function assertUtf8(encoding) {
  const name = normalized(encoding);
  if (name !== "utf8" && name !== "ascii" && name !== "usascii") {
    throw new Error(`Encoding not recognized: ${encoding}`);
  }
}

function utf8Decoder() {
  return {
    write(chunk) {
      if (chunk == null) return "";
      return Buffer.isBuffer(chunk) ? chunk.toString("utf8") : Buffer.from(chunk).toString("utf8");
    },
    end() {
      return "";
    },
  };
}

exports.decode = function decode(buf, encoding) {
  assertUtf8(encoding || "utf-8");
  if (typeof buf === "string") return buf;
  return Buffer.from(buf).toString("utf8");
};

exports.encode = function encode(str, encoding) {
  assertUtf8(encoding || "utf-8");
  return Buffer.from(String(str ?? ""), "utf8");
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
  assertUtf8(encoding);
  return utf8Decoder();
};

exports.getEncoder = function getEncoder(encoding) {
  assertUtf8(encoding);
  return {
    write(str) {
      return Buffer.from(String(str ?? ""), "utf8");
    },
    end() {
      return Buffer.alloc(0);
    },
  };
};
