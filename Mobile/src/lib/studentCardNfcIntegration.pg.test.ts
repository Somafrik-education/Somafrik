import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createNfcBatch, type BatchSnapshot } from "./studentCardNfcBatch";
import { createBatchRosterLoader } from "./studentCardNfcBatchRoster";
import { createNfcSessionManager, type NfcSessionLease } from "./nfcSession";
import {
  createIndividualNfcFlow,
  createNfcEnrollmentApi,
  nfcFailure,
  ndefForCard,
  type NfcEncoderHardware,
  type EnrollmentCard,
} from "./studentCardNfcEncoding";

const requireBackend = createRequire(
  resolve(
    process.cwd(),
    process.cwd().endsWith("Mobile")
      ? "../backend/package.json"
      : "backend/package.json",
  ),
);
const { createIntegrationFixture } = requireBackend(
  "./lib/studentCardsNfcIntegration.fixture.js",
);
type Cohort = {
  school: { id: string; code: string; token: string };
  classId: string;
  classCode: string;
  students: string[];
};
let fixture: Awaited<ReturnType<typeof createIntegrationFixture>>;
const secrets = new Set<string>();
const measurements: unknown[] = [];
before(async () => {
  fixture = await createIntegrationFixture();
});
after(async () => {
  if (!fixture) return;
  try {
    for (const secret of secrets)
      assert.equal(
        fixture.logs().includes(secret),
        false,
        "Backend captured log must not contain capability/secret",
      );
    if (process.env.SOMAFRIK_NFC_EVIDENCE_DIR) {
      mkdirSync(process.env.SOMAFRIK_NFC_EVIDENCE_DIR, { recursive: true });
      writeFileSync(
        resolve(process.env.SOMAFRIK_NFC_EVIDENCE_DIR, "orchestration.json"),
        JSON.stringify(
          { hardware: "SIMULATED — no RF/device measure", measurements },
          null,
          2,
        ) + "\n",
      );
    }
  } finally {
    await fixture.close();
  }
});

