import assert from "node:assert/strict";
import {
  buildMessagePayload,
  collectSuccessfulAttachmentIds,
  isAllowedMessageAttachmentMime,
} from "./messageAttachments";

assert.equal(isAllowedMessageAttachmentMime("application/pdf"), true);
assert.equal(isAllowedMessageAttachmentMime("image/png"), true);
assert.equal(isAllowedMessageAttachmentMime("application/x-msdownload"), false);

const none = buildMessagePayload({
  message: "Bonjour",
  recipientUserId: "parent-a",
});
assert.equal(none.ok, true);
if (none.ok) {
  assert.deepEqual(none.payload.participantUserIds, ["parent-a"]);
  assert.equal(none.payload.attachmentIds, undefined);
  assert.equal(none.payload.attachmentUrl, undefined);
}

const onePdf = buildMessagePayload({
  message: "Convocation",
  recipientUserId: "parent-a",
  attachmentIds: ["att-pdf"],
});
assert.equal(onePdf.ok, true);
if (onePdf.ok) {
  assert.deepEqual(onePdf.payload.attachmentIds, ["att-pdf"]);
  assert.equal(onePdf.payload.attachmentUrl, undefined);
}

const multi = buildMessagePayload({
  message: "Dossier",
  conversationId: "conv-1",
  attachmentIds: ["att-pdf", "att-png"],
});
assert.equal(multi.ok, true);
if (multi.ok) {
  assert.deepEqual(multi.payload.attachmentIds, ["att-pdf", "att-png"]);
  assert.equal(multi.payload.participantUserIds, undefined);
}

const failedUpload = collectSuccessfulAttachmentIds([
  { ok: true, id: "att-pdf" },
  { ok: false },
]);
assert.equal(failedUpload.ok, false);
if (!failedUpload.ok) assert.equal(failedUpload.code, "upload_failed");

const forbiddenUrl = buildMessagePayload({
  message: "x",
  recipientUserId: "parent-a",
  attachmentUrl: "https://evil.example/a.pdf",
});
assert.equal(forbiddenUrl.ok, false);
if (!forbiddenUrl.ok) assert.equal(forbiddenUrl.code, "client_attachment_url_forbidden");

console.log("messageAttachments.test.ts OK");
