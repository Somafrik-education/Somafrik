import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import {
  createNfcBatch,
  batchCounters,
  type BatchRoster,
  type BatchSnapshot,
} from "./studentCardNfcBatch";
import {
  parseBatchRoster,
  createBatchRosterLoader,
  type BatchScope,
} from "./studentCardNfcBatchRoster";
import { studentCardEnrollmentAccess } from "./studentCardEnrollmentAccess";
import {
  nfcFailure,
  ndefForCard,
  type EnrollmentCard,
  type IssuedNfcCard,
  type NfcEncoderHardware,
  type NfcEnrollmentApi,
} from "./studentCardNfcEncoding";
const SCHOOL = "11111111-1111-4111-8111-111111111111",
  CLASS = "22222222-2222-4222-8222-222222222222";
const IDS = [
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];
const UIDS = ["04112233445566", "04778899001122", "04AABBCCDDEEFF"];
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(count = 3) {
  let valid = true,
    enabled = true,
    available = true,
    presented = UIDS[0],
    owner = false,
    maxOwners = 0,
    owners = 0;
  let roster: BatchRoster = {
    classId: CLASS,
    classCode: "CLS-A",
    className: "Classe A",
    students: IDS.slice(0, count).map((id, i) => ({
      id,
      name: `Élève ${i + 1}`,
      code: `ELE-${i + 1}`,
    })),
  };
  const cards = new Map<string, IssuedNfcCard[]>();
  const chip = new Map<string, string>();
  const events: string[] = [];
  const states: BatchSnapshot[] = [];
  const metadata = (card: IssuedNfcCard): EnrollmentCard => {
    const { cardToken, ...safe } = card;
    return structuredClone(safe);
  };
  const device: NfcEncoderHardware = {
    async availability() {
      if (!available) throw nfcFailure("NFC_DISABLED");
    },
    async inspect() {
      events.push("inspect");
      return { uid: presented, tagType: "NTAG216" };
    },
    async openNdef(expected) {
      assert.equal(expected, presented);
      if (!owner) {
        owner = true;
        owners++;
        maxOwners = Math.max(maxOwners, owners);
      }
    },
    async readText() {
      return chip.get(presented) || "";
    },
    async writeText(value) {
      events.push(`write:${presented}`);
      chip.set(presented, value);
    },
    async isReadOnly() {
      return false;
    },
    async close() {
      if (owner) {
        owner = false;
        owners--;
      }
    },
  };
  const api: NfcEnrollmentApi = {
    async list(id) {
      events.push(`list:${id}`);
      return {
        nfcEnabled: enabled,
        cards: (cards.get(id) || []).map(metadata),
      };
    },
    async issue(id, identity, operationId) {
      events.push(`issue:${id}`);
      for (const all of cards.values())
        if (all.some((c) => c.nfc?.uid === identity.uid))
          throw nfcFailure("STUDENT_CARD_NFC_UID_EXISTS");
      const publicId = String.fromCharCode(65 + IDS.indexOf(id)).repeat(22);
      const card: IssuedNfcCard = {
        id: randomUUID(),
        publicId,
        medium: "nfc",
        status: "issued",
        cardToken: `${publicId}.${"S".repeat(43)}`,
        tokenAvailable: true,
        nfc: {
          ...identity,
          state: "pending",
          operationId,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          replacesCardId: null,
        },
      };
      cards.set(id, [...(cards.get(id) || []), card]);
      return structuredClone(card);
    },
    async replace(old, id, identity, operationId) {
      const issued = await api.issue(id, identity, operationId);
      issued.nfc!.replacesCardId = old.id;
      cards.get(id)!.find((c) => c.id === issued.id)!.nfc!.replacesCardId =
        old.id;
      return issued;
    },
    async retry(card, identity, operationId) {
      events.push(`rotate:${card.id}`);
      assert.ok(operationId);
      const stored = [...cards.values()].flat().find((c) => c.id === card.id)!;
      stored.cardToken = `${card.publicId}.${"T".repeat(43)}`;
      return { ...structuredClone(stored), reissued: true };
    },
    async confirm(card, token, locked, id) {
      events.push(`confirm:${id}`);
      const stored = cards.get(id)?.find((c) => c.id === card.id);
      assert.ok(stored);
      assert.equal(token, stored.cardToken);
      if (card.nfc?.operationId !== stored.nfc?.operationId)
        throw nfcFailure("STUDENT_CARD_NFC_OPERATION_MISMATCH");
      if (stored.status === "active")
        return {
          ...metadata(stored),
          idempotentReplay: true,
        } as EnrollmentCard;
      if (stored.nfc?.replacesCardId) {
        const old = cards
          .get(id)
          ?.find((c) => c.id === stored.nfc?.replacesCardId);
        assert.equal(old?.status, "active");
        old!.status = "replaced";
      }
      stored.status = "active";
      stored.nfc!.state = locked ? "locked" : "encoded";
      return metadata(stored);
    },
  };
  const batch = createNfcBatch({
    classId: CLASS,
    classCode: "CLS-A",
    api,
    hardware: device,
    uuid: randomUUID,
    valid: () => valid,
    async loadRoster() {
      events.push("roster");
      return structuredClone(roster);
    },
    changed(s) {
      states.push(s);
      if (s.currentId) presented = UIDS[IDS.indexOf(s.currentId)];
    },
  });
  function oldActive(id = IDS[0]) {
    const card: IssuedNfcCard = {
      id: randomUUID(),
      publicId: "O".repeat(22),
      medium: "nfc",
      status: "active",
      cardToken: `${"O".repeat(22)}.${"P".repeat(43)}`,
      nfc: {
        uid: "04000000000001",
        tagType: "NTAG216",
        state: "encoded",
        operationId: randomUUID(),
        expiresAt: "2026-10-13T23:30:00Z",
      },
    };
    cards.set(id, [card]);
    return card;
  }
  return {
    batch,
    device,
    api,
    cards,
    chip,
    events,
    states,
    oldActive,
    get roster() {
      return roster;
    },
    setRoster(r: BatchRoster) {
      roster = r;
    },
    get maxOwners() {
      return maxOwners;
    },
    invalidate() {
      valid = false;
    },
    setEnabled(v: boolean) {
      enabled = v;
    },
    setAvailable(v: boolean) {
      available = v;
    },
    setPresented(uid: string) {
      presented = uid;
    },
  };
}
const prepared = async () => {
  const f = fixture();
  await f.batch.prepare();
  f.batch.selectAll();
  return f;
};
test("empty class has zero counts and performs no NFC request", async () => {
  const f = fixture(0);
  await f.batch.prepare();
  f.batch.selectAll();
  await f.batch.start();
  assert.deepEqual(f.batch.snapshot().counters, {
    total: 0,
    programmed: 0,
    remaining: 0,
    errors: 0,
    inProgress: 0,
  });
  assert.ok(!f.events.includes("inspect"));
});
test("individual selection, select all eligible and deselection exclude active cards and pending reservations", async () => {
  const f = fixture();
  const active = f.oldActive();
  await f.api.issue(IDS[1], { uid: UIDS[1], tagType: "NTAG216" }, randomUUID());
  await f.batch.prepare();
  f.batch.selectAll();
  assert.deepEqual(
    f.batch
      .snapshot()
      .entries.filter((e) => e.selected)
      .map((e) => e.student.id),
    [IDS[2]],
  );
  assert.throws(() => f.batch.select(IDS[0], true), {
    code: "NFC_REPLACE_REQUIRED",
  });
  assert.throws(() =>
    f.batch.select(IDS[0], true, "replace", active.id, false),
  );
  const pending = f.cards.get(IDS[1])![0];
  f.batch.select(IDS[1], true, "resume", pending.id);
  assert.equal(f.batch.snapshot().counters.total, 2);
  f.batch.deselectAll();
  assert.equal(f.batch.snapshot().counters.total, 0);
});
test("three pupils run sequentially, confirmation before next, one NFC owner and coherent counters", async () => {
  const f = await prepared();
  await f.batch.start();
  assert.deepEqual(f.batch.snapshot().counters, {
    total: 3,
    programmed: 3,
    remaining: 0,
    errors: 0,
    inProgress: 0,
  });
  assert.equal(f.maxOwners, 1);
  for (let i = 0; i < 2; i++)
    assert.ok(
      f.events.indexOf(`confirm:${IDS[i]}`) <
        f.events.indexOf(`issue:${IDS[i + 1]}`),
    );
  for (const s of f.states) {
    assert.equal(
      s.counters.total,
      s.counters.programmed + s.counters.remaining,
    );
    assert.ok(s.counters.errors <= s.counters.remaining);
    assert.ok(s.counters.inProgress <= 1);
  }
});
test("failure on second pupil stays remaining; explicit skip continues third without corruption", async () => {
  const f = await prepared();
  const write = f.device.writeText;
  f.device.writeText = async (v) => {
    if (f.batch.snapshot().currentId === IDS[1])
      throw nfcFailure("NFC_READBACK");
    return write(v);
  };
  await f.batch.start();
  assert.deepEqual(f.batch.snapshot().counters, {
    total: 3,
    programmed: 1,
    remaining: 2,
    errors: 1,
    inProgress: 0,
  });
  assert.ok(!f.events.includes(`issue:${IDS[2]}`));
  await f.batch.skip(IDS[1]);
  assert.deepEqual(f.batch.snapshot().counters, {
    total: 3,
    programmed: 2,
    remaining: 1,
    errors: 1,
    inProgress: 0,
  });
  assert.equal(f.batch.snapshot().entries[1].state, "skipped");
});
test("second pupil interruption resumes existing reservation, explicit rewrite then third", async () => {
  const f = await prepared();
  const write = f.device.writeText;
  let failure = true;
  f.device.writeText = async (v) => {
    if (f.batch.snapshot().currentId === IDS[1] && failure)
      throw nfcFailure("NFC_READBACK");
    return write(v);
  };
  await f.batch.start();
  failure = false;
  await f.batch.retry(IDS[1]);
  assert.equal(f.batch.snapshot().entries[1].state, "error");
  assert.ok(
    f.batch.snapshot().entries[1].cards.some((c) => c.status === "issued"),
  );
  assert.equal(f.events.filter((e) => e === `issue:${IDS[1]}`).length, 1);
  assert.ok(!f.events.some((e) => e.startsWith("rotate:")));
  assert.throws(() => f.batch.rewrite(IDS[1], false), {
    code: "NFC_REWRITE_REQUIRED",
  });
  await f.batch.rewrite(IDS[1], true);
  assert.equal(f.batch.snapshot().counters.programmed, 3);
  assert.equal(f.events.filter((e) => e.startsWith("rotate:")).length, 1);
});
for (const code of [
  "STUDENT_CARD_NFC_EXPIRED",
  "NETWORK_UNAVAILABLE",
  "STUDENT_CARD_NFC_OPERATION_MISMATCH",
  "STUDENT_CARD_NFC_DISABLED",
  "STUDENT_CARD_TENANT_DENIED",
])
  test(`${code} leaves second unconfirmed and never auto advances`, async () => {
    const f = await prepared();
    const confirm = f.api.confirm;
    f.api.confirm = async (...a) => {
      if (a[3] === IDS[1]) throw nfcFailure(code);
      return confirm(...a);
    };
    await f.batch.start();
    assert.equal(f.batch.snapshot().counters.programmed, 1);
    assert.equal(f.batch.snapshot().counters.remaining, 2);
    assert.ok(!f.events.includes(`issue:${IDS[2]}`));
  });
