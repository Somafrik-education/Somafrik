"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
  const {
    sniffMime,
    sanitizeFileName,
    validateUploadBuffer,
    persistAttachmentBytes,
    removeStoredAttachment,
    readAttachmentBytes,
    storageRoot,
    isProductionEnv,
    isEphemeralStoragePath,
    communicationStorageReadiness,
    MAX_ATTACHMENT_BYTES,
  } = require("./communicationsAttachments");
const { classifyActor, validateBody, MESSAGE_MAX_LENGTH } = require("./communicationsMessagesService");

function pdfBuffer() {
  return Buffer.from("%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
}

function pngBuffer() {
  return Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082", "hex");
}

async function main() {
  assert.equal(sniffMime(pdfBuffer()), "application/pdf");
  assert.equal(sniffMime(pngBuffer()), "image/png");
  assert.equal(sniffMime(Buffer.from("MZ executable")), null);

  const pdf = validateUploadBuffer(pdfBuffer(), "application/pdf", "../../etc/passwd.pdf");
  assert.equal(pdf.mimeType, "application/pdf");
  assert.equal(pdf.fileName, "passwd.pdf");

  assert.throws(
    () => validateUploadBuffer(Buffer.from("MZ"), "application/pdf", "virus.exe"),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => validateUploadBuffer(pdfBuffer(), "application/pdf", "payload.exe"),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => validateUploadBuffer(Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x25), "application/pdf", "big.pdf"),
    (error) => error.statusCode === 400,
  );
  assert.equal(sanitizeFileName("ok.png", "image/png"), "ok.png");

  assert.equal(classifyActor("Parent", ["PARENT"]), "parent");
  assert.equal(classifyActor("Enseignant", ["TEACHER"]), "teacher");
  assert.equal(classifyActor("Admin School", ["SCHOOL_ADMIN"]), "school_staff");
  assert.equal(validateBody("bonjour"), "bonjour");
  assert.throws(() => validateBody("   "), (error) => error.statusCode === 400);
  assert.throws(() => validateBody("x".repeat(MESSAGE_MAX_LENGTH + 1)), (error) => error.statusCode === 400);
  assert.equal(validateBody("<script>alert(1)</script>"), "<script>alert(1)</script>");

  const previousEnv = process.env.NODE_ENV;
  const previousStorage = process.env.SOMAFRIK_COMMUNICATION_STORAGE;
  delete process.env.SOMAFRIK_COMMUNICATION_STORAGE;
  process.env.NODE_ENV = "test";
  assert.equal(isProductionEnv(), false);
  assert.match(storageRoot(), /somafrik-communication-attachments/);

  process.env.NODE_ENV = "production";
  assert.equal(communicationStorageReadiness().ready, false);
  assert.throws(
    () => storageRoot(),
    (error) => error.statusCode === 503 && /SOMAFRIK_COMMUNICATION_STORAGE/.test(error.message),
  );
  process.env.SOMAFRIK_COMMUNICATION_STORAGE = "/tmp/somafrik-pj";
  assert.equal(isEphemeralStoragePath("/tmp/somafrik-pj"), true);
  assert.equal(communicationStorageReadiness().ready, false);
  assert.match(String(communicationStorageReadiness().error), /\/tmp/);
  assert.throws(
    () => storageRoot(),
    (error) => error.statusCode === 503 && /\/tmp/.test(error.message),
  );
  const durableParent = path.join(__dirname, "../../.tmp-communication-storage");
  await fs.mkdir(durableParent, { recursive: true });
  const durable = await fs.mkdtemp(path.join(durableParent, "c2-"));
  process.env.SOMAFRIK_COMMUNICATION_STORAGE = durable;
  assert.equal(communicationStorageReadiness().ready, true);
  const key = await persistAttachmentBytes("school-a", pdfBuffer());
  const firstRead = await readAttachmentBytes(key);
  assert.ok(firstRead.length > 0, "production + stockage configuré : read OK");
  const afterRestart = await readAttachmentBytes(key);
  assert.deepEqual(afterRestart, firstRead, "redémarrage logique : même fichier");
  await persistAttachmentBytes("school-a", pdfBuffer());
  await removeStoredAttachment(key);
  await assert.rejects(() => readAttachmentBytes(key), (error) => error.code === "ENOENT" || error.statusCode === 404);
  await fs.rm(durable, { recursive: true, force: true });

  process.env.NODE_ENV = previousEnv;
  if (previousStorage == null) delete process.env.SOMAFRIK_COMMUNICATION_STORAGE;
  else process.env.SOMAFRIK_COMMUNICATION_STORAGE = previousStorage;

  console.log("communicationsAttachments.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
