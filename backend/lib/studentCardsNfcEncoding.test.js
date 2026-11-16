"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { normalizeNfcIdentity, readNfcEnabled, assertNfcEnabled, confirmStudentCardNfc } = require("./studentCardsNfcEncoding");
const { scanStudentCard, generateCardSecrets } = require("./studentAccessCardsManagement");
const { reserveStudentCardNfc } = require("./studentCardsNfcLifecycle");
const { RbacService } = require("../services/rbacService");
const UID = "04112233445566";
const scope = { schoolId: "school-a", loginCode: "CD-IN-26-001" };
const principal = { role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], permissions: ["Élèves:UPDATE"], schoolCode: scope.loginCode, enrollmentSchoolId: scope.schoolId };

// Transactional mutation cases from #909 now run on real PostgreSQL in
// studentCardsNfcLifecycle.pg.test.js, including all tenant/hash/state/audit guards.
test("NFC UID normalization, only NTAG213/216", () => {
  assert.deepEqual(normalizeNfcIdentity({ uid: "04:11:22:33:44:55:66", tagType: "NTAG216" }), { uid: UID, tagType: "NTAG216" });
  for (const value of [null, {}, { uid: "11223344", tagType: "NTAG213" }, { uid: UID, tagType: "NTAG215" }, { uid: UID, tagType: "Navigo" }]) assert.throws(() => normalizeNfcIdentity(value), { code: "STUDENT_CARD_NFC_INVALID" });
});
test("NFC flags fail closed, including non-boolean and missing settings", async () => {
  let settings = { student_card_enabled: true, student_card_nfc_enabled: true };
  const repo = { getSchoolSettingsStore: () => ({getSettings: async () => settings}) };
  assert.equal(await readNfcEnabled(repo,scope.schoolId),true);
  for (const value of [false,"true",null,undefined]) {
    settings.student_card_nfc_enabled=value;
    assert.equal(await readNfcEnabled(repo,scope.schoolId),false);
    await assert.rejects(assertNfcEnabled(repo,scope.schoolId),{code:"STUDENT_CARD_NFC_DISABLED"});
  }
  settings=null;
  assert.equal(await readNfcEnabled(repo,scope.schoolId),false);
});
test("NFC confirmation RBAC: school UPDATE only, platform and READ-only denied", () => {
  const rbac=new RbacService(); const route="POST /api/student-cards/:id/nfc-confirm";
  assert.equal(rbac.canAccess(principal,route),true);
  for (const role of ["SUPER_ADMIN","COUNTRY_ADMIN"]) assert.equal(rbac.canAccess({roleKeys:[role],permissions:["ALL_PRIVILEGES","Élèves:UPDATE"]},route),false);
  assert.equal(rbac.canAccess({role:"Enseignant",permissions:["Élèves:READ"]},route),false);
});
test("Unconfirmed reservation cannot resolve or write attendance", async () => {
  const g=generateCardSecrets();const card={public_id:g.publicId,token_hash:g.tokenHash,status:"issued",nfc_encoding_state:"pending"};
  const repo={getSchoolSettingsStore:()=>({getSettings:async()=>({student_card_enabled:true})}),getStudentAccessCardsStore:()=>({findByPublicIdInSchool:async()=>card})};
  await assert.rejects(scanStudentCard(repo,{cardToken:g.cardToken,attendance:{status:"present"}},scope),{code:"STUDENT_CARD_INVALID_STATE"});
});
test("No transaction or audit support: confirmation fails closed before writes",async()=>{
  let writes=0;const repo={query:async()=>{writes++;}};
  await assert.rejects(confirmStudentCardNfc(repo,randomUUID(),{uid:UID,tagType:"NTAG216",locked:false,cardToken:generateCardSecrets().cardToken},principal,{},scope),{code:"STUDENT_CARD_NFC_POSTGRES_REQUIRED"});
  assert.equal(writes,0);
});
test("Operation UUID is required before reserving a physical card",async()=>{
  for(const operationId of [undefined,"not-an-operation",42]) await assert.rejects(reserveStudentCardNfc({}, {nfc:{uid:UID,tagType:"NTAG216"},operationId},principal,{},scope),{code:"STUDENT_CARD_NFC_OPERATION_REQUIRED"});
});