test("lost response after activation reconciles and confirms same reservation with no second write or issue", async () => {
  const f = await prepared();
  const confirm = f.api.confirm;
  let lost = true;
  f.api.confirm = async (...a) => {
    const result = await confirm(...a);
    if (a[3] === IDS[1] && lost) throw nfcFailure("TIMEOUT");
    return result;
  };
  await f.batch.start();
  assert.equal(f.cards.get(IDS[1])![0].status, "active");
  assert.equal(f.batch.snapshot().counters.programmed, 1);
  lost = false;
  await f.batch.retry(IDS[1]);
  assert.equal(f.batch.snapshot().counters.programmed, 3);
  assert.equal(f.events.filter((e) => e === `issue:${IDS[1]}`).length, 1);
  assert.equal(f.events.filter((e) => e === `write:${UIDS[1]}`).length, 1);
});
test("NFC disabled and flags false reject before issuing any card", async () => {
  const f = await prepared();
  f.setAvailable(false);
  await f.batch.start();
  assert.equal(f.batch.snapshot().counters.programmed, 0);
  assert.ok(!f.events.some((e) => e.startsWith("issue:")));
  const g = fixture();
  g.setEnabled(false);
  await g.batch.prepare();
  assert.equal(g.batch.snapshot().mode, "blocked");
  assert.equal(g.batch.snapshot().entries.length, 0);
});
test("different content after write refuses confirmation and next pupil", async () => {
  const f = await prepared();
  f.device.writeText = async () => {};
  await f.batch.start();
  assert.equal(f.batch.snapshot().counters.programmed, 0);
  assert.ok(!f.events.some((e) => e.startsWith("confirm:")));
  assert.ok(!f.events.includes(`issue:${IDS[1]}`));
});
test("pause before starting, then explicit resume only", async () => {
  const f = await prepared();
  await f.batch.pause();
  assert.ok(!f.events.some((e) => e.startsWith("issue:")));
  assert.equal(f.batch.snapshot().mode, "paused");
  await f.batch.resume();
  assert.equal(f.batch.snapshot().counters.programmed, 3);
});
test("pause during write waits for safe cancellation; resumes without rewrite or a new reservation", async () => {
  const f = await prepared();
  const gate = deferred<void>(),
    entered = deferred<void>();
  const write = f.device.writeText,
    close = f.device.close;
  let holding = true,
    writing = false;
  f.device.writeText = async (v) => {
    if (holding) {
      writing = true;
      entered.resolve();
      await gate.promise;
      writing = false;
    }
    return write(v);
  };
  f.device.close = async () => {
    if (writing) {
      await gate.promise;
    }
    return close();
  };
  const running = f.batch.start();
  await entered.promise;
  const pausing = f.batch.pause();
  assert.equal(f.batch.snapshot().mode, "pausing");
  assert.throws(() => f.batch.start(), { code: "NFC_BUSY" });
  gate.resolve();
  holding = false;
  await running;
  await pausing;
  assert.equal(f.batch.snapshot().mode, "paused");
  assert.equal(f.batch.snapshot().counters.programmed, 0);
  assert.ok(!f.events.some((e) => e.startsWith("confirm:")));
  await f.batch.resume();
  assert.equal(f.batch.snapshot().counters.programmed, 3);
  assert.equal(f.events.filter((e) => e === `write:${UIDS[0]}`).length, 1);
});
test("double starts cannot create two pipelines", async () => {
  const f = await prepared();
  const gate = deferred<void>(),
    entered = deferred<void>();
  const issue = f.api.issue;
  f.api.issue = async (...a) => {
    entered.resolve();
    await gate.promise;
    return issue(...a);
  };
  const first = f.batch.start();
  await entered.promise;
  assert.throws(() => f.batch.start(), { code: "NFC_BUSY" });
  gate.resolve();
  await first;
  assert.equal(f.maxOwners, 1);
  assert.equal(f.events.filter((e) => e.startsWith("issue:")).length, 3);
});
test("logout or tenant change after reservation response blocks writes, counters and next pupil", async () => {
  const f = await prepared();
  const issue = f.api.issue;
  f.api.issue = async (...a) => {
    const card = await issue(...a);
    f.invalidate();
    return card;
  };
  await f.batch.start();
  assert.equal(f.batch.snapshot().counters.programmed, 0);
  assert.ok(!f.events.some((e) => e.startsWith("write:")));
  assert.ok(!f.events.includes(`issue:${IDS[1]}`));
});
test("student moved out of selected class before confirmation is refused despite correct chip", async () => {
  const f = await prepared();
  const write = f.device.writeText;
  f.device.writeText = async (v) => {
    await write(v);
    f.setRoster({ ...f.roster, students: f.roster.students.slice(1) });
  };
  await f.batch.start();
  assert.ok(!f.events.some((e) => e.startsWith("confirm:")));
  assert.equal(f.batch.snapshot().counters.programmed, 0);
});
test("class change after selection refuses before any issuance", async () => {
  const f = await prepared();
  f.setRoster({ ...f.roster, classId: randomUUID() });
  await f.batch.start();
  assert.ok(!f.events.some((e) => e.startsWith("issue:")));
  assert.equal(f.batch.snapshot().counters.programmed, 0);
});
for (const fail of [true, false])
  test(`replacement requires consent and preserves old card until confirmation (${fail ? "failure" : "success"})`, async () => {
    const f = fixture(1);
    const old = f.oldActive();
    await f.batch.prepare();
    assert.throws(() => f.batch.select(IDS[0], true, "replace", old.id, false));
    f.batch.select(IDS[0], true, "replace", old.id, true);
    const write = f.device.writeText;
    f.device.writeText = async (v) => {
      assert.equal(old.status, "active");
      if (fail) throw nfcFailure("NFC_READBACK");
      return write(v);
    };
    await f.batch.start();
    assert.equal(old.status, fail ? "active" : "replaced");
    assert.equal(f.batch.snapshot().counters.programmed, fail ? 0 : 1);
  });
