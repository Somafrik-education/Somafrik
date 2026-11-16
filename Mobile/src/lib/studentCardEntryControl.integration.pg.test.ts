/**
 * CARTE-PR3-M1 — intégration : la logique Mobile du contrôle d'entrée pilotée contre le Backend
 * réel (route HTTP de production, PostgreSQL local jetable, identités synthétiques).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ENTRY_CONTROL_COPY, submitEntryScan, type EntryScanBody } from "./studentCardEntryControl";

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
  for (const pool of [fixture.pool, (fixture.repo as { pool?: { on: (event: string, fn: () => void) => void } }).pool]) {
    pool?.on("error", () => {});
  }
  await fixture.close();
});

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

test("contrôle d'entrée : entrée, déjà entré, reprise réseau sans doublon, refus carte/rôle, aucune présence en classe", async () => {
  const { pool, schools, extraTokens } = fixture;
  const school = schools[0];
  const ENTRY = ["Contrôle d'entrée:CREATE", "Contrôle d'entrée:READ"];
  await pool.query(
    `INSERT INTO role_module_permissions (role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by)
     VALUES ('SUPERVISOR', 'global', 'entry_control', TRUE, TRUE, FALSE, FALSE, 'carte-pr3-m1')`,
  );
  const supervisorId = randomUUID();
  await pool.query(
    `INSERT INTO users(id,school_id,user_code,first_name,last_name,email,role,status,must_change_password)
     VALUES($1,$2,'M1-SUP','Surv','Portail','m1-sup@nfc.fixture.test','Surveillant','active',FALSE)`,
    [supervisorId, school.id],
  );
  await pool.query("INSERT INTO user_roles(user_id,school_id,role_key,status) VALUES($1,$2,'SUPERVISOR','active')", [supervisorId, school.id]);
  const supervisor = await fixture.mint({
    sub: supervisorId, role: "Surveillant", roleKeys: ["SUPERVISOR"], schoolCode: school.code,
    countryCode: "CD", mustChangePassword: false, permissions: ENTRY,
  });

  const { students } = await fixture.cohort(2);
  const active = await call("/student-cards", { method: "POST", body: { studentId: students[0], medium: "qr" } });
  const revoked = await call("/student-cards", { method: "POST", body: { studentId: students[1], medium: "qr" } });
  await call(`/student-cards/${revoked.card?.id ?? revoked.id}/revoke`, { method: "POST", body: { reason: "test" } });
  const foreignCohort = await fixture.cohort(1, schools[1]);
  const foreign = await call("/student-cards", { method: "POST", body: { studentId: foreignCohort.students[0], medium: "qr" } }, schools[1].token);

  const scanAs = (token: string) => (body: EntryScanBody, options: { idempotencyKey: string }) =>
    call("/student-cards/entry-scan", { method: "POST", body, key: options.idempotencyKey }, token);

  // 1. Entrée enregistrée : classe affichée, aucune finance sans permission finance.
  const first = await submitEntryScan({ cardToken: active.cardToken, medium: "qr" }, { scan: scanAs(supervisor) });
  assert.equal(first.kind, "recorded", JSON.stringify(first));
  if (first.kind !== "recorded") return;
  assert.equal(first.result.status, "entered");
  assert.ok(first.result.className, "classe résolue par le serveur");
  assert.equal(first.result.finance, undefined);

  // 2. Nouvelle lecture physique de la même carte : déjà entré.
  const again = await submitEntryScan({ cardToken: active.cardToken, medium: "qr" }, { scan: scanAs(supervisor) });
  assert.equal(again.kind, "recorded");
  if (again.kind === "recorded") assert.equal(again.result.status, "already_entered");

  // 3. Perte réseau après traitement serveur : la reprise rejoue la même opération.
  const lossy = (body: EntryScanBody, options: { idempotencyKey: string }) =>
    scanAs(supervisor)(body, options).then(() => { throw { status: 0, code: "NETWORK_UNAVAILABLE" }; });
  const lost = await submitEntryScan({ cardToken: active.cardToken, medium: "nfc" }, { scan: lossy });
  assert.equal(lost.kind, "failed");
  if (lost.kind !== "failed" || !lost.retry) return assert.fail("reprise attendue");
  const resumed = await submitEntryScan(lost.retry, { scan: scanAs(supervisor) });
  assert.equal(resumed.kind, "recorded");
  const events = await pool.query(
    "SELECT count(*)::int AS n FROM school_entry_events WHERE school_id = $1 AND student_id = $2",
    [school.id, students[0]],
  );
  assert.equal(events.rows[0].n, 1, "une seule entrée par élève et par jour");

  // 4. Refus : carte révoquée, carte d'un autre établissement, rôle non admissible.
  const rev = await submitEntryScan({ cardToken: revoked.cardToken, medium: "qr" }, { scan: scanAs(supervisor) });
  assert.equal(rev.kind === "failed" && rev.failure.message, ENTRY_CONTROL_COPY.revokedCard);
  const other = await submitEntryScan({ cardToken: foreign.cardToken, medium: "qr" }, { scan: scanAs(supervisor) });
  assert.equal(other.kind === "failed" && other.failure.message, ENTRY_CONTROL_COPY.unknownCard);
  const teacher = await submitEntryScan({ cardToken: active.cardToken, medium: "qr" }, { scan: scanAs(extraTokens.teacher) });
  assert.equal(teacher.kind, "failed");
  if (teacher.kind === "failed") {
    assert.equal(teacher.failure.message, ENTRY_CONTROL_COPY.forbidden);
    assert.equal(teacher.failure.stop, true);
  }
  for (const key of ["super", "country"]) {
    const platform = await submitEntryScan({ cardToken: active.cardToken, medium: "qr" }, { scan: scanAs(extraTokens[key]) });
    assert.equal(platform.kind === "failed" && platform.failure.stop, true, key);
  }

  // 5. Aucune présence en classe écrite par le portail.
  const attendance = await pool.query("SELECT count(*)::int AS n FROM attendance WHERE school_id = $1", [school.id]);
  assert.equal(attendance.rows[0].n, 0);
});