let uidSequence = 0;
function harness(cohort: Cohort) {
  const identities = new Map(
    cohort.students.map((id, i) => [
      id,
      {
        uid: `04${(++uidSequence).toString(16).padStart(12, "0").toUpperCase()}`,
        tagType: i % 2 ? ("NTAG216" as const) : ("NTAG213" as const),
      },
    ]),
  );
  const chips = new Map<string, string>();
  const requests: { path: string; method: string; status: number }[] = [];
  const snapshots: BatchSnapshot[] = [];
  let current = cohort.students[0],
    valid = true,
    owners = 0,
    maxOwners = 0,
    writes = 0,
    cancels = 0,
    responseBytes = 0;
  let lease: NfcSessionLease | null = null;
  const sessions = createNfcSessionManager({
    async start() {},
    async cancel() {
      cancels++;
    },
  });
  const owned = () => {
    if (!lease) {
      lease = sessions.acquire();
      owners++;
      maxOwners = Math.max(maxOwners, owners);
    }
    return lease;
  };
  const hooks: {
    beforeRequest?: (
      path: string,
      body: Record<string, unknown> | null,
    ) => Promise<void>;
    afterRequest?: (path: string, data: any) => Promise<void>;
    beforeWrite?: () => Promise<void>;
  } = {};
  const request = async <T>(
    path: string,
    options?: { method?: string; body?: string },
  ): Promise<T> => {
    const method = options?.method || "GET";
    const body = options?.body ? JSON.parse(options.body) : null;
    await hooks.beforeRequest?.(path, body);
    const response = await fixture.request(path, options, cohort.school.token);
    responseBytes += Buffer.byteLength(JSON.stringify(response.data));
    requests.push({ path, method, status: response.status });
    if (response.data.cardToken) {
      secrets.add(response.data.cardToken);
      secrets.add(response.data.cardToken.split(".")[1]);
    }
    if (response.status >= 400)
      throw Object.assign(new Error("Integration API refusal"), {
        status: response.status,
        code: response.data.code,
      });
    await hooks.afterRequest?.(path, response.data);
    return response.data;
  };
  const api = createNfcEnrollmentApi(request);
  const loadRoster = createBatchRosterLoader(request, {
    schoolId: cohort.school.id,
    schoolCodes: [cohort.school.code],
    classId: cohort.classId,
    classCode: cohort.classCode,
  });
  const hardware: NfcEncoderHardware = {
    async availability() {
      try {
        await owned().start();
      } finally {
        await hardware.close();
      }
    },
    async inspect() {
      try {
        return await owned().request(async () => identities.get(current)!);
      } finally {
        await hardware.close();
      }
    },
    async openNdef(uid) {
      assert.equal(identities.get(current)?.uid, uid);
      await owned().request(async () => undefined);
    },
    async readText() {
      return owned().run(
        async () => chips.get(identities.get(current)!.uid) || "",
      );
    },
    async writeText(value) {
      const writingLease = owned();
      await writingLease.run(async () => {
        await hooks.beforeWrite?.();
        const row = (
          await fixture.pool.query(
            "SELECT status,nfc_encoding_state FROM student_access_cards WHERE student_id=$1 AND status='issued'",
            [current],
          )
        ).rows[0];
        assert.equal(
          row?.status,
          "issued",
          "Writing must never activate PostgreSQL",
        );
        assert.equal(row?.nfc_encoding_state, "pending");
        assert.throws(
          () => sessions.acquire(),
          { code: "NFC_SESSION_BUSY" },
          "Existing reader cannot acquire while encoder owns lease",
        );
        chips.set(identities.get(current)!.uid, value);
        writes++;
      });
      await writingLease.reset(); // Model native fresh discovery after writing.
      await hardware.openNdef(identities.get(current)!.uid);
    },
    async isReadOnly() {
      return owned().run(async () => false);
    },
    async close() {
      const previous = lease;
      if (!previous) return;
      await previous.close();
      if (lease === previous) {
        lease = null;
        owners--;
      }
    },
  };
  const batch = createNfcBatch({
    classId: cohort.classId,
    classCode: cohort.classCode,
    loadRoster,
    api,
    hardware,
    uuid: randomUUID,
    valid: () => valid,
    changed(value) {
      if (value.currentId) current = value.currentId;
      assert.equal(
        value.counters.total,
        value.counters.programmed + value.counters.remaining,
      );
      assert.ok(value.counters.inProgress <= 1);
      snapshots.push(value);
    },
  });
  const individual = (id = current) => {
    current = id;
    return createIndividualNfcFlow({
      studentId: id,
      api,
      hardware,
      uuid: randomUUID,
      valid: () => valid,
      phase() {},
    });
  };
  const stats = () => ({
    owners,
    maxOwners,
    writes,
    cancels,
    responseBytes,
    apiCalls: requests.length,
    reads: requests.filter((r) => r.method === "GET").length,
    mutations: requests.filter((r) => r.method === "POST").length,
  });
  return {
    api,
    batch,
    hardware,
    loadRoster,
    individual,
    hooks,
    requests,
    snapshots,
    chips,
    identities,
    stats,
    invalidate() {
      valid = false;
    },
  };
}
async function cards(cohort: Cohort) {
  return (
    await fixture.pool.query(
      "SELECT * FROM student_access_cards WHERE student_id=ANY($1::uuid[]) ORDER BY student_id,id",
      [cohort.students],
    )
  ).rows;
}
async function assertSuccessful(
  cohort: Cohort,
  h: ReturnType<typeof harness>,
  count: number,
) {
  const rows = await cards(cohort);
  assert.equal(rows.filter((r: any) => r.status === "active").length, count);
  assert.equal(new Set(rows.map((r: any) => r.student_id)).size, count);
  assert.equal(new Set(rows.map((r: any) => r.nfc_uid)).size, count);
  assert.equal(rows.length, count);
  assert.deepEqual(h.batch.snapshot().counters, {
    total: count,
    programmed: count,
    remaining: 0,
    errors: 0,
    inProgress: 0,
  });
  assert.equal(h.stats().maxOwners, 1);
  assert.equal(h.stats().owners, 0);
  const audits = await fixture.pool.query(
    "SELECT action,count(*)::int AS n FROM audit_logs WHERE entity_id=ANY($1::text[]) GROUP BY action",
    [rows.map((r: any) => r.id)],
  );
  const counts = Object.fromEntries(
    audits.rows.map((r: any) => [r.action, r.n]),
  );
  assert.equal(counts.student_card_nfc_reserved, count);
  assert.equal(counts.student_card_nfc_encoded, count);
}