test("restart reloads canonical cards; reselect pending and explicitly verify an active uncertain result", async () => {
  const f = fixture();
  const pending = await f.api.issue(
    IDS[0],
    { uid: UIDS[0], tagType: "NTAG216" },
    randomUUID(),
  );
  f.chip.set(UIDS[0], ndefForCard(pending.cardToken!));
  const active = await f.api.issue(
    IDS[1],
    { uid: UIDS[1], tagType: "NTAG216" },
    randomUUID(),
  );
  f.chip.set(UIDS[1], ndefForCard(active.cardToken!));
  await f.api.confirm(active, active.cardToken!, false, IDS[1]);
  await f.batch.prepare();
  f.batch.select(IDS[0], true, "resume", pending.id);
  f.batch.select(IDS[1], true, "resume", active.id);
  await f.batch.start();
  assert.equal(f.batch.snapshot().counters.programmed, 2);
  assert.ok(!f.events.some((e) => e.startsWith("write:")));
  assert.ok(!f.events.some((e) => e.startsWith("rotate:")));
});
test("snapshots whitelist fields, fixed errors and no plaintext secret storage", async () => {
  const f = await prepared();
  const confirm = f.api.confirm;
  f.api.confirm = async (...a) =>
    ({
      ...(await confirm(...a)),
      cardToken: "DO-NOT-KEEP",
      token_hash: "DO-NOT-KEEP",
    }) as EnrollmentCard;
  await f.batch.start();
  assert.ok(!JSON.stringify(f.batch.snapshot()).includes("DO-NOT-KEEP"));
  assert.ok(!JSON.stringify(f.batch.snapshot()).includes("S".repeat(43)));
  for (const path of ["studentCardNfcBatch.ts", "studentCardNfcBatchRoster.ts"])
    assert.doesNotMatch(
      readFileSync(new URL(path, import.meta.url), "utf8"),
      /AsyncStorage|SecureStore|SQLite|localStorage|console\.|safeLogger/,
    );
});
test("confirmed receipt is rechecked against canon on refresh; revoked card becomes remaining error", async () => {
  const f = await prepared();
  await f.batch.start();
  f.cards.get(IDS[0])![0].status = "revoked";
  await f.batch.prepare();
  assert.equal(f.batch.snapshot().counters.programmed, 2);
  assert.equal(f.batch.snapshot().counters.remaining, 1);
  assert.equal(f.batch.snapshot().counters.errors, 1);
});
test("disposing during a late confirmation suppresses all stale counts and next pupil", async () => {
  const f = await prepared();
  const gate = deferred<void>(),
    entered = deferred<void>();
  const confirm = f.api.confirm;
  f.api.confirm = async (...a) => {
    entered.resolve();
    await gate.promise;
    return confirm(...a);
  };
  const running = f.batch.start();
  await entered.promise;
  const closing = f.batch.dispose();
  gate.resolve();
  await running;
  await closing;
  assert.equal(f.batch.snapshot().mode, "disposed");
  assert.equal(f.batch.snapshot().entries.length, 0);
  assert.ok(!f.events.includes(`issue:${IDS[1]}`));
});
const scope: BatchScope = {
  schoolId: SCHOOL,
  schoolCodes: ["CD-IN-26-001", "CD-2026-0001"],
  classId: CLASS,
  classCode: "CLS-A",
};
const classes = [
  {
    id: CLASS,
    classCode: "CLS-A",
    name: "Classe A",
    schoolCode: "CD-2026-0001",
    status: "active",
  },
];
const pupils = [
  {
    id: "ELE-1",
    studentUuid: IDS[0],
    schoolId: SCHOOL,
    classId: CLASS,
    classCode: "CLS-A",
    name: "Élève 1",
    studentCode: "ELE-1",
    parentPhone: "REMOVE",
    birthDate: "REMOVE",
  },
];
test("roster uses canonical UUID, class and school; projects no unrelated personal data", () => {
  const r = parseBatchRoster(scope, classes, pupils);
  assert.deepEqual(r.students, [
    { id: IDS[0], name: "Élève 1", code: "ELE-1" },
  ]);
  assert.ok(!JSON.stringify(r).includes("REMOVE"));
});
for (const patch of [
  { schoolId: randomUUID() },
  { classId: randomUUID() },
  { classCode: "OTHER" },
  { studentUuid: "ELE-1" },
])
  test(`out-of-scope roster ${Object.keys(patch)[0]} fails closed`, () => {
    assert.throws(
      () => parseBatchRoster(scope, classes, [{ ...pupils[0], ...patch }]),
      { code: "NFC_SCOPE_DENIED" },
    );
  });
