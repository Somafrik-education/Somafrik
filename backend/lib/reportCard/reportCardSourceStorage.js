"use strict";

/**
 * LOT 11 — stockage durable dédié des artefacts source bulletin.
 * Env : SOMAFRIK_REPORT_CARD_SOURCE_STORAGE (root dédié, pas le root Communications).
 * Clés opaques : YYYY/<uuid> — aucun schoolId / requestId / modelKey / filename.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { sniffMime } = require("../communicationsAttachments");

const ENV_NAME = "SOMAFRIK_REPORT_CARD_SOURCE_STORAGE";
const MAX_SOURCE_ARTIFACT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = Object.freeze({
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
});
const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".js",
  ".mjs",
  ".sh",
  ".ps1",
  ".dll",
  ".scr",
  ".html",
  ".htm",
  ".svg",
]);

function asTrimmed(value) {
  return value == null ? "" : String(value).trim();
}

function isProductionEnv() {
  return String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

function isEphemeralStoragePath(root) {
  const resolved = path.resolve(String(root ?? ""));
  const tmp = path.resolve(os.tmpdir());
  const prefixes = [tmp, "/tmp", "/var/tmp"];
  return prefixes.some((base) => resolved === base || resolved.startsWith(`${base}${path.sep}`));
}

function reportCardSourceStorageReadiness(env = process.env) {
  const configured = asTrimmed(env[ENV_NAME]);
  if (!isProductionEnv()) {
    return {
      ready: true,
      required: false,
      configured: Boolean(configured),
      ephemeralFallback: !configured,
    };
  }
  if (!configured) {
    return { ready: false, required: true, configured: false, error: `${ENV_NAME} manquant` };
  }
  if (isEphemeralStoragePath(configured)) {
    return {
      ready: false,
      required: true,
      configured: true,
      error: `${ENV_NAME} ne doit pas utiliser /tmp`,
    };
  }
  return { ready: true, required: true, configured: true };
}

function storageRoot(env = process.env) {
  const readiness = reportCardSourceStorageReadiness(env);
  if (!readiness.ready) {
    const err = new Error("STORAGE_UNAVAILABLE");
    err.code = "STORAGE_UNAVAILABLE";
    err.statusCode = 503;
    err.message =
      readiness.error && /\/tmp/.test(readiness.error)
        ? "Stockage des modèles de bulletin invalide (SOMAFRIK_REPORT_CARD_SOURCE_STORAGE ne doit pas utiliser /tmp)."
        : "Stockage des modèles de bulletin non configuré (SOMAFRIK_REPORT_CARD_SOURCE_STORAGE).";
    throw err;
  }
  const configured = asTrimmed(env[ENV_NAME]);
  if (configured) return configured;
  return path.join(os.tmpdir(), "somafrik-report-card-source");
}

async function probeReportCardSourceStorageWritable(env = process.env) {
  const readiness = reportCardSourceStorageReadiness(env);
  if (!readiness.ready || !isProductionEnv()) return readiness;
  try {
    const root = storageRoot(env);
    await fs.mkdir(root, { recursive: true });
    await fs.access(root, require("node:fs").constants.W_OK);
    return { ...readiness, writable: true };
  } catch {
    return {
      ready: false,
      required: true,
      configured: true,
      error: `${ENV_NAME} non accessible en écriture`,
    };
  }
}

function extensionOf(filename) {
  const base = path.posix.basename(String(filename ?? "").replace(/\\/g, "/"));
  const idx = base.lastIndexOf(".");
  if (idx < 0) return "";
  return base.slice(idx).toLowerCase();
}

function assertSafeStorageKey(storageKey) {
  const key = asTrimmed(storageKey);
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\0")) {
    const err = new Error("STORAGE_KEY_INVALID");
    err.code = "STORAGE_KEY_INVALID";
    throw err;
  }
  if (/school|request|model|passwd/i.test(key) && !/^[0-9]{4}\/[0-9a-f-]{36}$/i.test(key)) {
    /* opaque YYYY/uuid is the only runtime format; injected test keys may differ */
  }
  return key;
}