test("A: individual Mobile engine -> authenticated HTTP -> PostgreSQL activation and audit", async () => {
  const cohort = await fixture.cohort(1),
    h = harness(cohort);
  const activated = await h.individual().program();
  assert.equal(activated.status, "active");
  const row = (await cards(cohort))[0];
  assert.equal(row.status, "active");
  assert.equal(row.nfc_encoding_state, "encoded");
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  assert.equal(
    await fixture.pool
      .query(
        "SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='student_card_nfc_encoded'",
        [row.id],
      )
      .then((r: any) => r.rowCount),
    1,
  );
  assert.equal(h.stats().writes, 1);
  assert.equal(h.stats().owners, 0);
});

test("Existing NFC migration files are idempotent on disposable PostgreSQL and preserve encoded cards", async () => {
  const before = await fixture.pool.query(
    "SELECT row_to_json(c)::text AS data FROM student_access_cards c ORDER BY id",
  );
  for (let iteration = 0; iteration < 2; iteration++) {
    for (const migration of [
      "20261012_student_cards_nfc_encoding.sql",
      "20261013_student_cards_nfc_reservations.sql",
    ]) {
      await fixture.pool.query(
        readFileSync(
          requireBackend.resolve(`./db/migrations/${migration}`),
          "utf8",
        ),
      );
    }
  }
  assert.deepEqual(
    (
      await fixture.pool.query(
        "SELECT row_to_json(c)::text AS data FROM student_access_cards c ORDER BY id",
      )
    ).rows,
    before.rows,
  );
});

for (const count of [10, 30, 50])
  test(`B/performance: ${count} pupils, real HTTP/PG, one shared lease and exact counters`, async () => {
    const cohort = await fixture.cohort(count),
      h = harness(cohort);
    const started = performance.now();
    await h.batch.prepare();
    const prepared = performance.now();
    h.batch.selectAll();
    await h.batch.start();
    const ended = performance.now();
    await assertSuccessful(cohort, h, count);
    assert.equal(h.stats().writes, count);
    assert.equal(h.stats().mutations, 2 * count);
    measurements.push({
      count,
      preparationMs: +(prepared - started).toFixed(2),
      orchestrationMs: +(ended - prepared).toFixed(2),
      totalMs: +(ended - started).toFixed(2),
      ...h.stats(),
    });
    await h.batch.dispose();
  });

test("C: ten confirmed, failure on eleventh, explicit read-only recovery then thirtieth", async () => {
  const cohort = await fixture.cohort(30),
    h = harness(cohort);
  let confirms = 0;
  h.hooks.beforeRequest = async (path) => {
    if (path.endsWith("/nfc-confirm") && ++confirms === 11)
      throw nfcFailure("NETWORK_UNAVAILABLE");
  };
  await h.batch.prepare();
  h.batch.selectAll();
  await h.batch.start();
  assert.deepEqual(h.batch.snapshot().counters, {
    total: 30,
    programmed: 10,
    remaining: 20,
    errors: 1,
    inProgress: 0,
  });
  assert.equal(
    (await cards(cohort)).filter((r: any) => r.status === "active").length,
    10,
  );
  assert.equal(
    (await cards(cohort)).filter((r: any) => r.status === "issued").length,
    1,
  );
  const failed = h.batch.snapshot().entries.find((e) => e.state === "error")!;
  const operation = (await cards(cohort)).find(
    (r: any) => r.student_id === failed.student.id,
  ).nfc_operation_id;
  h.hooks.beforeRequest = undefined;
  await h.batch.retry(failed.student.id);
  await assertSuccessful(cohort, h, 30);
  assert.equal(
    (await cards(cohort)).find((r: any) => r.student_id === failed.student.id)
      .nfc_operation_id,
    operation,
  );
  assert.equal(h.stats().writes, 30, "No second write on eleventh pupil");
  assert.equal(
    h.requests.filter((r) => r.path.endsWith("/nfc-retry")).length,
    0,
  );
  await h.batch.dispose();
});