test("duplicate class names never substitute for class UUID/code; inactive and foreign catalogue refused", () => {
  assert.throws(() =>
    parseBatchRoster(scope, [{ ...classes[0], id: randomUUID() }], pupils),
  );
  assert.throws(() =>
    parseBatchRoster(scope, [{ ...classes[0], schoolCode: "FOREIGN" }], pupils),
  );
  assert.throws(() =>
    parseBatchRoster(scope, [{ ...classes[0], status: "inactive" }], pupils),
  );
  assert.throws(() => parseBatchRoster(scope, classes, [pupils[0], pupils[0]]));
  assert.throws(() => parseBatchRoster(scope, {}, pupils));
});
test("loader validates scoped catalogue before class endpoint; no generic unscoped student request", async () => {
  const paths: string[] = [];
  const load = createBatchRosterLoader(async <T>(path: string) => {
    paths.push(path);
    return (path === "/classes" ? classes : pupils) as T;
  }, scope);
  await load();
  assert.deepEqual(paths, ["/classes", "/classes/CLS-A/students"]);
});
test("platform and parent/student roles denied even with all privileges", () => {
  for (const role of [
    "super_admin",
    "country_admin",
    "parent_student",
    "student",
  ])
    assert.equal(
      studentCardEnrollmentAccess({
        role,
        permissions: ["ALL_PRIVILEGES", "Élèves:READ", "Élèves:UPDATE"],
      }).canUpdate,
      false,
    );
});
test("batch counters include unresolved skipped errors in remaining without double counting", () => {
  const f = fixture();
  assert.deepEqual(batchCounters(f.batch.snapshot().entries), {
    total: 0,
    programmed: 0,
    remaining: 0,
    errors: 0,
    inProgress: 0,
  });
});

