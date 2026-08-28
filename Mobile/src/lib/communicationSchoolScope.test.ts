import assert from "node:assert/strict";
import {
  hasCommunicationSchoolScope,
  resolveCommunicationSchoolScope,
  withCommunicationSchoolPayload,
  withCommunicationSchoolScope,
} from "./communicationSchoolScope";

assert.equal(
  withCommunicationSchoolScope("/backoffice/messages/recipients", "SCH-COM-A"),
  "/backoffice/messages/recipients?effectiveSchoolCode=SCH-COM-A",
);
assert.equal(
  withCommunicationSchoolScope("/backoffice/conversations?cursor=1", "SCH-COM-A"),
  "/backoffice/conversations?cursor=1&effectiveSchoolCode=SCH-COM-A",
);
assert.match(
  withCommunicationSchoolScope("https://api.example/api/backoffice/communications/attachments", "SCH-COM-A"),
  /effectiveSchoolCode=SCH-COM-A/,
);

let active = "SCH-COM-A";
assert.ok(withCommunicationSchoolScope("/backoffice/conversations", active).includes("SCH-COM-A"));
active = "SCH-COM-B";
assert.ok(withCommunicationSchoolScope("/backoffice/conversations", active).includes("effectiveSchoolCode=SCH-COM-B"));
assert.ok(!withCommunicationSchoolScope("/backoffice/conversations", active).includes("SCH-COM-A"));
assert.equal(withCommunicationSchoolPayload({ message: "x" }, active).effectiveSchoolCode, "SCH-COM-B");

assert.equal(hasCommunicationSchoolScope(""), false);
assert.equal(hasCommunicationSchoolScope("*"), false);
assert.equal(resolveCommunicationSchoolScope("*"), "");
assert.equal(withCommunicationSchoolScope("/backoffice/conversations", "*"), "/backoffice/conversations");
assert.deepEqual(withCommunicationSchoolPayload({ message: "x" }, "*"), { message: "x" });

assert.equal(
  withCommunicationSchoolScope("/backoffice/conversations", "CD-2026-0001"),
  "/backoffice/conversations?effectiveSchoolCode=CD-2026-0001",
);
assert.equal(withCommunicationSchoolScope("/backoffice/conversations", "*"), "/backoffice/conversations");

console.log("communicationSchoolScope.test.ts OK");