test("D: committed confirmation response lost, same reservation recovered without write/issue/audit duplication", async () => {
  const cohort = await fixture.cohort(1),
    h = harness(cohort);
  let lost = false;
  h.hooks.afterRequest = async (path) => {
    if (path.endsWith("/nfc-confirm") && !lost) {
      lost = true;
      throw nfcFailure("NETWORK_UNAVAILABLE");
    }
  };
  await h.batch.prepare();
  h.batch.selectAll();
  await h.batch.start();
  assert.equal(h.batch.snapshot().counters.programmed, 0);
  const original = (await cards(cohort))[0];
  assert.equal(original.status, "active");
  await h.batch.resume();
  await assertSuccessful(cohort, h, 1);
  assert.equal(h.stats().writes, 1);
  assert.equal(h.requests.filter((r) => r.path === "/student-cards").length, 1);
  assert.equal(
    (await cards(cohort))[0].nfc_operation_id,
    original.nfc_operation_id,
  );
  await h.batch.dispose();
});

test("E: explicit replacement preserves A until transaction confirms B, failed confirmation keeps A active", async () => {
  const cohort = await fixture.cohort(1),
    h = harness(cohort);
  const original = await h.individual().program();
  h.identities.set(cohort.students[0], {
    uid: `04${(++uidSequence).toString(16).padStart(12, "0").toUpperCase()}`,
    tagType: "NTAG216",
  });
  await h.batch.prepare();
  h.batch.selectAll();
  assert.equal(h.batch.snapshot().counters.total, 0);
  assert.throws(
    () => h.batch.select(cohort.students[0], true, "replace", original.id),
    { code: "NFC_REPLACE_REQUIRED" },
  );
  h.batch.select(cohort.students[0], true, "replace", original.id, true);
  h.hooks.beforeRequest = async (path) => {
    if (path.endsWith("/nfc-confirm")) {
      assert.equal(
        (await cards(cohort)).find((r: any) => r.id === original.id).status,
        "active",
      );
      throw nfcFailure("NETWORK_UNAVAILABLE");
    }
  };
  await h.batch.start();
  assert.equal(h.batch.snapshot().counters.programmed, 0);
  assert.equal(
    (await cards(cohort)).find((r: any) => r.id === original.id).status,
    "active",
  );
  h.hooks.beforeRequest = undefined;
  await h.batch.resume();
  const rows = await cards(cohort),
    active = rows.find((r: any) => r.status === "active");
  assert.equal(rows.filter((r: any) => r.status === "active").length, 1);
  assert.equal(rows.find((r: any) => r.id === original.id).status, "replaced");
  assert.equal(
    rows.find((r: any) => r.id === original.id).replaced_by_card_id,
    active.id,
  );
  assert.equal(active.nfc_replaces_card_id, original.id);
  assert.equal(h.stats().writes, 2);
  await h.batch.dispose();
});

test("Restart: lost response followed by full controller disposal, explicit canonical reselection never rewrites", async () => {
  const cohort = await fixture.cohort(1),
    old = harness(cohort);
  old.hooks.afterRequest = async (path) => {
    if (path.endsWith("/nfc-confirm")) throw nfcFailure("NETWORK_UNAVAILABLE");
  };
  await old.batch.prepare();
  old.batch.selectAll();
  await old.batch.start();
  await old.batch.dispose();
  const recovered = harness(cohort);
  recovered.identities.set(
    cohort.students[0],
    old.identities.get(cohort.students[0])!,
  );
  for (const [uid, ndef] of old.chips) recovered.chips.set(uid, ndef);
  await recovered.batch.prepare();
  recovered.batch.selectAll();
  assert.equal(
    recovered.batch.snapshot().counters.total,
    0,
    "Existing active card is not a new success",
  );
  const card = recovered.batch.snapshot().entries[0].cards[0];
  recovered.batch.select(cohort.students[0], true, "resume", card.id);
  await recovered.batch.start();
  await assertSuccessful(cohort, recovered, 1);
  assert.equal(recovered.stats().writes, 0);
  assert.equal(
    recovered.requests.filter(
      (r) => r.path === "/student-cards" || r.path.endsWith("/nfc-retry"),
    ).length,
    0,
  );
  await recovered.batch.dispose();
});