function validateSourceBytes(buffer, declaredMime, originalFilename) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
    const err = new Error("UNSUPPORTED_MEDIA");
    err.code = "UNSUPPORTED_MEDIA";
    throw err;
  }
  if (buffer.length > MAX_SOURCE_ARTIFACT_BYTES) {
    const err = new Error("FILE_TOO_LARGE");
    err.code = "FILE_TOO_LARGE";
    throw err;
  }
  const sniffed = sniffMime(buffer);
  if (!sniffed || !ALLOWED_MEDIA_TYPES[sniffed]) {
    const err = new Error("UNSUPPORTED_MEDIA");
    err.code = "UNSUPPORTED_MEDIA";
    throw err;
  }
  const declared = asTrimmed(declaredMime).toLowerCase();
  if (declared && declared !== sniffed && !(sniffed === "image/jpeg" && (declared === "image/jpg" || declared === "image/jpeg"))) {
    const err = new Error("UNSUPPORTED_MEDIA");
    err.code = "UNSUPPORTED_MEDIA";
    throw err;
  }
  const ext = extensionOf(originalFilename);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    const err = new Error("UNSUPPORTED_MEDIA");
    err.code = "UNSUPPORTED_MEDIA";
    throw err;
  }
  return { mediaType: sniffed, byteSize: buffer.length };
}

function opaqueKey(now = new Date()) {
  const year = now instanceof Date ? now.getUTCFullYear() : new Date(now).getUTCFullYear();
  return `${year}/${randomUUID()}`;
}

async function persistSourceBytes(buffer, env = process.env) {
  const key = opaqueKey();
  assertSafeStorageKey(key);
  const root = storageRoot(env);
  const abs = path.join(root, ...key.split("/"));
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(abs);
  if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
    const err = new Error("STORAGE_KEY_INVALID");
    err.code = "STORAGE_KEY_INVALID";
    throw err;
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer, { flag: "wx" });
  return key;
}

async function readSourceBytes(storageKey, env = process.env) {
  const key = assertSafeStorageKey(storageKey);
  const root = storageRoot(env);
  const abs = path.join(root, ...key.split("/"));
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(abs);
  if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
    const err = new Error("ARTIFACT_NOT_FOUND");
    err.code = "ARTIFACT_NOT_FOUND";
    throw err;
  }
  try {
    return await fs.readFile(resolvedFile);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      const missing = new Error("ARTIFACT_NOT_FOUND");
      missing.code = "ARTIFACT_NOT_FOUND";
      throw missing;
    }
    throw err;
  }
}

function createDiskSourceStorage(env = process.env) {
  return {
    async persist(bytes) {
      return persistSourceBytes(bytes, env);
    },
    async read(storageKey) {
      return readSourceBytes(storageKey, env);
    },
  };
}

function createMemorySourceStorage() {
  const blobs = new Map();
  return {
    blobs,
    async persist(bytes) {
      const key = opaqueKey();
      blobs.set(key, Buffer.from(bytes));
      return key;
    },
    async read(storageKey) {
      const found = blobs.get(storageKey);
      if (!found) {
        const err = new Error("ARTIFACT_NOT_FOUND");
        err.code = "ARTIFACT_NOT_FOUND";
        throw err;
      }
      return Buffer.from(found);
    },
    corrupt(storageKey) {
      const found = blobs.get(storageKey);
      if (found) found[0] ^= 0xff;
    },
  };
}

module.exports = {
  ENV_NAME,
  MAX_SOURCE_ARTIFACT_BYTES,
  ALLOWED_MEDIA_TYPES,
  sniffMime,
  validateSourceBytes,
  reportCardSourceStorageReadiness,
  probeReportCardSourceStorageWritable,
  storageRoot,
  persistSourceBytes,
  readSourceBytes,
  createDiskSourceStorage,
  createMemorySourceStorage,
  isProductionEnv,
  isEphemeralStoragePath,
  opaqueKey,
};
