"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { asTrimmed, createClientsError, CLIENTS_ERROR } = require("./clientsManagement");

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = Object.freeze({
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
]);

function isProductionEnv() {
  return String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

function isEphemeralStoragePath(root) {
  const resolved = path.resolve(String(root ?? ""));
  const tmp = path.resolve(require("node:os").tmpdir());
  const prefixes = [tmp, "/tmp", "/var/tmp"];
  return prefixes.some((base) => resolved === base || resolved.startsWith(`${base}${path.sep}`));
}

/**
 * Readiness PJ Communications.
 * Préprod/production (NODE_ENV=production) : SOMAFRIK_COMMUNICATION_STORAGE obligatoire,
 * hors /tmp. Dev/test : fallback tmp autorisé.
 */
function communicationStorageReadiness() {
  const configured = asTrimmed(process.env.SOMAFRIK_COMMUNICATION_STORAGE);
  if (!isProductionEnv()) {
    return {
      ready: true,
      required: false,
      configured: Boolean(configured),
      ephemeralFallback: !configured,
    };
  }
  if (!configured) {
    return {
      ready: false,
      required: true,
      configured: false,
      error: "SOMAFRIK_COMMUNICATION_STORAGE manquant",
    };
  }
  if (isEphemeralStoragePath(configured)) {
    return {
      ready: false,
      required: true,
      configured: true,
      error: "SOMAFRIK_COMMUNICATION_STORAGE ne doit pas utiliser /tmp",
    };
  }
  return { ready: true, required: true, configured: true };
}

/**
 * Stockage des pièces jointes Communications.
 * Variable : SOMAFRIK_COMMUNICATION_STORAGE = répertoire durable (mount local).
 * Production : obligatoire, sinon fail-closed. /tmp interdit.
 * test/dev : fallback tmp autorisé.
 */
function storageRoot() {
  const readiness = communicationStorageReadiness();
  if (!readiness.ready) {
    throw createClientsError(
      503,
      readiness.error === "SOMAFRIK_COMMUNICATION_STORAGE ne doit pas utiliser /tmp"
        ? "Stockage des pièces jointes invalide (SOMAFRIK_COMMUNICATION_STORAGE ne doit pas utiliser /tmp)."
        : "Stockage des pièces jointes non configuré (SOMAFRIK_COMMUNICATION_STORAGE).",
      CLIENTS_ERROR.FORBIDDEN,
    );
  }
  const configured = asTrimmed(process.env.SOMAFRIK_COMMUNICATION_STORAGE);
  if (configured) return configured;
  return path.join(require("node:os").tmpdir(), "somafrik-communication-attachments");
}

async function probeCommunicationStorageWritable() {
  const readiness = communicationStorageReadiness();
  if (!readiness.ready || !isProductionEnv()) return readiness;
  try {
    const root = storageRoot();
    await fs.mkdir(root, { recursive: true });
    await fs.access(root, require("node:fs").constants.W_OK);
    return { ...readiness, writable: true };
  } catch {
    return {
      ready: false,
      required: true,
      configured: true,
      error: "SOMAFRIK_COMMUNICATION_STORAGE non accessible en écriture",
    };
  }
}

function sniffMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "application/pdf";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  return null;
}

function extensionOf(filename) {
  const base = path.posix.basename(String(filename ?? "").replace(/\\/g, "/"));
  const idx = base.lastIndexOf(".");
  if (idx < 0) return "";
  return base.slice(idx).toLowerCase();
}

function sanitizeFileName(rawName, mimeType) {
  const replaced = String(rawName ?? "").replace(/\\/g, "/");
  if (replaced.includes("\0") || replaced.includes("..")) {
    /* neutralized below via basename */
  }
  let base = path.posix.basename(replaced);
  base = base.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  const ext = extensionOf(base);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw createClientsError(400, "Type de fichier non autorisé.", CLIENTS_ERROR.FORBIDDEN);
  }
  const allowedExt = ALLOWED_MIME[mimeType] ?? [];
  if (!allowedExt.includes(ext)) {
    const fallback = allowedExt[0] || "";
    const stem = (ext ? base.slice(0, -ext.length) : base).replace(/_+/g, "_") || "fichier";
    base = `${stem}${fallback}`;
  }
  if (!base || base === "." || base === "..") {
    throw createClientsError(400, "Nom de fichier invalide.", CLIENTS_ERROR.FORBIDDEN);
  }
  return base;
}

function assertSafeStorageKey(storageKey) {
  const key = asTrimmed(storageKey);
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\0")) {
    throw createClientsError(400, "Clé de stockage invalide.", CLIENTS_ERROR.FORBIDDEN);
  }
  return key;
}

function validateUploadBuffer(buffer, declaredMime, fileName) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
    throw createClientsError(400, "Fichier vide.", CLIENTS_ERROR.FORBIDDEN);
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw createClientsError(400, "Le fichier dépasse la taille autorisée (10 Mo).", CLIENTS_ERROR.FORBIDDEN);
  }
  const sniffed = sniffMime(buffer);
  if (!sniffed || !ALLOWED_MIME[sniffed]) {
    throw createClientsError(400, "Type de fichier non autorisé.", CLIENTS_ERROR.FORBIDDEN);
  }
  const declared = asTrimmed(declaredMime).toLowerCase();
  if (declared && declared !== sniffed && !(sniffed === "image/jpeg" && declared === "image/jpg")) {
    throw createClientsError(400, "Type de fichier non autorisé.", CLIENTS_ERROR.FORBIDDEN);
  }
  const ext = extensionOf(fileName);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw createClientsError(400, "Type de fichier non autorisé.", CLIENTS_ERROR.FORBIDDEN);
  }
  const safeName = sanitizeFileName(fileName, sniffed);
  return { mimeType: sniffed, fileName: safeName, fileSize: buffer.length };
}

async function persistAttachmentBytes(schoolId, buffer) {
  const key = `${schoolId}/${new Date().getUTCFullYear()}/${randomUUID()}`;
  const abs = path.join(storageRoot(), ...key.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer, { flag: "wx" });
  return key;
}

async function removeStoredAttachment(storageKey) {
  try {
    const key = assertSafeStorageKey(storageKey);
    const abs = path.join(storageRoot(), ...key.split("/"));
    const resolvedRoot = path.resolve(storageRoot());
    const resolvedFile = path.resolve(abs);
    if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) return;
    await fs.unlink(resolvedFile);
  } catch {
    /* best-effort cleanup */
  }
}

async function readAttachmentBytes(storageKey) {
  const key = assertSafeStorageKey(storageKey);
  const abs = path.join(storageRoot(), ...key.split("/"));
  const resolvedRoot = path.resolve(storageRoot());
  const resolvedFile = path.resolve(abs);
  if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
    throw createClientsError(404, "Pièce jointe introuvable.", CLIENTS_ERROR.FORBIDDEN);
  }
  return fs.readFile(resolvedFile);
}

function mapAttachmentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    schoolId: row.school_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size) || 0,
    uploadedByUserId: row.uploaded_by_user_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    status: row.status,
  };
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  ALLOWED_MIME,
  sniffMime,
  sanitizeFileName,
  validateUploadBuffer,
  persistAttachmentBytes,
  removeStoredAttachment,
  readAttachmentBytes,
  mapAttachmentRow,
  storageRoot,
  isProductionEnv,
  isEphemeralStoragePath,
  communicationStorageReadiness,
  probeCommunicationStorageWritable,
};