test("presenting previous pupil's encoded tag refuses foreign NDEF before next reservation", async () => {
  const f = await prepared();
  const inspect = f.device.inspect;
  f.device.inspect = async () => {
    if (f.batch.snapshot().currentId === IDS[1]) f.setPresented(UIDS[0]);
    return inspect();
  };
  await f.batch.start();
  assert.equal(f.batch.snapshot().counters.programmed, 1);
  assert.ok(!f.events.includes(`issue:${IDS[1]}`));
});
test("historic associated UID with blank chip is refused before any new write", async () => {
  const f = fixture(2);
  f.oldActive(IDS[1]);
  await f.batch.prepare();
  f.batch.select(IDS[0], true);
  f.device.inspect = async () => {
    f.setPresented("04000000000001");
    return { uid: "04000000000001", tagType: "NTAG216" };
  };
  await f.batch.start();
  assert.equal(f.batch.snapshot().counters.programmed, 0);
  assert.ok(!f.events.some((e) => e.startsWith("write:")));
});
test("read-only virgin chip never reserves, rotates or writes", async () => {
  const f = await prepared();
  f.device.isReadOnly = async () => true;
  await f.batch.start();
  assert.ok(
    !f.events.some(
      (e) =>
        e.startsWith("issue:") ||
        e.startsWith("write:") ||
        e.startsWith("rotate:"),
    ),
  );
});
test("session UI wires canonical class key, safe Android Back, pause and explicit replacement", () => {
  const ui = readFileSync(
    new URL("../components/StudentCardNfcBatchControl.tsx", import.meta.url),
    "utf8",
  );
  const classesUI = readFileSync(
    new URL("../screens/ClassesScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    classesUI,
    /StudentCardNfcBatchControl key=\{`\$\{resourceScopeKey\}:\$\{item.id\}`\}/,
  );
  assert.match(ui, /studentCardEnrollmentAccess\(session\)/);
  assert.match(ui, /useIsFocused/);
  assert.match(ui, /permissionsBootstrap === "ready"/);
  assert.match(ui, /onRequestClose=\{\(\)\s*=>\s*void act\(close\)\}/);
  assert.match(ui, /await controller.current.finish\(\)/);
  assert.doesNotMatch(
    ui,
    /AsyncStorage|SecureStore|SQLite|localStorage|makeReadOnly|console\.|safeLogger/,
  );
});

test("server RBAC refusal hides cached pupil data and stops the queue", async () => {
  const f = await prepared();
  f.api.confirm = async () => {
    throw Object.assign(new Error("must not display"), { status: 403 });
  };
  await f.batch.start();
  const snapshot = f.batch.snapshot();
  assert.equal(snapshot.mode, "blocked");
  assert.equal(snapshot.roster, null);
  assert.ok(
    snapshot.entries.every(
      (e) => e.student.code === "" && !e.member && !e.cards.length,
    ),
  );
  assert.ok(!JSON.stringify(snapshot).includes("Élève 1"));
  assert.ok(!f.events.includes(`issue:${IDS[1]}`));
});
test("pause before reservation response prevents write and preserves uncertain UUID for explicit recovery", async () => {
  const f = await prepared();
  const gate = deferred<void>(),
    entered = deferred<void>();
  const issue = f.api.issue;
  let holding = true;
  f.api.issue = async (...a) => {
    const result = await issue(...a);
    if (holding) {
      entered.resolve();
      await gate.promise;
    }
    return result;
  };
  const running = f.batch.start();
  await entered.promise;
  const paused = f.batch.pause();
  assert.equal(f.batch.snapshot().mode, "pausing");
  gate.resolve();
  holding = false;
  await running;
  await paused;
  assert.ok(!f.events.some((e) => e.startsWith("write:")));
  await f.batch.retry(IDS[0]);
  assert.equal(f.events.filter((e) => e === `issue:${IDS[0]}`).length, 1);
  assert.ok(!f.events.some((e) => e.startsWith("rotate:")));
  assert.equal(f.batch.snapshot().counters.programmed, 0);
});
test("refresh keeps interrupted operation and subsequent resume shows the latest canonical status", async () => {
  const f = await prepared();
  const write = f.device.writeText;
  f.device.writeText = async () => {
    throw nfcFailure("NFC_READBACK");
  };
  await f.batch.start();
  await f.batch.prepare();
  f.cards.get(IDS[0])![0].status = "revoked";
  f.device.writeText = write;
  await f.batch.retry(IDS[0]);
  assert.equal(f.batch.snapshot().entries[0].cards[0].status, "revoked");
  assert.equal(f.events.filter((e) => e === `issue:${IDS[0]}`).length, 1);
});
test("failed native cleanup blocks every new pipeline until explicit successful cancellation", async () => {
  const f = await prepared();
  const close = f.device.close;
  f.device.close = async () => {
    throw new Error("native cancel failed");
  };
  await f.batch.pause();
  assert.equal(f.batch.snapshot().mode, "blocked");
  assert.throws(() => f.batch.start(), { code: "NFC_SESSION_BUSY" });
  f.device.close = close;
  await f.batch.pause();
  assert.equal(f.batch.snapshot().mode, "paused");
  await f.batch.resume();
  assert.equal(f.batch.snapshot().counters.programmed, 3);
});
test("skip during a pending confirmation waits and cannot apply its response to next pupil", async () => {
  const f = await prepared();
  const gate = deferred<void>(),
    entered = deferred<void>();
  const confirm = f.api.confirm;
  let holding = true;
  f.api.confirm = async (...a) => {
    const r = await confirm(...a);
    if (holding) {
      entered.resolve();
      await gate.promise;
    }
    return r;
  };
  const running = f.batch.start();
  await entered.promise;
  const skipped = f.batch.skip(IDS[0]);
  assert.equal(f.batch.snapshot().mode, "pausing");
  assert.ok(!f.events.includes(`issue:${IDS[1]}`));
  gate.resolve();
  holding = false;
  await running;
  await skipped;
  assert.equal(f.batch.snapshot().entries[0].state, "skipped");
  assert.equal(f.batch.snapshot().counters.programmed, 2);
  assert.equal(f.batch.snapshot().counters.remaining, 1);
});

test("explicit replacement can be individually deselected without mutating the old active card", async () => {
  const f = fixture(1);
  const old = f.oldActive();
  await f.batch.prepare();
  f.batch.select(IDS[0], true, "replace", old.id, true);
  f.batch.select(IDS[0], false);
  assert.equal(f.batch.snapshot().counters.total, 0);
  assert.equal(old.status, "active");
});
test("a scope-blocked session requires fresh canonical preparation before any restart", async () => {
  const f = await prepared();
  const confirm = f.api.confirm;
  f.api.confirm = async () => {
    throw Object.assign(new Error("denied"), { status: 403 });
  };
  await f.batch.start();
  f.api.confirm = confirm;
  assert.throws(() => f.batch.resume(), { code: "NFC_SCOPE_DENIED" });
  assert.ok(!f.events.includes(`issue:${IDS[1]}`));
  await f.batch.prepare();
  await f.batch.resume();
  assert.equal(f.batch.snapshot().counters.programmed, 3);
});
