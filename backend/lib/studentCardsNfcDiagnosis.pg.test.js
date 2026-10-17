"use strict";
// NFC-P0-R3-1 — read-only diagnosis by UID on a disposable local PostgreSQL.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { STUDENT_ACCESS_CARDS_SCHEMA_SQL } = require("../db/studentAccessCardsSchema");
const { createStudentAccessCardsPgStore } = require("../db/studentAccessCardsPgStore");
const { issueStudentCard, revokeStudentCard, markStudentCardLost, listStudentCards } = require("./studentAccessCardsManagement");
const { confirmStudentCardNfc } = require("./studentCardsNfcEncoding");
const { diagnoseStudentCardNfc } = require("./studentCardsNfcDiagnosis");

const url = process.env.SOMAFRIK_NFC_TEST_DATABASE_URL;
let uidSeq = 0;
const nextUid = () => `04D1A6${String(++uidSeq).padStart(8, "0")}`;

async function fixture(run) {
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname), "Disposable local PostgreSQL required");
  assert.match(parsed.pathname, /^\/(nfc_prog_02_test|nfc_encoding_test)$/);
  const schema = `nfc_diag_${randomUUID().replace(/-/g, "")}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 8 });
  const a = randomUUID(), b = randomUUID(), actorA = randomUUID(), actorB = randomUUID();
  const scopeA = { schoolId: a, loginCode: "CD-DIA-26-001" };
  const scopeB = { schoolId: b, loginCode: "CD-DIA-26-002" };
  const principalA = { sub: actorA, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: scopeA.loginCode,
    enrollmentSchoolId: a, permissions: ["Élèves:READ", "Élèves:UPDATE"] };
  const principalB = { ...principalA, sub: actorB, schoolCode: scopeB.loginCode, enrollmentSchoolId: b };
  const sqlLog = [];
  const repo = {
    query: (sql, args) => pool.query(sql, args),
    one: async (sql, args) => (await pool.query(sql, args)).rows[0] ?? null,
    all: async (sql, args) => (await pool.query(sql, args)).rows,
    getSchoolSettingsStore: () => ({ getSettings: (id) => repo.one("SELECT * FROM school_settings WHERE school_id=$1", [id]) }),
    getStudentAccessCardsStore: () => createStudentAccessCardsPgStore(repo),
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = { query: (sql, args) => { sqlLog.push(String(sql)); return client.query(sql, args); } };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    },
    async recordAudit(entry, tx) {
      await (tx ?? pool).query("INSERT INTO audit_logs(action,entity_id,old_value,new_value,user_id) VALUES($1,$2,$3,$4,$5)",
        [entry.action, entry.entityId, entry.oldValue, entry.newValue, entry.userId]);
    },
  };
  try {
    await pool.query(`CREATE TABLE schools(id UUID PRIMARY KEY); CREATE TABLE users(id UUID PRIMARY KEY);
      CREATE TABLE students(id UUID PRIMARY KEY,school_id UUID NOT NULL REFERENCES schools(id),student_code TEXT,status TEXT,
        first_name TEXT DEFAULT 'Prenom',last_name TEXT DEFAULT 'Nom',photo_url TEXT);
      CREATE TABLE school_settings(school_id UUID PRIMARY KEY,student_card_enabled BOOLEAN,student_card_nfc_enabled BOOLEAN);
      CREATE TABLE audit_logs(id UUID DEFAULT gen_random_uuid(),action TEXT,entity_id TEXT,old_value JSONB,new_value JSONB,user_id UUID,
        created_at TIMESTAMPTZ DEFAULT clock_timestamp());
      CREATE TABLE academic_years(id UUID PRIMARY KEY,school_id UUID,is_current BOOLEAN);
      CREATE TABLE classes(id UUID PRIMARY KEY,school_id UUID,academic_year_id UUID,class_code TEXT,name TEXT);
      CREATE TABLE enrollments(school_id UUID,student_id UUID,academic_year_id UUID,class_id UUID,status TEXT);`);
    await pool.query("INSERT INTO schools VALUES($1),($2)", [a, b]);
    await pool.query("INSERT INTO users VALUES($1),($2)", [actorA, actorB]);
    await pool.query("INSERT INTO school_settings VALUES($1,TRUE,TRUE),($2,TRUE,TRUE)", [a, b]);
    await pool.query(STUDENT_ACCESS_CARDS_SCHEMA_SQL);
    const year = randomUUID(), klass = randomUUID();
    await pool.query("INSERT INTO academic_years VALUES($1,$2,TRUE)", [year, a]);
    await pool.query("INSERT INTO classes VALUES($1,$2,$3,'2B','2ème B')", [klass, a, year]);
    let studentSeq = 0;
    async function student(school = a, { status = "active", enrolled = true, first = "Prenom", last = "Nom" } = {}) {
      const id = randomUUID();
      await pool.query("INSERT INTO students(id,school_id,student_code,status,first_name,last_name) VALUES($1,$2,$3,$4,$5,$6)",
        [id, school, `DIAG-${++studentSeq}`, status, first, last]);
      if (enrolled && school === a) await pool.query("INSERT INTO enrollments VALUES($1,$2,$3,$4,'active')", [a, id, year, klass]);
      return id;
    }
    const ctx = (school) => school === b ? { principal: principalB, scope: scopeB } : { principal: principalA, scope: scopeA };
    async function reserve(studentId, { school = a, uid = nextUid(), tagType = "NTAG216", replacesCardId } = {}) {
      const { principal, scope } = ctx(school);
      const payload = { studentId, medium: "nfc", nfc: { uid, tagType }, operationId: randomUUID() };
      const card = replacesCardId
        ? await require("./studentAccessCardsManagement").replaceStudentCard(repo, replacesCardId, principal, {}, scope, payload)
        : await issueStudentCard(repo, payload, principal, {}, scope);
      return { ...card, uid, tagType, school };
    }
    async function encode(card) {
      const { principal, scope } = ctx(card.school);
      await confirmStudentCardNfc(repo, card.id, { uid: card.uid, tagType: card.tagType, cardToken: card.cardToken,
        locked: false, operationId: card.nfc.operationId }, principal, {}, scope);
      return card;
    }
    const expire = (id) => pool.query("UPDATE student_access_cards SET issued_at=clock_timestamp()-INTERVAL '31 minutes',nfc_reservation_expires_at=clock_timestamp()-INTERVAL '1 minute' WHERE id=$1", [id]);
    async function materialise(studentId, school = a) {
      const { principal, scope } = ctx(school);
      await listStudentCards(repo, studentId, scope, principal, {});
    }
    const blank = (card) => ({ uid: card.uid, tagType: card.tagType, ndef: { state: "empty" }, readOnly: false });
    const diagnose = (body, school = a) => { const { principal, scope } = ctx(school); return diagnoseStudentCardNfc(repo, body, principal, {}, scope); };
    await run({ pool, repo, a, b, scopeA, scopeB, principalA, principalB, student, reserve, encode, expire, materialise,
      blank, diagnose, sqlLog, ctx });
  } finally { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
}
function pg(name, run) { test(name, { skip: !url }, () => fixture(run)); }

pg("DIAG-01 every database state yields its code, reason and only existing recovery flows", async (f) => {
  const cases = [];
  const add = (label, card, expected) => cases.push({ label, card, ...expected });

  const live = await f.reserve(await f.student());
  add("live", live, { code: "LIVE_RESERVATION", actions: ["resume_operation"], recoverable: true });

  const stale = await f.reserve(await f.student()); await f.expire(stale.id);
  add("stale", stale, { code: "EXPIRED_NOT_MATERIALISED", actions: ["open_holder_cards"], recoverable: true });

  const s3 = await f.student(); const eligible = await f.reserve(s3); await f.expire(eligible.id); await f.materialise(s3);
  add("r2", eligible, { code: "R2_ELIGIBLE", actions: ["reencode_for_holder"], recoverable: true });

  const s4 = await f.student(); const inactive = await f.reserve(s4); await f.expire(inactive.id); await f.materialise(s4);
  await f.pool.query("UPDATE students SET status='inactive' WHERE id=$1", [s4]);
  add("inactive", inactive, { code: "EXPIRED_HOLDER_INACTIVE", actions: ["cto_review"], recoverable: false });

  const s5 = await f.student(); const old5 = await f.reserve(s5); await f.expire(old5.id); await f.materialise(s5);
  await f.encode(await f.reserve(s5));
  add("has-card", old5, { code: "EXPIRED_HOLDER_HAS_CARD", actions: ["cto_review"], recoverable: false });

  const s6 = await f.student(); const active6 = await f.encode(await f.reserve(s6));
  const repl = await f.reserve(s6, { replacesCardId: active6.id }); await f.expire(repl.id); await f.materialise(s6);
  add("replacement", repl, { code: "EXPIRED_REPLACEMENT", actions: ["cto_review"], recoverable: false });

  const s7 = await f.student(); const cancelled = await f.reserve(s7);
  await revokeStudentCard(f.repo, cancelled.id, f.principalA, {}, f.scopeA);
  add("revoked-never-encoded", cancelled, { code: "REVOKED_NEVER_ENCODED", actions: ["cto_review"], recoverable: false });

  const active = await f.encode(await f.reserve(await f.student()));
  add("active-erased", active, { code: "ACTIVE", actions: ["declare_lost_and_replace"], recoverable: false });

  const lost = await f.encode(await f.reserve(await f.student()));
  await markStudentCardLost(f.repo, lost.id, f.principalA, {}, f.scopeA);
  add("lost", lost, { code: "LOST", actions: [], recoverable: false });

  const s10 = await f.student(); const replaced = await f.encode(await f.reserve(s10));
  const successor = await f.reserve(s10, { replacesCardId: replaced.id }); await f.encode(successor);
  add("replaced", replaced, { code: "REPLACED", actions: [], recoverable: false });

  const security = await f.encode(await f.reserve(await f.student()));
  await revokeStudentCard(f.repo, security.id, f.principalA, {}, f.scopeA);
  add("security", security, { code: "REVOKED_SECURITY", actions: [], recoverable: false });

  const locked = await f.encode(await f.reserve(await f.student()));
  await f.pool.query("UPDATE student_access_cards SET nfc_encoding_state='locked', nfc_locked_at=clock_timestamp() WHERE id=$1", [locked.id]);
  add("locked", locked, { code: "LOCKED_RECORDED", actions: [], recoverable: false });

  for (const c of cases) {
    const result = await f.diagnose(f.blank(c.card));
    assert.equal(result.code, c.code, c.label);
    assert.deepEqual(result.actions, c.actions, c.label);
    assert.equal(result.recoverable, c.recoverable, c.label);
    assert.equal(result.sameSchool, true, c.label);
    assert.equal(result.physical, "BLANK", c.label);
    assert.ok(result.message && result.physicalMessage, c.label);
    assert.equal(result.card.id, c.card.id, c.label);
  }
  // Unknown UID: not a uniqueness refusal.
  const unknown = await f.diagnose({ uid: nextUid(), tagType: "NTAG213", ndef: { state: "empty" }, readOnly: false });
  assert.equal(unknown.code, "UID_UNKNOWN"); assert.equal(unknown.sameSchool, null); assert.deepEqual(unknown.actions, ["program_new_card"]);
  assert.equal("card" in unknown || "holder" in unknown, false);
});

pg("DIAG-02 holder of an eligible card is found in the same school, with class, to drive R2", async (f) => {
  const pupil = await f.student(f.a, { first: "Grace", last: "Eleve" });
  const card = await f.reserve(pupil); await f.expire(card.id); await f.materialise(pupil);
  const result = await f.diagnose(f.blank(card));
  assert.equal(result.code, "R2_ELIGIBLE");
  assert.deepEqual(result.holder, { id: pupil, firstName: "Grace", lastName: "Eleve", studentCode: result.holder.studentCode,
    active: true, classCode: "2B", className: "2ème B" });
  assert.deepEqual(Object.keys(result.card).sort(),
    ["encodingState", "everEncoded", "id", "isReplacement", "issuedDay", "revokedDay", "status", "tagType"]);
  // Somafrik content of this very card: recovery without rewrite (R1), never a new write.
  const token = await f.pool.query("SELECT public_id FROM student_access_cards WHERE id=$1", [card.id]);
  const r1 = await f.diagnose({ ...f.blank(card), ndef: { state: "somafrik", publicId: token.rows[0].public_id } });
  assert.equal(r1.physical, "SOMAFRIK_THIS_CARD"); assert.deepEqual(r1.actions, ["recover_without_rewrite"]);
});

pg("DIAG-03 another school's card: one boolean read, minimal answer, no detail query, no leak", async (f) => {
  const pupilB = await f.student(f.b, { first: "Secret", last: "Ailleurs" });
  const cardB = await f.reserve(pupilB, { school: f.b }); await f.expire(cardB.id); await f.materialise(pupilB, f.b);
  const publicIdB = (await f.pool.query("SELECT public_id FROM student_access_cards WHERE id=$1", [cardB.id])).rows[0].public_id;
  f.sqlLog.length = 0;
  for (const ndef of [{ state: "empty" }, { state: "somafrik", publicId: publicIdB }]) {
    const result = await f.diagnose({ uid: cardB.uid, tagType: cardB.tagType, ndef, readOnly: false });
    assert.deepEqual(Object.keys(result).sort(), ["actions", "code", "message", "physical", "physicalMessage", "recoverable", "sameSchool"]);
    assert.equal(result.code, "OTHER_SCHOOL"); assert.equal(result.sameSchool, false);
    assert.equal(result.recoverable, false); assert.deepEqual(result.actions, ndef.state === "empty" ? ["contact_owner_school"] : []);
    const text = JSON.stringify(result);
    for (const leak of [cardB.id, pupilB, "Secret", "Ailleurs", "revoked", "issued", cardB.uid, publicIdB, f.b]) {
      assert.equal(text.includes(leak), false, `leak ${leak}`);
    }
  }
  // Only the settings read, the boolean lookup and SET TRANSACTION ran: no detail query on B's row.
  const cardQueries = f.sqlLog.filter((sql) => /student_access_cards|students|enrollments/.test(sql));
  assert.equal(cardQueries.length, 2);
  for (const sql of cardQueries) assert.match(sql, /^SELECT \(school_id = \$2::uuid\) AS same_school FROM student_access_cards WHERE nfc_uid = \$1$/);
  // The audit of A's diagnosis never points to B's row.
  const audits = await f.pool.query("SELECT entity_id,new_value::text AS v FROM audit_logs WHERE action='student_card_nfc_diagnosed'");
  for (const row of audits.rows) { assert.equal(row.entity_id, null); assert.equal(row.v.includes(cardB.uid), false); }
});

pg("DIAG-04 every detail query is bound to the caller's school", async (f) => {
  const pupil = await f.student(); const card = await f.reserve(pupil); await f.expire(card.id); await f.materialise(pupil);
  f.sqlLog.length = 0;
  await f.diagnose(f.blank(card));
  const reads = f.sqlLog.filter((sql) => /FROM (student_access_cards|students)/.test(sql));
  const crossSchool = reads.filter((sql) => !/school_id = \$1/.test(sql));
  assert.deepEqual(crossSchool.map((s) => s.slice(0, 60)), ["SELECT (school_id = $2::uuid) AS same_school FROM student_ac"]);
  assert.equal(reads.some((sql) => /SELECT \*/.test(sql) && /student_access_cards|students/.test(sql)), false);
});

pg("DIAG-05 strictly read-only: no row, state or deadline changes; only one audit", async (f) => {
  const pupil = await f.student(); const stale = await f.reserve(pupil); await f.expire(stale.id);
  const snapshot = async () => (await f.pool.query("SELECT row_to_json(c)::text AS r FROM student_access_cards c ORDER BY id")).rows;
  const before = await snapshot();
  const result = await f.diagnose(f.blank(stale));
  assert.equal(result.code, "EXPIRED_NOT_MATERIALISED");
  assert.deepEqual(await snapshot(), before, "diagnosis never materialises an expiry nor touches a row");
  const audits = await f.pool.query("SELECT action,entity_id,new_value FROM audit_logs WHERE action='student_card_nfc_diagnosed'");
  assert.equal(audits.rowCount, 1);
  assert.deepEqual(audits.rows[0].new_value, { uid: `04••••••••${stale.uid.slice(-4)}`, tagType: "NTAG216", code: "EXPIRED_NOT_MATERIALISED", physical: "BLANK" });
  assert.equal(f.sqlLog.includes("SET TRANSACTION READ ONLY"), true);
});

pg("DIAG-06 physical observations override: read-only, foreign, other card, model mismatch never recoverable", async (f) => {
  const pupil = await f.student(); const card = await f.reserve(pupil); await f.expire(card.id); await f.materialise(pupil);
  const checks = [
    [{ readOnly: true }, "READ_ONLY"],
    [{ ndef: { state: "foreign" } }, "FOREIGN"],
    [{ ndef: { state: "unreadable" } }, "UNREADABLE"],
    [{ ndef: { state: "somafrik", publicId: "Z".repeat(22) } }, "SOMAFRIK_OTHER_CARD"],
    [{ tagType: "NTAG213" }, "MODEL_MISMATCH"],
  ];
  for (const [over, physical] of checks) {
    const result = await f.diagnose({ ...f.blank(card), ...over });
    assert.equal(result.code, "R2_ELIGIBLE", physical); assert.equal(result.physical, physical);
    assert.equal(result.recoverable, false, physical); assert.deepEqual(result.actions, [], physical);
  }
});

pg("DIAG-07 RBAC and tenancy: teacher, other school's admin scope, platform and flags off are refused", async (f) => {
  const pupil = await f.student(); const card = await f.reserve(pupil);
  const body = f.blank(card);
  const teacher = { ...f.principalA, role: "Enseignant", roleKeys: ["TEACHER"], permissions: ["Élèves:READ", "Présences:CREATE"] };
  await assert.rejects(diagnoseStudentCardNfc(f.repo, body, teacher, {}, f.scopeA), { code: "STUDENT_CARD_TENANT_DENIED" });
  await assert.rejects(diagnoseStudentCardNfc(f.repo, body, f.principalB, {}, f.scopeA), { code: "STUDENT_CARD_TENANT_DENIED" });
  const platform = { ...f.principalA, enrollmentSchoolId: null };
  await assert.rejects(diagnoseStudentCardNfc(f.repo, body, platform, {}, f.scopeA), { code: "STUDENT_CARD_TENANT_DENIED" });
  await assert.rejects(diagnoseStudentCardNfc(f.repo, body, f.principalA, {}, { loginCode: "X" }), { code: "STUDENT_CARD_TENANT_DENIED" });
  await f.pool.query("UPDATE school_settings SET student_card_nfc_enabled=FALSE WHERE school_id=$1", [f.a]);
  await assert.rejects(f.diagnose(body), { code: "STUDENT_CARD_NFC_DISABLED" });
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='student_card_nfc_diagnosed'")).rows[0].n, 0);
});

pg("DIAG-08 invalid observations are refused before any query; a secret never passes as publicId", async (f) => {
  f.sqlLog.length = 0;
  const base = { uid: "04A1B2C3D4E5F6", tagType: "NTAG216", ndef: { state: "empty" }, readOnly: false };
  for (const bad of [
    { ...base, uid: "FFA1B2C3D4E5F6" }, { ...base, tagType: "NTAG215" }, { ...base, ndef: null },
    { ...base, ndef: { state: "raw" } }, { ...base, readOnly: "no" },
    { ...base, ndef: { state: "somafrik" } },
    { ...base, ndef: { state: "somafrik", publicId: `${"A".repeat(22)}.${"B".repeat(43)}` } },
  ]) {
    await assert.rejects(f.diagnose(bad), (e) => ["STUDENT_CARD_NFC_INVALID"].includes(e.code), JSON.stringify(bad));
  }
  assert.equal(f.sqlLog.length, 0);
});

pg("DIAG-09 concurrency: a diagnosis never blocks on, nor sees, an uncommitted R2 reopening", async (f) => {
  const pupil = await f.student(); const card = await f.reserve(pupil); await f.expire(card.id); await f.materialise(pupil);
  const writer = await f.pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query("SELECT id FROM student_access_cards WHERE id=$1 FOR UPDATE", [card.id]);
    await writer.query("UPDATE student_access_cards SET status='issued', revoked_at=NULL, revoke_reason=NULL, nfc_reservation_expires_at=clock_timestamp()+INTERVAL '30 minutes' WHERE id=$1", [card.id]);
    const during = await Promise.race([
      f.diagnose(f.blank(card)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("diagnosis blocked by a row lock")), 3000)),
    ]);
    assert.equal(during.code, "R2_ELIGIBLE", "committed state only");
    await writer.query("COMMIT");
  } finally { writer.release(); }
  assert.equal((await f.diagnose(f.blank(card))).code, "LIVE_RESERVATION");
  // Parallel diagnoses: consistent answers, one audit each, no write.
  const results = await Promise.all(Array.from({ length: 8 }, () => f.diagnose(f.blank(card))));
  assert.deepEqual([...new Set(results.map((r) => r.code))], ["LIVE_RESERVATION"]);
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='student_card_nfc_diagnosed'")).rows[0].n, 10);
});

pg("DIAG-10 global UID uniqueness unchanged: a diagnosed UID still cannot be reserved twice", async (f) => {
  const pupil = await f.student(); const card = await f.reserve(pupil); await f.expire(card.id); await f.materialise(pupil);
  await f.diagnose(f.blank(card));
  await assert.rejects(f.reserve(await f.student(), { uid: card.uid }), { code: "STUDENT_CARD_NFC_UID_EXISTS" });
  await assert.rejects(f.reserve(await f.student(f.b), { school: f.b, uid: card.uid }), { code: "STUDENT_CARD_NFC_UID_EXISTS" });
  const index = await f.pool.query("SELECT indexdef FROM pg_indexes WHERE indexname='student_access_cards_nfc_uid_unique'");
  assert.match(index.rows[0].indexdef, /UNIQUE INDEX .* \(nfc_uid\) WHERE \(nfc_uid IS NOT NULL\)$/);
});

pg("DIAG-11 audit failure fails the request (no unaudited diagnosis)", async (f) => {
  const pupil = await f.student(); const card = await f.reserve(pupil);
  await f.pool.query(`CREATE FUNCTION reject_diag_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='student_card_nfc_diagnosed' THEN RAISE EXCEPTION 'audit failure injected'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_diag_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_diag_audit();`);
  await assert.rejects(f.diagnose(f.blank(card)), /audit failure injected/);
});
