"use strict";

/**
 * Logos établissement : fichier local uniquement.
 * Une URL HTTP saisie par l'utilisateur n'est jamais une référence valide.
 * Le backend peut générer un chemin interne `/api/schools/:code/logo` pour servir le fichier.
 */

const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { publicSchoolCodeFromRecord } = require("./schoolCodeV2");
const { storageRoot } = require("./communicationsAttachments");

const MAX_SCHOOL_LOGO_BYTES = 5 * 1024 * 1024;
const SCHOOL_LOGO_PREFIX = "school-logos";
const SCHOOL_LOGO_SOURCE_UPLOAD = "school_upload";
const ALLOWED_LOGO_MIME = Object.freeze({
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
});

function createLogoError(statusCode, message, code = "SCHOOL_LOGO_INVALID") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function isSafeTenantSegment(value) {
  return /^[A-Za-z0-9._-]+$/.test(asTrimmed(value));
}

function schoolLogoTenantKeys(school = {}) {
  return [school.id, school.code, school.legacySchoolCode, school.school_code]
    .map((value) => asTrimmed(value))
    .filter((value, index, all) => value && isSafeTenantSegment(value) && all.indexOf(value) === index);
}

function schoolLogoTenantKey(school = {}) {
  return schoolLogoTenantKeys(school)[0] || "";
}

function isInternalStorageKey(value) {
  const key = asTrimmed(value).replace(/\\/g, "/");
  if (!key.startsWith(`${SCHOOL_LOGO_PREFIX}/`) || key.includes("..") || key.includes("\0")) {
    return false;
  }
  const parts = key.split("/");
  return parts.length === 3 && parts[0] === SCHOOL_LOGO_PREFIX && isSafeTenantSegment(parts[1]);
}

function persistableLogoRef(value) {
  const candidate = asTrimmed(value);
  return isInternalStorageKey(candidate) ? candidate : "";
}

function canonicalLogoSource(value) {
  return asTrimmed(value).toLowerCase() === SCHOOL_LOGO_SOURCE_UPLOAD ? SCHOOL_LOGO_SOURCE_UPLOAD : "";
}

function isSchoolUploadProvenance(school = {}) {
  return canonicalLogoSource(school.logoSource) === SCHOOL_LOGO_SOURCE_UPLOAD;
}

function firstInternalLogoRef(...values) {
  for (const value of values) {
    const key = persistableLogoRef(value);
    if (key) return key;
  }
  return "";
}

function logoKeyBelongsToSchool(storageKey, school) {
  const key = persistableLogoRef(storageKey);
  if (!key) return false;
  return schoolLogoTenantKeys(school).some((tenant) => key.startsWith(`${SCHOOL_LOGO_PREFIX}/${tenant}/`));
}

function sniffLogoMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function extensionOf(filename) {
  const base = path.posix.basename(String(filename ?? "").replace(/\\/g, "/"));
  const idx = base.lastIndexOf(".");
  if (idx < 0) return "";
  return base.slice(idx).toLowerCase();
}

function validateSchoolLogoBuffer(buffer, declaredMime, fileName) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
    throw createLogoError(400, "Fichier vide.");
  }
  if (buffer.length > MAX_SCHOOL_LOGO_BYTES) {
    throw createLogoError(400, "Le logo dépasse la taille autorisée (5 Mo).");
  }
  const sniffed = sniffLogoMime(buffer);
  if (!sniffed || !ALLOWED_LOGO_MIME[sniffed]) {
    throw createLogoError(400, "Type de fichier non autorisé. PNG, JPEG ou WebP uniquement.");
  }
  const declared = asTrimmed(declaredMime).toLowerCase().split(";")[0].trim();
  if (
    declared &&
    declared !== "application/octet-stream" &&
    declared !== sniffed &&
    !(sniffed === "image/jpeg" && (declared === "image/jpg" || declared === "image/pjpeg"))
  ) {
    throw createLogoError(400, "Type de fichier non autorisé.");
  }
  const ext = extensionOf(fileName);
  if ([".exe", ".bat", ".cmd", ".com", ".js", ".mjs", ".sh", ".ps1", ".html", ".svg"].includes(ext)) {
    throw createLogoError(400, "Type de fichier non autorisé.");
  }
  return { mimeType: sniffed, fileName: `logo${ALLOWED_LOGO_MIME[sniffed]}`, fileSize: buffer.length };
}

function storageKeyForSchool(school, mimeType) {
  const tenant = schoolLogoTenantKey(school);
  if (!tenant) {
    throw createLogoError(400, "Établissement invalide.", "SCHOOL_LOGO_TENANT");
  }
  const ext = ALLOWED_LOGO_MIME[mimeType];
  if (!ext) {
    throw createLogoError(400, "Type de fichier non autorisé.");
  }
  return `${SCHOOL_LOGO_PREFIX}/${tenant}/logo-${randomUUID()}${ext}`;
}

function absoluteLogoPath(storageKey) {
  const key = persistableLogoRef(storageKey);
  if (!key) {
    throw createLogoError(404, "Logo introuvable.", "SCHOOL_LOGO_NOT_FOUND");
  }
  const abs = path.join(storageRoot(), ...key.split("/"));
  const resolvedRoot = path.resolve(storageRoot());
  const resolvedFile = path.resolve(abs);
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(resolvedRoot + path.sep)) {
    throw createLogoError(404, "Logo introuvable.", "SCHOOL_LOGO_NOT_FOUND");
  }
  return resolvedFile;
}

async function removeStoredLogo(storageKey) {
  try {
    const abs = absoluteLogoPath(storageKey);
    await fsp.unlink(abs);
  } catch {
    /* best-effort */
  }
}