test("Restart pending: lost issue response requires explicit retry; retry UUID differs from unchanged reservation UUID", async () => {
  const cohort = await fixture.cohort(1),
    old = harness(cohort);
  old.hooks.afterRequest = async (path) => {
    if (path === "/student-cards") throw nfcFailure("NETWORK_UNAVAILABLE");
  };
  await old.batch.prepare();
  old.batch.selectAll();
  await old.batch.start();
  const pending = (await cards(cohort))[0];
  assert.equal(pending.status, "issued");
  assert.equal(old.stats().writes, 0);
  await old.batch.dispose();
  const recovered = harness(cohort);
  recovered.identities.set(
    cohort.students[0],
    old.identities.get(cohort.students[0])!,
  );
  await recovered.batch.prepare();
  recovered.batch.select(cohort.students[0], true, "resume", pending.id);
  await recovered.batch.start();
  assert.equal(recovered.batch.snapshot().counters.programmed, 0);
  assert.equal(recovered.stats().writes, 0);
  assert.equal(recovered.stats().mutations, 0);
  let retryId: unknown;
  recovered.hooks.beforeRequest = async (path, body) => {
    if (path.endsWith("/nfc-retry")) retryId = body?.operationId;
  };
  await recovered.batch.rewrite(cohort.students[0], true);
  await assertSuccessful(cohort, recovered, 1);
  const active = (await cards(cohort))[0];
  assert.equal(active.id, pending.id);
  assert.equal(active.nfc_operation_id, pending.nfc_operation_id);
  assert.notEqual(retryId, pending.nfc_operation_id);
  assert.equal(active.nfc_retry_operation_ids.length, 1);
  assert.equal(active.nfc_retry_operation_ids[0], retryId);
  assert.equal(recovered.stats().writes, 1);
  await recovered.batch.dispose();
});

test("Pause during native write waits for in-flight lease and leaves PostgreSQL pending until explicit recovery", async () => {
  const cohort = await fixture.cohort(2),
    h = harness(cohort);
  let began!: () => void, release!: () => void;
  const started = new Promise<void>((done) => {
    began = done;
  });
  const held = new Promise<void>((done) => {
    release = done;
  });
  h.hooks.beforeWrite = async () => {
    began();
    await held;
  };
  await h.batch.prepare();
  h.batch.selectAll();
  const running = h.batch.start();
  await started;
  let suspended = false;
  const pausing = h.batch.pause().then(() => {
    suspended = true;
  });
  await new Promise((done) => setImmediate(done));
  assert.equal(suspended, false);
  assert.equal(h.batch.snapshot().mode, "pausing");
  assert.equal(
    (await cards(cohort)).filter((r: any) => r.status === "active").length,
    0,
  );
  release();
  await Promise.all([running, pausing]);
  assert.equal(h.batch.snapshot().mode, "paused");
  assert.equal(h.batch.snapshot().counters.programmed, 0);
  assert.equal(
    (await cards(cohort)).length,
    1,
    "Second pupil must not be reserved during pause",
  );
  assert.equal((await cards(cohort))[0].status, "issued");
  h.hooks.beforeWrite = undefined;
  await h.batch.resume();
  await assertSuccessful(cohort, h, 2);
  assert.equal(
    h.stats().writes,
    2,
    "Recovery reads the interrupted first write instead of rewriting",
  );
  await h.batch.dispose();
});

test("Canonical card metadata HTTP responses are non-cacheable", async () => {
  const cohort = await fixture.cohort(1);
  const response = await fixture.request(
    `/students/${cohort.students[0]}/cards`,
  );
  assert.equal(response.status, 200);
  assert.match(response.cacheControl || "", /no-store/);
});

