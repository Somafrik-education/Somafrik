"use strict";

const assert = require("node:assert/strict");
const {
  sniffMime,
  sanitizeFileName,
  validateUploadBuffer,
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

  console.log("communicationsAttachments.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
