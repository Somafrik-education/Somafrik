"use strict";

const assert = require("assert");
const { buildCleanupState, auditState } = require("./teacherHistoricalPreprodCleanup");

const state = {
  teachers: [
    { id: "TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1", schoolCode: "S1", userId: "U1" },
    { id: "TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c", schoolCode: "S1", userId: "U1" },
    { id: "TEACHERS-bad5646f-d53a-43b8-b2c1-fa87e6d719dd", schoolCode: "S1", userId: "U2" },
    { id: "TEACHERS-3a94b3c9-ad41-49e9-996f-b1fe62e7f6c1", schoolCode: "S1", userId: "U2" },
    { id: "TEACHERS-a40a415a-ceda-4ffa-9a66-f2d17c476567", schoolCode: "S2", userId: "U3", identifier: "ENS-0002", publicId: "CD-2026-0002-ENS-0001" },
    { id: "TEACHERS-beb4064e-3dbe-4ee9-a09b-c1653b5ed692", schoolCode: "S2", userId: "U4", identifier: "ENS-0001", publicId: "CD-2026-0002-ENS-0001" },
  ],
  grades: [{ id: "G1", teacherId: "TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1" }],
  notes: [{ id: "N1", authorId: "TEACHERS-bad5646f-d53a-43b8-b2c1-fa87e6d719dd" }],
};
const before = JSON.stringify(state);
const cleaned = buildCleanupState(state);
assert.strictEqual(JSON.stringify(state), before);
assert.strictEqual(cleaned.teachers.length, 4);
assert.strictEqual(cleaned.grades[0].teacherId, "TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c");
assert.strictEqual(cleaned.notes[0].authorId, "TEACHERS-3a94b3c9-ad41-49e9-996f-b1fe62e7f6c1");
assert.strictEqual(
  cleaned.teachers.find((teacher) => teacher.id === "TEACHERS-a40a415a-ceda-4ffa-9a66-f2d17c476567").publicId,
  "CD-2026-0002-ENS-0002",
);
const audit = auditState(cleaned);
assert.deepStrictEqual(audit.duplicateUserIds, []);
assert.deepStrictEqual(audit.duplicatePublicIds, []);
console.log("teacherHistoricalPreprodCleanup.test.js : OK");