test("F: authenticated HTTP rejects tenant/student/UUID/UID/model/token without mutations or secret leaks", async () => {
  const cohort = await fixture.cohort(2),
    h = harness(cohort),
    id = cohort.students[0];
  const identity = h.identities.get(id)!;
  const reserved = await h.api.issue(id, identity, randomUUID());
  assert.ok(reserved.cardToken);
  const body = {
    ...identity,
    studentId: id,
    operationId: reserved.nfc!.operationId,
    locked: false,
    cardToken: reserved.cardToken,
  };
  const path = `/student-cards/${reserved.id}/nfc-confirm`;
  const state = () =>
    fixture.pool
      .query(
        "SELECT row_to_json(c)::text AS data FROM student_access_cards c WHERE id=$1",
        [reserved.id],
      )
      .then((r: any) => r.rows);
  const before = await state();
  const auditBefore = await fixture.pool.query(
    "SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1",
    [reserved.id],
  );
  for (const [patch, expectedCode] of [
    [{ operationId: randomUUID() }, "STUDENT_CARD_NFC_OPERATION_MISMATCH"],
    [{ operationId: null }, "STUDENT_CARD_NFC_OPERATION_REQUIRED"],
    [{ studentId: cohort.students[1] }, "STUDENT_CARD_NFC_MISMATCH"],
    [{ uid: "04ABCDEF123456" }, "STUDENT_CARD_NFC_MISMATCH"],
    [{ tagType: "NTAG216" }, "STUDENT_CARD_NFC_MISMATCH"],
    [
      { cardToken: `${reserved.publicId}.${"Z".repeat(43)}` },
      "STUDENT_CARD_NOT_FOUND",
    ],
  ] as const) {
    const response = await fixture.request(path, {
      method: "POST",
      body: JSON.stringify({ ...body, ...patch }),
    });
    assert.ok(response.status >= 400);
    assert.equal(response.data.code, expectedCode);
    assert.equal(response.cacheControl, "no-store");
    for (const secret of secrets)
      assert.equal(
        JSON.stringify(response.data).includes(secret),
        false,
        "Refusal must not echo capability",
      );
    assert.deepEqual(await state(), before);
  }
  for (const token of [
    fixture.schools[1].token,
    fixture.extraTokens.teacher,
    fixture.extraTokens.super,
    fixture.extraTokens.country,
    null,
  ]) {
    for (const route of [
      path,
      `/student-cards/${reserved.id}/revoke`,
      `/student-cards/${reserved.id}/replace`,
      `/student-cards/${reserved.id}/nfc-retry`,
    ]) {
      const response = await fixture.request(
        route,
        { method: "POST", body: JSON.stringify({ ...body, nfc: identity }) },
        token,
      );
      assert.ok([401, 403, 404].includes(response.status));
      assert.deepEqual(await state(), before);
    }
  }
  const externalList = await fixture.request(
    `/students/${id}/cards`,
    {},
    fixture.schools[1].token,
  );
  assert.equal(externalList.status, 404);
  assert.equal(
    JSON.stringify(externalList.data).includes(reserved.publicId),
    false,
  );
  const externalIssue = await fixture.request(
    "/student-cards",
    {
      method: "POST",
      body: JSON.stringify({
        studentId: id,
        medium: "nfc",
        nfc: identity,
        operationId: randomUUID(),
      }),
    },
    fixture.schools[1].token,
  );
  assert.equal(externalIssue.status, 404);
  assert.deepEqual(
    (
      await fixture.pool.query(
        "SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1",
        [reserved.id],
      )
    ).rows,
    auditBefore.rows,
  );
});

test("F: flags, expired or revoked reservations cannot activate; revocation stays effective on replay", async () => {
  for (const scenario of ["flag", "expired", "revoked"] as const) {
    const cohort = await fixture.cohort(1),
      h = harness(cohort),
      id = cohort.students[0],
      identity = h.identities.get(id)!;
    const card = await h.api.issue(id, identity, randomUUID());
    const body = {
      ...identity,
      studentId: id,
      operationId: card.nfc!.operationId,
      locked: false,
      cardToken: card.cardToken,
    };
    if (scenario === "flag")
      await fixture.pool.query(
        "UPDATE school_settings SET student_card_nfc_enabled=FALSE WHERE school_id=$1",
        [cohort.school.id],
      );
    if (scenario === "expired")
      await fixture.pool.query(
        "UPDATE student_access_cards SET issued_at=now()-interval '31 minutes',nfc_reservation_expires_at=now()-interval '1 minute' WHERE id=$1",
        [card.id],
      );
    if (scenario === "revoked")
      assert.equal(
        (
          await fixture.request(`/student-cards/${card.id}/revoke`, {
            method: "POST",
            body: JSON.stringify({ reason: "nfc_abandoned" }),
          })
        ).status,
        200,
      );
    const response = await fixture.request(
      `/student-cards/${card.id}/nfc-confirm`,
      { method: "POST", body: JSON.stringify(body) },
    );
    assert.equal(
      response.data.code,
      {
        flag: "STUDENT_CARD_NFC_DISABLED",
        expired: "STUDENT_CARD_NFC_EXPIRED",
        revoked: "STUDENT_CARD_INVALID_STATE",
      }[scenario],
    );
    assert.notEqual((await cards(cohort))[0].status, "active");
    assert.equal(
      (
        await fixture.pool.query(
          "SELECT count(*)::int AS n FROM audit_logs WHERE entity_id=$1 AND action='student_card_nfc_encoded'",
          [card.id],
        )
      ).rows[0].n,
      0,
    );
    await fixture.pool.query(
      "UPDATE school_settings SET student_card_nfc_enabled=TRUE WHERE school_id=$1",
      [cohort.school.id],
    );
  }
});

