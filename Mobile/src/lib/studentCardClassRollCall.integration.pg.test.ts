/**
 * CARTE-PR3-M2 — intégration : la logique Mobile de l'appel complet pilotée contre le Backend
 * réel (routes HTTP de production, PostgreSQL local jetable, identités synthétiques).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  applyRollCallScan,
  classRollCallCounts,
  createClassRollCall,
  markAllPresent,
  mergeReloadedRoster,
  parseRollCallRoster,
  setStudentStatus,
  validateClassRollCall,
} from "./studentCardClassRollCall";

const requireBackend = createRequire(
  resolve(process.cwd(), process.cwd().endsWith("Mobile") ? "../backend/package.json" : "backend/package.json"),
);
const { createIntegrationFixture } = requireBackend("./lib/studentCardsNfcIntegration.fixture.js");

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;
let fixture: Fixture;

before(async () => {
  fixture = await createIntegrationFixture();
});
after(async () => {
  if (!fixture) return;
  // Démontage : la base jetable est supprimée de force ; une connexion inactive coupée à ce
  // moment ne doit pas devenir une exception non gérée (aucun impact sur les assertions).
  for (const pool of [fixture.pool, (fixture.repo as { pool?: { on: (event: string, fn: () => void) => void } }).pool]) {
    pool?.on("error", () => {});
  }
  await fixture.close();
});

/** Transforme une réponse HTTP non 2xx en erreur au format du client Mobile (status, code, details). */
async function call(path: string, options: { method?: string; body?: unknown; key?: string } = {}, token?: string) {
  const response = await fixture.request(
    path,
    {
      method: options.method ?? "GET",
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      headers: options.key ? { "Idempotency-Key": options.key } : {},
    },
    token,
  );
  if (response.status >= 400) {
    throw Object.assign(new Error(response.data?.message ?? "error"), {
      status: response.status,
      code: response.data?.code,
      details: response.data?.details,
    });
  }
  return response.data;
}

test("appel complet : liste, scan rapproché, Tous présents, confirmation, justifié préservé, effectif modifié", async () => {
  const { pool, schools, extraTokens } = fixture;
  const school = schools[0];
  const { classId, students } = await fixture.cohort(4);
  const teacherToken = extraTokens.teacher;
  const teacherUser = (await pool.query("SELECT id FROM users WHERE user_code = 'NFC-teacher'")).rows[0].id;
  await pool.query(
    `UPDATE school_settings SET student_card_qr_enabled = TRUE, student_card_attendance_enabled = TRUE WHERE school_id = $1`,
    [school.id],
  );
  const subject = (await pool.query(
    "INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1,'M2-MATH','Maths','active') RETURNING id",
    [school.id],
  )).rows[0].id;
  const teacher = (await pool.query(
    "INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1,$2,'M2-TCH','active') RETURNING id",
    [school.id, teacherUser],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1,$2,$3,$4,$5,'active')`,
    [school.id, teacher, classId, subject, school.year],
  );
  // Carte QR active pour le premier élève (émise par l'Admin School).
  const issued = await call("/student-cards", { method: "POST", body: { studentId: students[0], medium: "qr" } });
  const date = "2026-10-30";
  // Justifié enregistré avant l'appel : jamais écrasé.
  await pool.query(
    `INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status, reason)
     VALUES ($1,$2,$3,$4::date,'excused','Malade')`,
    [school.id, students[2], classId, date],
  );

  const context = { scopeKey: "it", sessionId: randomUUID(), classId, date };
  const roster = parseRollCallRoster(await call(
    `/student-cards/roll-call/roster?${new URLSearchParams({ sessionId: context.sessionId, classId, date }).toString()}`,
    {},
    teacherToken,
  ));
  assert.ok(roster);
  assert.equal(roster.length, 4);
  let draft = createClassRollCall(context, roster);
  assert.deepEqual(classRollCallCounts(draft), { present: 0, absent: 3, late: 0, excused: 1, total: 4 });

  const scan = await call("/student-cards/roll-call/scan", {
    method: "POST",
    body: { sessionId: context.sessionId, classId, date, mode: "teacher", cardToken: issued.cardToken },
  }, teacherToken);
  const scanned = applyRollCallScan(draft, scan);
  assert.equal(scanned.feedback.kind, "accepted", "le scan se rapproche de l'élève par la clé de session");
  draft = scanned.draft;
  assert.equal(draft.marks[students[0]].source, "card");
  draft = setStudentStatus(markAllPresent(draft), students[3], "absent");

  // Rien n'est écrit avant la confirmation.
  const before = await pool.query("SELECT count(*)::int AS n FROM attendance WHERE attendance_date = $1::date", [date]);
  assert.equal(before.rows[0].n, 1);

  // Effectif modifié après l'ouverture : 409, rechargement, fusion, puis validation.
  const newcomer = randomUUID();
  await pool.query("INSERT INTO students(id,school_id,first_name,last_name,status) VALUES($1,$2,'Élève','Nouveau','active')", [newcomer, school.id]);
  await pool.query(
    "INSERT INTO enrollments(school_id,student_id,class_id,academic_year_id,status) VALUES($1,$2,$3,$4,'ENROLLED')",
    [school.id, newcomer, classId, school.year],
  );
  const validate = (body: unknown, options: { idempotencyKey: string }) =>
    call("/student-cards/roll-call/validate", { method: "POST", body, key: options.idempotencyKey }, teacherToken);
  const changed = await validateClassRollCall(draft, { validate });
  assert.equal(changed.kind, "roster_changed");
  const reloaded = parseRollCallRoster(await call(
    `/student-cards/roll-call/roster?${new URLSearchParams({ sessionId: context.sessionId, classId, date }).toString()}`,
    {},
    teacherToken,
  ));
  assert.ok(reloaded);
  draft = mergeReloadedRoster(draft, reloaded);
  assert.equal(draft.marks[newcomer].status, "absent", "nouvel élève absent provisoire");
  assert.equal(draft.marks[students[0]].source, "card", "scan conservé après rechargement");

  const ok = await validateClassRollCall(draft, { validate });
  assert.equal(ok.kind, "validated", JSON.stringify(ok));
  if (ok.kind !== "validated") return;
  assert.deepEqual(ok.counts, { present: 2, absent: 2, late: 0, excused: 1, enrolled: 5 });
  const rows = Object.fromEntries((await pool.query(
    "SELECT student_id, status, reason FROM attendance WHERE attendance_date = $1::date",
    [date],
  )).rows.map((row: { student_id: string; status: string; reason: string | null }) => [row.student_id, [row.status, row.reason]]));
  assert.deepEqual(rows[students[2]], ["excused", "Malade"], "justifié jamais écrasé");
  assert.equal(rows[students[0]][0], "present");
  assert.equal(rows[students[3]][0], "absent");
  assert.equal(rows[newcomer][0], "absent");

  // Rejeu (même session) : idempotent, aucune écriture supplémentaire.
  const replay = await validateClassRollCall(draft, { validate });
  assert.equal(replay.kind, "validated");
  const count = await pool.query("SELECT count(*)::int AS n FROM attendance WHERE attendance_date = $1::date", [date]);
  assert.equal(count.rows[0].n, 5);
});
