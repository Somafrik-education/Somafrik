"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { STUDENT_ACCESS_CARDS_SCHEMA_SQL, STUDENT_ACCESS_CARDS_TABLE_SQL, STUDENT_ACCESS_CARDS_INDEXES_SQL } = require("../db/studentAccessCardsSchema");
const { STUDENT_CARDS_NFC_SCHEMA_SQL } = require("../db/studentCardsNfcSchema");
const { STUDENT_CARDS_NFC_RESERVATIONS_SCHEMA_SQL } = require("../db/studentCardsNfcReservationsSchema");
const { createStudentAccessCardsPgStore } = require("../db/studentAccessCardsPgStore");
const { issueStudentCard, revokeStudentCard, markStudentCardLost, replaceStudentCard, scanStudentCard, generateCardSecrets } = require("./studentAccessCardsManagement");
const { confirmStudentCardNfc, retryStudentCardNfc, recoverExpiredStudentCardNfc } = require("./studentCardsNfcEncoding");

const url = process.env.SOMAFRIK_NFC_TEST_DATABASE_URL;
async function fixture(run, legacy = false) {
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname), "Disposable local PostgreSQL required");
  assert.match(parsed.pathname, /^\/(nfc_prog_02_test|nfc_encoding_test)$/);
  const schema = `nfc_prog_${randomUUID().replace(/-/g, "")}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 8 });
  const a = randomUUID(), b = randomUUID(), actor = randomUUID();
  const students = [randomUUID(), randomUUID(), randomUUID()];
  const scope = { schoolId: a, loginCode: "CD-NFC-26-001" };
  const principal = { sub: actor, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: scope.loginCode,
    enrollmentSchoolId: a, permissions: ["Élèves:READ", "Élèves:UPDATE"] };
  const repo = { query: (sql, args) => pool.query(sql, args),
    one: async (sql, args) => (await pool.query(sql, args)).rows[0] ?? null,
    all: async (sql, args) => (await pool.query(sql, args)).rows,
    getSchoolSettingsStore: () => ({ getSettings: (id) => repo.one("SELECT * FROM school_settings WHERE school_id=$1", [id]) }),
    getStudentAccessCardsStore: () => createStudentAccessCardsPgStore(repo),
    async withTransaction(fn) {
      const client = await pool.connect();
      try { await client.query("BEGIN"); const result = await fn({query: client.query.bind(client)}); await client.query("COMMIT"); return result; }
      catch (error) { await client.query("ROLLBACK"); throw error; } finally {client.release();}
    },
    async recordAudit(entry, tx) {
      assert.ok(tx?.query, "Audit must use the same transaction");
      await tx.query("INSERT INTO audit_logs(action,entity_id,old_value,new_value) VALUES($1,$2,$3,$4)",
        [entry.action, entry.entityId, entry.oldValue, entry.newValue]);
    },
  };
  try {
    await pool.query(`CREATE TABLE schools(id UUID PRIMARY KEY); CREATE TABLE users(id UUID PRIMARY KEY);
      CREATE TABLE students(id UUID PRIMARY KEY,school_id UUID NOT NULL REFERENCES schools(id),student_code TEXT,status TEXT,
        first_name TEXT DEFAULT 'Test',last_name TEXT DEFAULT 'Student',photo_url TEXT);
      CREATE TABLE school_settings(school_id UUID PRIMARY KEY,student_card_enabled BOOLEAN,student_card_nfc_enabled BOOLEAN);
      CREATE TABLE audit_logs(id UUID DEFAULT gen_random_uuid(),action TEXT,entity_id TEXT,old_value JSONB,new_value JSONB);
      CREATE TABLE academic_years(id UUID PRIMARY KEY,school_id UUID,is_current BOOLEAN);
      CREATE TABLE classes(id UUID PRIMARY KEY,school_id UUID,academic_year_id UUID,class_code TEXT,name TEXT);
      CREATE TABLE enrollments(school_id UUID,student_id UUID,academic_year_id UUID,class_id UUID,status TEXT);`);
    await pool.query("INSERT INTO schools VALUES($1),($2)", [a,b]); await pool.query("INSERT INTO users VALUES($1)", [actor]);
    for (const [i,id] of students.entries()) await pool.query("INSERT INTO students(id,school_id,student_code,status) VALUES($1,$2,$3,'active')", [id,a,`TEST-${i}`]);
    await pool.query("INSERT INTO school_settings VALUES($1,TRUE,TRUE),($2,TRUE,TRUE)", [a,b]);
    await pool.query(legacy ? "CREATE UNIQUE INDEX ON students(school_id,id);" + STUDENT_ACCESS_CARDS_TABLE_SQL + STUDENT_ACCESS_CARDS_INDEXES_SQL + STUDENT_CARDS_NFC_SCHEMA_SQL : STUDENT_ACCESS_CARDS_SCHEMA_SQL);
    const identity = {uid:"04112233445566",tagType:"NTAG216"};
    const issue = (overrides = {}) => issueStudentCard(repo, {studentId:students[0],medium:"nfc",nfc:identity,operationId:randomUUID(),...overrides}, principal, {}, scope);
    const confirm = (card, overrides = {}) => confirmStudentCardNfc(repo,card.id,{...identity,cardToken:card.cardToken,locked:false,operationId:card.nfc.operationId,...overrides},principal,{},scope);
    const row = (id) => repo.one("SELECT * FROM student_access_cards WHERE id=$1",[id]);
    const countAudit = async (action) => (await repo.one("SELECT count(*)::int AS n FROM audit_logs WHERE action=$1",[action])).n;
    const expire = (id) => pool.query("UPDATE student_access_cards SET issued_at=clock_timestamp()-INTERVAL '31 minutes',nfc_reservation_expires_at=clock_timestamp()-INTERVAL '1 minute' WHERE id=$1",[id]);
    const failAudit = () => pool.query(`CREATE FUNCTION reject_confirm_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='student_card_nfc_encoded' THEN RAISE EXCEPTION 'audit failure injected'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_confirm_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_confirm_audit();`);
    await run({pool,repo,scope,principal,students,a,b,actor,identity,issue,confirm,row,countAudit,expire,failAudit});
  } finally { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
}
function pg(name, run, legacy = false) { test(name, {skip: !url}, () => fixture(run, legacy)); }

pg("reservation is non-active, server 30 minutes; physical write without confirmation remains unusable", async f => {
  const card = await f.issue(); const row = await f.row(card.id);
  assert.equal(card.status,"issued"); assert.equal(card.nfc.state,"pending");
  assert.equal(row.nfc_reservation_expires_at-row.issued_at,1800000);
  await assert.rejects(scanStudentCard(f.repo,{cardToken:card.cardToken},f.scope),{code:"STUDENT_CARD_INVALID_STATE"});
  assert.equal(await f.countAudit("student_card_nfc_reserved"),1);
});
pg("same reservation operation replays without storing/resending secret; divergent context refused", async f => {
  const operationId=randomUUID(); const first=await f.issue({operationId});const replay=await f.issue({operationId});
  assert.equal(replay.id,first.id);assert.equal(replay.cardToken,undefined);assert.equal(replay.idempotentReplay,true);
  assert.equal(await f.countAudit("student_card_nfc_reserved"),1);
  await assert.rejects(f.issue({operationId,studentId:f.students[1]}),{code:"STUDENT_CARD_NFC_OPERATION_CONFLICT"});
  const rows=await f.repo.all("SELECT row_to_json(c)::text AS data FROM student_access_cards c UNION ALL SELECT row_to_json(a)::text FROM audit_logs a");
  assert.equal(rows.some(r=>r.data.includes(first.cardToken.split('.')[1])),false);
});
pg("confirmation and replay activate once, audit once, and resolve canonical student",async f=>{
  const card=await f.issue(); const year=randomUUID(),cl=randomUUID();
  await f.pool.query("INSERT INTO academic_years VALUES($1,$2,TRUE)",[year,f.a]);
  await f.pool.query("INSERT INTO classes VALUES($1,$2,$3,'CL-TEST','Class test')",[cl,f.a,year]);
  await f.pool.query("INSERT INTO enrollments VALUES($1,$2,$3,$4,'active')",[f.a,f.students[0],year,cl]);
  assert.equal((await f.confirm(card)).status,"active");assert.equal((await f.confirm(card)).idempotentReplay,true);
  assert.equal(await f.countAudit("student_card_nfc_encoded"),1);
  assert.equal((await scanStudentCard(f.repo,{cardToken:card.cardToken},f.scope)).student.id,f.students[0]);
});
pg("expiration commits revocation and audit, rejects confirm/retry and preserves UID forever",async f=>{
  const card=await f.issue();await f.expire(card.id);
  await assert.rejects(f.confirm(card),{code:"STUDENT_CARD_NFC_EXPIRED"});
  assert.equal((await f.row(card.id)).status,"revoked");assert.equal(await f.countAudit("student_card_nfc_reservation_expired"),1);
  await assert.rejects(f.confirm(card),{code:"STUDENT_CARD_NFC_EXPIRED"});
  await assert.rejects(retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId:randomUUID()},f.principal,{},f.scope),{code:"STUDENT_CARD_NFC_EXPIRED"});
  await assert.rejects(f.issue(),{code:"STUDENT_CARD_NFC_UID_EXISTS"});
});
pg("valid pending retry rotates once, replays even an older operation, never extends expiry",async f=>{
  const card=await f.issue(), op=randomUUID();
  const next=await retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId:op},f.principal,{},f.scope);
  assert.equal(next.cardToken!==card.cardToken,true);assert.equal(next.publicId,card.publicId);
  const repeat=await retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId:op},f.principal,{},f.scope);
  assert.equal(repeat.cardToken,undefined);assert.equal(await f.countAudit("student_card_nfc_encoding_retried"),1);
  assert.equal(new Date(next.nfc.expiresAt).getTime(),new Date(card.nfc.expiresAt).getTime());
  await assert.rejects(f.confirm(card),{code:"STUDENT_CARD_NOT_FOUND"});await f.confirm(next);
  await assert.rejects(retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId:randomUUID()},f.principal,{},f.scope),{code:"STUDENT_CARD_INVALID_STATE"});
});
pg("two different reservations for one student: one winner",async f=>{
  const results=await Promise.allSettled([f.issue(),f.issue({nfc:{...f.identity,uid:"04778899001122"}})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await f.repo.one("SELECT count(*)::int AS n FROM student_access_cards WHERE status='issued'")).n,1);
});
pg("same operation concurrently reserves one row and emits one audit",async f=>{
  const operationId=randomUUID();const result=await Promise.all([f.issue({operationId}),f.issue({operationId})]);
  assert.equal(result[0].id,result[1].id);assert.equal(result.filter(x=>x.tokenAvailable).length,1);assert.equal(await f.countAudit("student_card_nfc_reserved"),1);
});
pg("same UID for two students: uniqueness is enforced by PostgreSQL",async f=>{
  const result=await Promise.allSettled([f.issue(),f.issue({studentId:f.students[1]})]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(result.find(x=>x.status==='rejected').reason.code,"STUDENT_CARD_NFC_UID_EXISTS");
});
pg("concurrent confirmation: one transition, one audit",async f=>{
  const card=await f.issue();const result=await Promise.all([f.confirm(card),f.confirm(card)]);
  assert.equal(result.every(x=>x.status==='active'),true);assert.equal(await f.countAudit("student_card_nfc_encoded"),1);
});
pg("concurrent retry and confirmation cannot activate an obsolete token",async f=>{
  const card=await f.issue();const result=await Promise.allSettled([f.confirm(card),retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId:randomUUID()},f.principal,{},f.scope)]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  const row=await f.row(card.id);assert.ok(['issued','active'].includes(row.status));
});
pg("concurrent revocation and confirmation end revoked, never resurrected",async f=>{
  const card=await f.issue();await Promise.allSettled([f.confirm(card),revokeStudentCard(f.repo,card.id,f.principal,{},f.scope,'revoked')]);
  assert.equal((await f.row(card.id)).status,'revoked');await assert.rejects(f.confirm(card),{code:"STUDENT_CARD_INVALID_STATE"});
});
pg("explicit replacement preserves old card until atomic confirm and links history",async f=>{
  const old=await issueStudentCard(f.repo,{studentId:f.students[0],medium:'qr'},f.principal,{},f.scope);
  const next=await replaceStudentCard(f.repo,old.id,f.principal,{},f.scope,{nfc:f.identity,operationId:randomUUID()});
  assert.equal((await f.row(old.id)).status,'active');assert.equal(next.status,'issued');
  await f.confirm(next);assert.equal((await f.row(old.id)).status,'replaced');assert.equal((await f.row(old.id)).replaced_by_card_id,next.id);
  assert.equal((await f.row(next.id)).status,'active');await f.confirm(next);assert.equal(await f.countAudit('student_card_replaced'),1);
  assert.equal((await f.repo.one("SELECT count(*)::int AS n FROM student_access_cards WHERE status='active'")).n,1);
});
pg("audit SQL failure rolls back replacement, new activation and both audits",async f=>{
  const old=await issueStudentCard(f.repo,{studentId:f.students[0],medium:'qr'},f.principal,{},f.scope);
  const next=await replaceStudentCard(f.repo,old.id,f.principal,{},f.scope,{nfc:f.identity,operationId:randomUUID()});await f.failAudit();
  await assert.rejects(f.confirm(next),/audit failure injected/);
  assert.equal((await f.row(old.id)).status,'active');assert.equal((await f.row(next.id)).status,'issued');assert.equal(await f.countAudit('student_card_replaced'),0);
  assert.equal(await f.countAudit('student_card_nfc_encoded'),0);
});
pg("audit SQL failure rolls back a normal confirmation",async f=>{
  const card=await f.issue();await f.failAudit();await assert.rejects(f.confirm(card),/audit failure injected/);
  assert.equal((await f.row(card.id)).status,'issued');assert.equal((await f.row(card.id)).nfc_encoded_at,null);
});
pg("replacement expiration or revoked source never removes a good old card",async f=>{
  const old=await issueStudentCard(f.repo,{studentId:f.students[0],medium:'qr'},f.principal,{},f.scope);
  const next=await replaceStudentCard(f.repo,old.id,f.principal,{},f.scope,{nfc:f.identity,operationId:randomUUID()});await f.expire(next.id);
  await assert.rejects(f.confirm(next),{code:'STUDENT_CARD_NFC_EXPIRED'});assert.equal((await f.row(old.id)).status,'active');
});
pg("replacement fails safely if the old card is revoked while programming",async f=>{
  const old=await f.issue();await f.confirm(old);
  const next=await replaceStudentCard(f.repo,old.id,f.principal,{},f.scope,{nfc:{...f.identity,uid:'04778899001122'},operationId:randomUUID()});
  await revokeStudentCard(f.repo,old.id,f.principal,{},f.scope,'revoked');
  await assert.rejects(f.confirm(next,{uid:'04778899001122'}),{code:'STUDENT_CARD_INVALID_STATE'});assert.equal((await f.row(next.id)).status,'issued');
});
pg("no immediate legacy replacement of a physically associated NFC card",async f=>{
  const card=await f.issue();await f.confirm(card);
  await assert.rejects(replaceStudentCard(f.repo,card.id,f.principal,{},f.scope),{code:'STUDENT_CARD_NFC_REPLACEMENT_REQUIRED'});
  assert.equal((await f.row(card.id)).status,'active');
});
pg("revocation and lost observations are idempotent and transactional",async f=>{
  const card=await f.issue();await f.confirm(card);await markStudentCardLost(f.repo,card.id,f.principal,{},f.scope,'lost');
  await markStudentCardLost(f.repo,card.id,f.principal,{},f.scope,'lost');assert.equal(await f.countAudit('student_card_lost'),1);
  await assert.rejects(f.confirm(card),{code:'STUDENT_CARD_INVALID_STATE'});
});
pg("nfc-confirm resolves a school code to the same student and still refuses every other identity", async f => {
  const foreign = randomUUID();
  const expiredStudent = randomUUID();
  const qrStudent = randomUUID();
  await f.pool.query("INSERT INTO students(id,school_id,student_code,status) VALUES($1,$2,'OTHER-SCHOOL','active'),($3,$4,'TEST-EXP','active'),($5,$4,'TEST-QR','active')", [foreign, f.b, expiredStudent, f.a, qrStudent]);
  const byCode = await f.issue({ nfc: { ...f.identity, uid: "04AABBCCDDEE01" } });
  const activated = await f.confirm(byCode, { studentId: "TEST-0", uid: "04AABBCCDDEE01" });
  assert.equal(activated.status, "active");
  assert.equal((await f.row(byCode.id)).student_id, f.students[0]);
  const byUuid = await f.issue({ studentId: f.students[1], nfc: { ...f.identity, uid: "04AABBCCDDEE02" } });
  assert.equal((await f.confirm(byUuid, { studentId: f.students[1], uid: "04AABBCCDDEE02" })).status, "active");
  const pending = await f.issue({ studentId: f.students[2], nfc: { ...f.identity, uid: "04AABBCCDDEE03" } });
  const mismatch = { code: "STUDENT_CARD_NFC_MISMATCH", statusCode: 409 };
  for (const studentId of [f.students[1], "TEST-1", "OTHER-SCHOOL", foreign, "ABSENT-CODE"]) {
    const refusal = await f.confirm(pending, { studentId, uid: "04AABBCCDDEE03" }).then(() => null, (error) => error);
    assert.equal(refusal?.code, mismatch.code);
    assert.equal(refusal?.statusCode, mismatch.statusCode);
    const rendered = JSON.stringify({ message: refusal?.message, code: refusal?.code, details: refusal?.details });
    assert.equal(rendered.includes(studentId), false);
    assert.equal(rendered.includes(pending.cardToken), false);
    assert.equal(rendered.includes("04AABBCCDDEE03"), false);
  }
  await assert.rejects(f.confirm(pending, { studentId: "TEST-2", uid: "04778899001122" }), mismatch);
  await assert.rejects(f.confirm(pending, { studentId: "TEST-2", uid: "04AABBCCDDEE03", cardToken: generateCardSecrets().cardToken }), { code: "STUDENT_CARD_NOT_FOUND" });
  const expired = await f.issue({ studentId: "TEST-EXP", nfc: { ...f.identity, uid: "04AABBCCDDEE04" } });
  await f.expire(expired.id);
  await assert.rejects(f.confirm(expired, { studentId: "TEST-EXP", uid: "04AABBCCDDEE04" }), { code: "STUDENT_CARD_NFC_EXPIRED" });
  const qr = await issueStudentCard(f.repo, { studentId: "TEST-QR", medium: "qr" }, f.principal, {}, f.scope);
  const year = randomUUID();
  const room = randomUUID();
  await f.pool.query("INSERT INTO academic_years VALUES($1,$2,TRUE)", [year, f.a]);
  await f.pool.query("INSERT INTO classes VALUES($1,$2,$3,'CL-QR','Class QR')", [room, f.a, year]);
  await f.pool.query("INSERT INTO enrollments VALUES($1,$2,$3,$4,'active')", [f.a, qrStudent, year, room]);
  const scanned = await scanStudentCard(f.repo, { cardToken: qr.cardToken }, f.scope);
  assert.equal(scanned.student.id, qrStudent);
  assert.equal(scanned.card.medium, "qr");
  assert.equal(qr.nfc, null);
  assert.equal((await f.row(pending.id)).status, "issued");
  assert.equal(await f.countAudit("student_card_nfc_encoded"), 2);
  const rendered = JSON.stringify(await f.repo.all("SELECT old_value,new_value FROM audit_logs"));
  assert.equal(rendered.includes(byCode.cardToken.split(".")[1]), false);
  for (const uid of ["04112233445566", "04AABBCCDDEE01", "04AABBCCDDEE02", "04AABBCCDDEE03", "04AABBCCDDEE04"]) {
    assert.equal(rendered.includes(uid), false);
  }
  assert.equal(rendered.includes("OTHER-SCHOOL"), false);
  assert.equal(rendered.includes("ABSENT-CODE"), false);
});
pg("wrong tenant, UID, model, student and secret are rejected without activation",async f=>{
  const card=await f.issue();
  for(const change of [{uid:'04778899001122'},{tagType:'NTAG213'},{studentId:f.students[1]},{cardToken:generateCardSecrets().cardToken}]) await assert.rejects(f.confirm(card,change));
  await assert.rejects(confirmStudentCardNfc(f.repo,card.id,{...f.identity,cardToken:card.cardToken,locked:false,operationId:card.nfc.operationId},{...f.principal,enrollmentSchoolId:f.b},{},{...f.scope,schoolId:f.b}),{code:'STUDENT_CARD_NOT_FOUND'});
  assert.equal((await f.row(card.id)).status,'issued');assert.equal(await f.countAudit('student_card_nfc_encoded'),0);
});
pg("insufficient UPDATE and platform privileges cannot reserve/confirm",async f=>{
  const card=await f.issue();
  for(const principal of [{...f.principal,permissions:['Élèves:READ']},{...f.principal,roleKeys:['SUPER_ADMIN'],permissions:['ALL_PRIVILEGES','Élèves:UPDATE']},{...f.principal,roleKeys:['COUNTRY_ADMIN'],permissions:['ALL_PRIVILEGES','Élèves:UPDATE']}]) {
    await assert.rejects(confirmStudentCardNfc(f.repo,card.id,{...f.identity,cardToken:card.cardToken,locked:false,operationId:card.nfc.operationId},principal,{},f.scope),{statusCode:403});
  }
});
pg("flags false/null/absent fail closed at reserve and confirmation including replay",async f=>{
  const card=await f.issue();await f.confirm(card);
  for(const flags of [[false,true],[true,false],[true,null]]){
    await f.pool.query('UPDATE school_settings SET student_card_enabled=$1,student_card_nfc_enabled=$2 WHERE school_id=$3',[...flags,f.a]);
    await assert.rejects(f.issue({studentId:f.students[1]}));await assert.rejects(f.confirm(card));
  }
  await f.pool.query('DELETE FROM school_settings WHERE school_id=$1',[f.a]);await assert.rejects(f.confirm(card));
});
pg("legacy migration is idempotent, preserves UID, sets original 30-minute window",async f=>{
  const g=generateCardSecrets();const store=createStudentAccessCardsPgStore(f.repo);
  const card=await f.pool.query(`INSERT INTO student_access_cards(school_id,student_id,public_id,token_hash,medium,status,nfc_uid,nfc_tag_type,nfc_encoding_state,issued_at)
    VALUES($1,$2,$3,$4,'nfc','active',$5,'NTAG216','pending',clock_timestamp()-INTERVAL '1 hour') RETURNING *`,[f.a,f.students[0],g.publicId,g.tokenHash,f.identity.uid]);
  await f.pool.query(STUDENT_CARDS_NFC_RESERVATIONS_SCHEMA_SQL);const upgraded=await f.row(card.rows[0].id);
  await f.pool.query(STUDENT_CARDS_NFC_RESERVATIONS_SCHEMA_SQL);const repeated=await f.row(upgraded.id);
  assert.equal(upgraded.status,'issued');assert.equal(upgraded.nfc_uid,f.identity.uid);assert.equal(upgraded.nfc_operation_id,repeated.nfc_operation_id);
  assert.equal(upgraded.nfc_reservation_expires_at-upgraded.issued_at,1800000);
  assert.equal(repeated.nfc_reservation_expires_at.getTime(),upgraded.nfc_reservation_expires_at.getTime());
  assert.equal((await store.getById(f.a,upgraded.id)).status,'issued');
},true);

pg("read-only observations stay monotonic and never leak capability or UID in audit",async f=>{
  const card=await f.issue();const encoded=await f.confirm(card);
  assert.equal(encoded.cardToken,undefined);assert.equal(encoded.token_hash,undefined);
  await f.confirm(card,{locked:true});await f.confirm(card,{locked:true});await f.confirm(card,{locked:false});
  assert.equal((await f.row(card.id)).nfc_encoding_state,'locked');assert.equal(await f.countAudit('student_card_nfc_locked'),1);
  const text=JSON.stringify(await f.repo.all('SELECT old_value,new_value FROM audit_logs'));
  assert.equal(text.includes(card.cardToken.split('.')[1]),false);assert.equal(text.includes(f.identity.uid),false);
  await assert.rejects(retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId:randomUUID()},f.principal,{},f.scope),{code:'STUDENT_CARD_INVALID_STATE'});
});

pg("PostgreSQL rejects cross-student replacement links and active/pending rows",async f=>{
  const card=await f.issue();const other=await f.issue({studentId:f.students[1],nfc:{...f.identity,uid:'04778899001122'}});
  await assert.rejects(f.pool.query('UPDATE student_access_cards SET nfc_replaces_card_id=$1 WHERE id=$2',[other.id,card.id]),{code:'23503'});
  await assert.rejects(f.pool.query("UPDATE student_access_cards SET status='active' WHERE id=$1",[card.id]),{code:'23514'});
  await assert.rejects(f.pool.query('UPDATE student_access_cards SET nfc_replaces_card_id=id WHERE id=$1',[card.id]),{code:'23514'});
});

pg("two replacement preparations serialize, preserving one active old card",async f=>{
  const old=await issueStudentCard(f.repo,{studentId:f.students[0],medium:'qr'},f.principal,{},f.scope);
  const results=await Promise.allSettled([
    replaceStudentCard(f.repo,old.id,f.principal,{},f.scope,{nfc:f.identity,operationId:randomUUID()}),
    replaceStudentCard(f.repo,old.id,f.principal,{},f.scope,{nfc:{...f.identity,uid:'04778899001122'},operationId:randomUUID()}),
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await f.row(old.id)).status,'active');assert.equal(await f.countAudit('student_card_nfc_reserved'),1);
});

pg("revoked reservation and retry replay cannot resurrect or reuse its UID",async f=>{
  const card=await f.issue();const operationId=randomUUID();await retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId},f.principal,{},f.scope);
  await revokeStudentCard(f.repo,card.id,f.principal,{},f.scope,'nfc_abandoned');
  await revokeStudentCard(f.repo,card.id,f.principal,{},f.scope,'nfc_abandoned');assert.equal(await f.countAudit('student_card_revoked'),1);
  await assert.rejects(retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId},f.principal,{},f.scope),{code:'STUDENT_CARD_INVALID_STATE'});
  await assert.rejects(f.issue(),{code:'STUDENT_CARD_NFC_UID_EXISTS'});
});

pg("older retry operation replays after a newer rotation without another write",async f=>{
  const card=await f.issue(), first=randomUUID(), second=randomUUID();
  await retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId:first},f.principal,{},f.scope);
  const next=await retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId:second},f.principal,{},f.scope);
  const replay=await retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId:first},f.principal,{},f.scope);
  assert.equal(replay.cardToken,undefined);assert.equal(replay.idempotentReplay,true);assert.equal(await f.countAudit('student_card_nfc_encoding_retried'),2);
  await f.confirm(next);
});

pg("valid new reservation lazily expires the old one without recycling its UID",async f=>{
  const old=await f.issue();await f.expire(old.id);
  const next=await f.issue({nfc:{...f.identity,uid:'04778899001122'}});
  assert.equal(next.status,'issued');assert.equal((await f.row(old.id)).status,'revoked');assert.equal(await f.countAudit('student_card_nfc_reservation_expired'),1);
});

pg("confirmation binds the reservation UUID even with the correct capability and UID", async f => {
  const card = await f.issue();
  await assert.rejects(f.confirm(card, {operationId: randomUUID()}), {code: "STUDENT_CARD_NFC_OPERATION_MISMATCH", statusCode: 409});
  assert.equal((await f.row(card.id)).status, "issued");
  assert.equal(await f.countAudit("student_card_nfc_encoded"), 0);
});

pg("confirmation rejects missing, null, malformed and non-string UUIDs without any mutation", async f => {
  const card = await f.issue(); const before = await f.row(card.id);
  for (const operationId of [undefined, null, "", " ", "not-a-uuid", 42, true, [card.nfc.operationId], {operationId:card.nfc.operationId}]) {
    await assert.rejects(f.confirm(card, {operationId}), {code:"STUDENT_CARD_NFC_OPERATION_REQUIRED", statusCode:400});
  }
  assert.deepEqual(await f.row(card.id), before);
  assert.equal(await f.countAudit("student_card_nfc_encoded"), 0);
});
pg("canonical UUID casing confirms once; incorrect or missing UUID cannot replay or upgrade lock metadata", async f => {
  const card = await f.issue();
  assert.equal((await f.confirm(card, {operationId:` ${card.nfc.operationId.toUpperCase()} `})).status, "active");
  const before = await f.row(card.id);
  await assert.rejects(f.confirm(card, {operationId:randomUUID(), locked:true}), {code:"STUDENT_CARD_NFC_OPERATION_MISMATCH"});
  await assert.rejects(f.confirm(card, {operationId:undefined}), {code:"STUDENT_CARD_NFC_OPERATION_REQUIRED"});
  assert.deepEqual(await f.row(card.id), before);
  assert.equal((await f.confirm(card)).idempotentReplay, true);
  assert.equal(await f.countAudit("student_card_nfc_encoded"), 1);
  assert.equal(await f.countAudit("student_card_nfc_locked"), 0);
});
pg("another reservation or secret-rotation UUID cannot confirm this reservation", async f => {
  const card = await f.issue();
  const other = await f.issue({studentId:f.students[1], nfc:{...f.identity,uid:"04778899001122"}});
  await assert.rejects(f.confirm(card, {operationId:other.nfc.operationId}), {code:"STUDENT_CARD_NFC_OPERATION_MISMATCH"});
  const retryId = randomUUID();
  const rotated = await retryStudentCardNfc(f.repo,card.id,{...f.identity,operationId:retryId},f.principal,{},f.scope);
  assert.equal(rotated.nfc.operationId,card.nfc.operationId);
  await assert.rejects(f.confirm(rotated, {operationId:retryId}), {code:"STUDENT_CARD_NFC_OPERATION_MISMATCH"});
  assert.equal((await f.row(card.id)).status,"issued");
  assert.equal((await f.confirm(rotated)).status,"active");
});
pg("incorrect UUID cannot switch replacement, link history or emit audits", async f => {
  const old = await issueStudentCard(f.repo,{studentId:f.students[0],medium:"qr"},f.principal,{},f.scope);
  const next = await replaceStudentCard(f.repo,old.id,f.principal,{},f.scope,{nfc:f.identity,operationId:randomUUID()});
  const beforeOld = await f.row(old.id), beforeNext = await f.row(next.id);
  await assert.rejects(f.confirm(next,{operationId:randomUUID()}),{code:"STUDENT_CARD_NFC_OPERATION_MISMATCH"});
  assert.deepEqual(await f.row(old.id),beforeOld);assert.deepEqual(await f.row(next.id),beforeNext);
  assert.equal(await f.countAudit("student_card_replaced"),0);assert.equal(await f.countAudit("student_card_nfc_encoded"),0);
  await f.confirm(next);assert.equal((await f.row(old.id)).status,"replaced");assert.equal((await f.row(next.id)).status,"active");
});
pg("concurrent correct and divergent confirmations yield one activation and one audit", async f => {
  const card = await f.issue();
  const results = await Promise.allSettled([f.confirm(card),f.confirm(card,{operationId:randomUUID()})]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(results.find(r=>r.status==="rejected").reason.code,"STUDENT_CARD_NFC_OPERATION_MISMATCH");
  assert.equal((await f.row(card.id)).status,"active");assert.equal(await f.countAudit("student_card_nfc_encoded"),1);
});
pg("wrong UUID cannot trigger expiry mutation; matching expired operation still revokes and audits once", async f => {
  const card = await f.issue();await f.expire(card.id);
  await assert.rejects(f.confirm(card,{operationId:randomUUID()}),{code:"STUDENT_CARD_NFC_OPERATION_MISMATCH"});
  assert.equal((await f.row(card.id)).status,"issued");assert.equal(await f.countAudit("student_card_nfc_reservation_expired"),0);
  await assert.rejects(f.confirm(card),{code:"STUDENT_CARD_NFC_EXPIRED"});
  await assert.rejects(f.confirm(card),{code:"STUDENT_CARD_NFC_EXPIRED"});
  assert.equal((await f.row(card.id)).status,"revoked");assert.equal(await f.countAudit("student_card_nfc_reservation_expired"),1);
});
pg("legacy active encoded cards accept absent/null UUID only; no UUID allocation or inactive-card bypass", async f => {
  const generated = generateCardSecrets();
  const result = await f.pool.query(`INSERT INTO student_access_cards(school_id,student_id,public_id,token_hash,medium,status,nfc_uid,nfc_tag_type,nfc_encoding_state,nfc_encoded_at)
    VALUES($1,$2,$3,$4,'nfc','active',$5,'NTAG216','encoded',clock_timestamp()) RETURNING id`,[f.a,f.students[0],generated.publicId,generated.tokenHash,f.identity.uid]);
  const card = {id:result.rows[0].id,cardToken:generated.cardToken,nfc:{operationId:null}};
  const before = await f.row(card.id);
  assert.equal((await f.confirm(card,{operationId:undefined})).idempotentReplay,true);
  assert.equal((await f.confirm(card,{operationId:null})).idempotentReplay,true);
  await assert.rejects(f.confirm(card,{operationId:randomUUID(),locked:true}),{code:"STUDENT_CARD_NFC_OPERATION_MISMATCH"});
  assert.deepEqual(await f.row(card.id),before);
  await f.confirm(card,{locked:true});assert.equal((await f.row(card.id)).nfc_operation_id,null);
  assert.equal(await f.countAudit("student_card_nfc_locked"),1);
  await markStudentCardLost(f.repo,card.id,f.principal,{},f.scope,"lost");
  await assert.rejects(f.confirm(card),{code:"STUDENT_CARD_INVALID_STATE"});assert.equal((await f.row(card.id)).status,"lost");
});

pg("P0 recovery: expired reservation with matching physical capability reactivates same row without changing UID", async f => {
  const card = await f.issue();
  await f.expire(card.id);
  await assert.rejects(f.confirm(card), {code: "STUDENT_CARD_NFC_EXPIRED"});
  const input = {...f.identity, studentId: f.students[0], cardToken: card.cardToken, operationId: randomUUID()};
  const recovered = await recoverExpiredStudentCardNfc(f.repo, card.id, input, f.principal, {}, f.scope);
  assert.equal(recovered.id, card.id);
  assert.equal(recovered.status, "active");
  const db = await f.row(card.id);
  assert.equal(db.nfc_uid, f.identity.uid);
  assert.equal(db.revoke_reason, null);
  assert.equal(await f.countAudit("student_card_nfc_reservation_recovered"), 1);
  const replay = await recoverExpiredStudentCardNfc(f.repo, card.id, input, f.principal, {}, f.scope);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(await f.countAudit("student_card_nfc_reservation_recovered"), 1);
});

pg("P0 recovery: wrong secret, student and UID cannot revive expired card", async f => {
  const card = await f.issue();
  await f.expire(card.id);
  await assert.rejects(f.confirm(card), {code: "STUDENT_CARD_NFC_EXPIRED"});
  const input = {...f.identity, studentId: f.students[0], cardToken: card.cardToken, operationId: randomUUID()};
  await assert.rejects(recoverExpiredStudentCardNfc(f.repo,card.id,{...input,cardToken:card.cardToken.slice(0,-1)+(card.cardToken.endsWith("Z") ? "A" : "Z")},f.principal,{},f.scope), {code:"STUDENT_CARD_NOT_FOUND"});
  await assert.rejects(recoverExpiredStudentCardNfc(f.repo,card.id,{...input,studentId:f.students[1]},f.principal,{},f.scope), {code:"STUDENT_CARD_NFC_MISMATCH"});
  await assert.rejects(recoverExpiredStudentCardNfc(f.repo,card.id,{...input,uid:"04778899001122"},f.principal,{},f.scope), {code:"STUDENT_CARD_NFC_MISMATCH"});
  assert.equal((await f.row(card.id)).status,"revoked");
  assert.equal(await f.countAudit("student_card_nfc_reservation_recovered"),0);
});
