import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildConversationReplyPayload,
  buildMessagePayload,
  collectSuccessfulAttachmentIds,
  conversationReplyPath,
  isAllowedMessageAttachmentMime,
  isSameActiveConversation,
  replyPostConfirmAction,
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

const missingConversation = buildConversationReplyPayload({ message: "Réponse" });
assert.equal(missingConversation.ok, false);
if (!missingConversation.ok) assert.equal(missingConversation.code, "missing_conversation");

const emptyReply = buildConversationReplyPayload({ conversationId: "conv-1", message: "   " });
assert.equal(emptyReply.ok, false);
if (!emptyReply.ok) assert.equal(emptyReply.code, "empty_message");

const reply = buildConversationReplyPayload({
  conversationId: "conv-42",
  message: "  Bien reçu  ",
  attachmentIds: ["att-1"],
});
assert.equal(reply.ok, true);
if (reply.ok) {
  assert.equal(reply.payload.message, "Bien reçu");
  assert.equal(reply.payload.conversationId, "conv-42");
  assert.deepEqual(reply.payload.attachmentIds, ["att-1"]);
  assert.equal(Object.prototype.hasOwnProperty.call(reply.payload, "participantUserIds"), false);
}

assert.equal(conversationReplyPath(""), null);
assert.equal(conversationReplyPath("  "), null);
assert.equal(conversationReplyPath("conv-42"), "/backoffice/conversations/conv-42/messages");
assert.equal(
  conversationReplyPath("conv/special"),
  "/backoffice/conversations/conv%2Fspecial/messages",
);

assert.equal(isSameActiveConversation("conv-A", "conv-A"), true);
assert.equal(isSameActiveConversation(" conv-A ", "conv-A"), true);
assert.equal(isSameActiveConversation("conv-B", "conv-A"), false);
assert.equal(isSameActiveConversation("", "conv-A"), false);
assert.equal(isSameActiveConversation(null, "conv-A"), false);

const mutateFailed = replyPostConfirmAction({
  mutationConfirmed: false,
  refreshFailed: false,
  activeConversationId: "conv-1",
  sentConversationId: "conv-1",
});
assert.equal(mutateFailed.announceSendFailure, true);
assert.equal(mutateFailed.applyThread, false);

const confirmedRefreshKo = replyPostConfirmAction({
  mutationConfirmed: true,
  refreshFailed: true,
  activeConversationId: "conv-1",
  sentConversationId: "conv-1",
});
assert.equal(confirmedRefreshKo.announceSendFailure, false, "POST confirmé + refresh KO ne doit pas annoncer Envoi impossible");
assert.equal(confirmedRefreshKo.applyThread, false);
assert.equal(confirmedRefreshKo.announceRefreshWarning, true);

const staleConversation = replyPostConfirmAction({
  mutationConfirmed: true,
  refreshFailed: false,
  activeConversationId: "conv-B",
  sentConversationId: "conv-A",
});
assert.equal(staleConversation.applyThread, false, "un refresh de l'ancienne conversation ne doit pas remplacer le fil courant");
assert.equal(staleConversation.announceSendFailure, false);
assert.equal(staleConversation.announceRefreshWarning, false);

const closedModal = replyPostConfirmAction({
  mutationConfirmed: true,
  refreshFailed: false,
  activeConversationId: "",
  sentConversationId: "conv-A",
});
assert.equal(closedModal.applyThread, false);

const confirmedOk = replyPostConfirmAction({
  mutationConfirmed: true,
  refreshFailed: false,
  activeConversationId: "conv-1",
  sentConversationId: "conv-1",
});
assert.equal(confirmedOk.applyThread, true);
assert.equal(confirmedOk.announceSendFailure, false);
assert.equal(confirmedOk.announceRefreshWarning, false);

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function readRepo(relativePath: string) {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}
function sliceBetween(source: string, startToken: string, endToken: string, label: string) {
  const start = source.indexOf(startToken);
  const end = source.lastIndexOf(endToken);
  assert.notEqual(start, -1, `${label}: début introuvable`);
  assert.ok(end > start, `${label}: fin introuvable`);
  return source.slice(start, end + endToken.length);
}

const screen = readRepo("screens/MessagesScreen.tsx");
const api = readRepo("services/api.ts");
const modal = sliceBetween(
  screen,
  "<Modal visible={Boolean(selectedConversation)}",
  "</Modal>",
  "modal Messages",
);

assert.match(modal, /FormField/, "le modal fil Messages n'a pas de champ de saisie");
assert.match(modal, /Envoyer|replyInThread/, "le modal fil Messages n'expose pas l'action Envoyer");
assert.match(modal, /canReplyInThread/, "le composer de réponse du fil n'est pas gated par Messages:CREATE");
assert.match(modal, /messages-thread-reply-forbidden/, "état sans CREATE absent du modal");
assert.match(modal, /KeyboardAvoidingContainer/, "le modal n'évite pas le clavier");
assert.match(modal, /styles\.threadSendButton/, "le CTA Envoyer du fil n'utilise pas la cible tactile dédiée");
assert.match(screen, /threadSendButton: \{ minHeight: MIN_TOUCH_TARGET_DP/, "cible tactile fil < 44 dp");
assert.match(screen, /Message est obligatoire/, "la réponse vide n'est pas refusée");
assert.match(screen, /buildConversationReplyPayload/);
assert.match(screen, /replyClientsConversationMessage/);
assert.match(screen, /getCanonicalConversationMessages\(conversationId/);
assert.match(screen, /replyPostConfirmAction/);
assert.match(screen, /selectedConversationIdRef/);
assert.match(screen, /Fil non actualisé/);
assert.match(
  screen,
  /path:\s*`\/backoffice\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/messages`/,
);
const replyFn = sliceBetween(screen, "const replyInThread = async", "const openConversation", "replyInThread");
assert.equal((replyFn.match(/try \{/g) ?? []).length >= 3, true, "mutation et refresh doivent être dans des try séparés");
assert.match(replyFn, /Alert\.alert\(\s*"Envoi impossible"/);
const refreshSlice = replyFn.slice(replyFn.indexOf("getCanonicalConversationMessages(conversationId"));
assert.doesNotMatch(
  refreshSlice,
  /Envoi impossible/,
  "après confirmation, le refresh KO ne doit plus afficher Envoi impossible",
);
assert.match(refreshSlice, /Fil non actualisé/);
assert.match(refreshSlice, /replyPostConfirmAction/);
assert.doesNotMatch(
  modal,
  /participantUserIds/,
  "une réponse dans le fil ne doit jamais envoyer participantUserIds",
);
assert.match(api, /export function replyClientsConversationMessage/);
assert.match(
  api,
  /\/backoffice\/conversations\/\$\{encodeURIComponent\(id\)\}\/messages/,
);

console.log("messageAttachments.test.ts OK");