async function saveSchoolLogo({ school, buffer, fileName, mimeType }) {
  const validated = validateSchoolLogoBuffer(buffer, mimeType, fileName);
  const nextKey = storageKeyForSchool(school, validated.mimeType);
  const abs = absoluteLogoPath(nextKey);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buffer);
  return { storageKey: nextKey, mimeType: validated.mimeType, fileSize: validated.fileSize };
}

async function deleteSchoolLogo(school) {
  const key = persistableLogoRef(school?.logoUrl);
  if (key && logoKeyBelongsToSchool(key, school)) {
    await removeStoredLogo(key);
  }
}

async function commitSchoolLogoUpload({ school, buffer, fileName, mimeType, persistEstablishment }) {
  if (typeof persistEstablishment !== "function") {
    throw createLogoError(500, "Persistance établissement indisponible.", "SCHOOL_LOGO_PERSIST");
  }
  const previousKey = persistableLogoRef(school?.logoUrl);
  const saved = await saveSchoolLogo({ school, buffer, fileName, mimeType });
  const uploadedAt = new Date().toISOString();
  const next = {
    ...school,
    logoUrl: saved.storageKey,
    logoSource: SCHOOL_LOGO_SOURCE_UPLOAD,
    logoUploadedAt: uploadedAt,
    updatedAt: uploadedAt,
  };
  try {
    const savedSchool = await persistEstablishment(next);
    if (previousKey && previousKey !== saved.storageKey) {
      await removeStoredLogo(previousKey);
    }
    return { school: savedSchool, storageKey: saved.storageKey, mimeType: saved.mimeType, fileSize: saved.fileSize };
  } catch (error) {
    await removeStoredLogo(saved.storageKey);
    throw error;
  }
}

async function commitSchoolLogoDelete({ school, persistEstablishment }) {
  if (typeof persistEstablishment !== "function") {
    throw createLogoError(500, "Persistance établissement indisponible.", "SCHOOL_LOGO_PERSIST");
  }
  const previousKey = persistableLogoRef(school?.logoUrl);
  const next = {
    ...school,
    logoUrl: "",
    logoSource: "",
    logoUploadedAt: "",
    updatedAt: new Date().toISOString(),
  };
  const savedSchool = await persistEstablishment(next);
  if (isSchoolUploadProvenance(school) && previousKey && logoKeyBelongsToSchool(previousKey, school)) {
    await removeStoredLogo(previousKey);
  }
  return savedSchool;
}

function mimeFromStorageKey(storageKey) {
  const ext = extensionOf(storageKey);
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

async function readSchoolLogoFile(school) {
  if (!isSchoolUploadProvenance(school)) return null;
  const key = persistableLogoRef(school?.logoUrl);
  if (!key || !logoKeyBelongsToSchool(key, school)) return null;
  try {
    const abs = absoluteLogoPath(key);
    const bytes = await fsp.readFile(abs);
    return { bytes, mimeType: mimeFromStorageKey(key) };
  } catch {
    return null;
  }
}

function resolveSchoolLogoPath(school) {
  if (!isSchoolUploadProvenance(school)) return "";
  const key = persistableLogoRef(school?.logoUrl);
  if (!key || !logoKeyBelongsToSchool(key, school)) return "";
  try {
    const abs = absoluteLogoPath(key);
    return fs.existsSync(abs) ? abs : "";
  } catch {
    return "";
  }
}

function schoolHasStoredLogo(school = {}) {
  if (!isSchoolUploadProvenance(school)) return false;
  const key = persistableLogoRef(school.logoUrl);
  return Boolean(key && logoKeyBelongsToSchool(key, school));
}

function publicSchoolLogoPath(school = {}) {
  const code = publicSchoolCodeFromRecord(school);
  if (!code || !schoolHasStoredLogo(school)) return "";
  return `/api/schools/${encodeURIComponent(code)}/logo`;
}

function presentSchoolLogoFields(school = {}) {
  if (!school || typeof school !== "object") return school;
  const hasLogo = schoolHasStoredLogo(school);
  return {
    ...school,
    hasLogo,
    logoSource: hasLogo ? SCHOOL_LOGO_SOURCE_UPLOAD : "",
    logoUploadedAt: hasLogo ? asTrimmed(school.logoUploadedAt) : "",
    logoUrl: hasLogo ? publicSchoolLogoPath(school) : "",
  };
}

function presentPublicSchoolLogoFields(school = {}) {
  const hasLogo = schoolHasStoredLogo(school);
  if (!hasLogo) return { hasLogo: false };
  return {
    hasLogo: true,
    logoSource: SCHOOL_LOGO_SOURCE_UPLOAD,
    logoUrl: publicSchoolLogoPath(school),
  };
}

module.exports = {
  MAX_SCHOOL_LOGO_BYTES,
  ALLOWED_LOGO_MIME,
  SCHOOL_LOGO_PREFIX,
  SCHOOL_LOGO_SOURCE_UPLOAD,
  persistableLogoRef,
  canonicalLogoSource,
  isSchoolUploadProvenance,
  firstInternalLogoRef,
  isInternalStorageKey,
  schoolLogoTenantKey,
  logoKeyBelongsToSchool,
  sniffLogoMime,
  validateSchoolLogoBuffer,
  saveSchoolLogo,
  deleteSchoolLogo,
  commitSchoolLogoUpload,
  commitSchoolLogoDelete,
  readSchoolLogoFile,
  resolveSchoolLogoPath,
  schoolHasStoredLogo,
  publicSchoolLogoPath,
  presentSchoolLogoFields,
  presentPublicSchoolLogoFields,
};