test("Class boundary: transfer visible before confirmation blocks batch; GET/POST race remains an explicit V1 limitation", async () => {
  const cohort = await fixture.cohort(1),
    destination = await fixture.cohort(0),
    h = harness(cohort);
  h.hooks.beforeWrite = async () => {
    await fixture.pool.query(
      "UPDATE enrollments SET class_id=$1 WHERE student_id=$2",
      [destination.classId, cohort.students[0]],
    );
  };
  await h.batch.prepare();
  h.batch.selectAll();
  await h.batch.start();
  assert.equal(h.batch.snapshot().counters.programmed, 0);
  assert.equal((await cards(cohort))[0].status, "issued");
  assert.equal(
    h.requests.filter((r) => r.path.endsWith("/nfc-confirm")).length,
    0,
  );
  await h.batch.dispose();
});

test("Class boundary race reproduced: school-scoped card can confirm if transfer commits between last GET and POST", async () => {
  const cohort = await fixture.cohort(1),
    destination = await fixture.cohort(0),
    h = harness(cohort);
  h.hooks.beforeRequest = async (path) => {
    if (path.endsWith("/nfc-confirm"))
      await fixture.pool.query(
        "UPDATE enrollments SET class_id=$1 WHERE student_id=$2",
        [destination.classId, cohort.students[0]],
      );
  };
  await h.batch.prepare();
  h.batch.selectAll();
  await h.batch.start();
  assert.equal(h.batch.snapshot().counters.programmed, 1);
  const row = (await cards(cohort))[0];
  assert.equal(row.student_id, cohort.students[0]);
  assert.equal(row.school_id, cohort.school.id);
  assert.equal(row.status, "active");
  assert.equal(
    (
      await fixture.pool.query(
        "SELECT class_id FROM enrollments WHERE student_id=$1",
        [cohort.students[0]],
      )
    ).rows[0].class_id,
    destination.classId,
  );
  await h.batch.prepare();
  assert.equal(
    h.batch.snapshot().counters.programmed,
    0,
    "Canonical refresh removes transferred pupil from success population",
  );
  assert.equal(h.batch.snapshot().entries[0].member, false);
  await h.batch.dispose();
});

test("Secrets and side effects: no capability in persisted rows/audit/idempotency or Mobile snapshots; no attendance/finance mutation", async () => {
  const dump = await fixture.pool
    .query(`SELECT 'cards' AS source,row_to_json(c)::text AS data FROM student_access_cards c
    UNION ALL SELECT 'audit',coalesce(old_value::text,'')||coalesce(new_value::text,'') FROM audit_logs
    UNION ALL SELECT 'idempotency',coalesce(response_body::text,'') FROM idempotency_keys`);
  for (const secret of secrets)
    for (const row of dump.rows)
      assert.equal(
        row.data.includes(secret),
        false,
        "No cleartext capability in PostgreSQL",
      );
  const cohort = await fixture.cohort(1),
    h = harness(cohort);
  await h.batch.prepare();
  h.batch.selectAll();
  await h.batch.start();
  const rendered = JSON.stringify(h.snapshots);
  for (const secret of secrets)
    assert.equal(
      rendered.includes(secret),
      false,
      "No capability in display snapshots",
    );
  for (const table of [
    "attendance",
    "payments",
    "student_fee_obligations",
    "payment_allocations",
  ]) {
    assert.equal(
      (await fixture.pool.query(`SELECT count(*)::int AS n FROM ${table}`))
        .rows[0].n,
      0,
      `${table} must not change`,
    );
  }
  assert.ok(
    h.requests.every(
      (r) =>
        !/attendance|scan|finance|payments|transport|obligations/.test(r.path),
    ),
  );
  await h.batch.dispose();
});
