/**
 * RC3-2 — Appel / Présences : enqueue SQLCipher puis drain, jamais POST direct.
 *   npx --yes tsx src/offline/outbox/presenceWrite.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { enqueueAndDrainPresenceUpsert } from "./presenceWrite";
import { createMemoryOutboxStore } from "./memoryStore";
import { RC3_OUTBOX_TAG, RC3_PHYSICAL_PRESENCE_SMOKE_TAG } from "./logs";
import type { OutboxTransport } from "./types";

const ROOT = path.resolve(__dirname, "../../..");
const partition = { userId: "user-a", schoolId: "school-a" };
const payload = {
  classId: "class-1",
  classCode: "6A",
  date: "27-08-2026",
  items: [{ studentId: "stu-1", status: "present" }],
};

function sendCountTransport(status: number, code?: string, body?: unknown): OutboxTransport & { sends: number; keys: string[] } {
  const transport = {
    sends: 0,
    keys: [] as string[],
    async send(input: { idempotencyKey: string }) {
      transport.sends += 1;
      transport.keys.push(input.idempotencyKey);
      return { status, code, body };
    },
  };
  return transport;
}

async function run() {
  const store = createMemoryOutboxStore();
  const offline = sendCountTransport(0, "NETWORK_UNAVAILABLE");
  const queued = await enqueueAndDrainPresenceUpsert({
    store,
    partition,
    payload,
    transport: offline,
  });
  assert.equal(queued.outcome, "queued");
  assert.ok(queued.idempotencyKey);
  assert.equal(offline.sends, 1, "drain après COMMIT seulement");
  assert.equal((await store.listByPartition(partition))[0]?.state, "pending");

  const again = await enqueueAndDrainPresenceUpsert({
    store,
    partition,
    payload: { ...payload, items: [{ studentId: "stu-1", status: "absent" }] },
    transport: sendCountTransport(0, "NETWORK_UNAVAILABLE"),
  });
  assert.equal(again.idempotencyKey, queued.idempotencyKey, "même intention : pas de nouvelle clé");
  assert.equal((await store.listByPartition(partition)).length, 1);
  assert.equal(again.outcome, "queued");

  const onlineStore = createMemoryOutboxStore();
  const online = sendCountTransport(201, undefined, [{ id: "pre-1" }]);
  const acked = await enqueueAndDrainPresenceUpsert({
    store: onlineStore,
    partition,
    payload,
    transport: online,
  });
  assert.equal(acked.outcome, "acked");
  assert.equal(online.sends, 1);
  assert.equal((await onlineStore.getById(acked.outboxId ?? ""))?.state, "acked");
  assert.equal(online.keys[0], acked.idempotencyKey);

  const screen = fs.readFileSync(path.join(ROOT, "src/screens/TeacherAttendanceScreen.tsx"), "utf8");
  assert.match(screen, /submitPresenceUpsertFromSession/);
  assert.match(screen, /presenceWrite/);
  assert.doesNotMatch(screen, /savePresences\s*\(/);
  assert.doesNotMatch(screen, /submitProtectedMutation/);
  assert.doesNotMatch(screen, /request:\s*\(\)\s*=>\s*savePresences/);
  assert.match(screen, /ROLL_CALL_COPY\.queued/);
  assert.match(screen, /ROLL_CALL_COPY\.syncedAlertTitle/);
  assert.doesNotMatch(screen, /expo-sqlite/);

  const writeSrc = fs.readFileSync(path.join(ROOT, "src/offline/outbox/presenceWrite.ts"), "utf8");
  assert.match(writeSrc, /enqueueOutboxOperation/);
  assert.match(writeSrc, /presence\.upsert/);
  assert.match(writeSrc, /drainOutbox/);
  assert.match(writeSrc, /defaultTransport\(\)/);
  assert.doesNotMatch(writeSrc, /transport: input\.transport \?\? createHttpOutboxTransport\(\)/);
  const insertAt = writeSrc.indexOf("const enqueued = await enqueueOutboxOperation");
  assert.ok(insertAt >= 0, "enqueue commit");
  assert.ok(writeSrc.slice(insertAt).indexOf("await drainOutbox") > 0, "enqueue avant drain");

  const engineSrc = fs.readFileSync(path.join(ROOT, "src/offline/outbox/engine.ts"), "utf8");
  assert.match(engineSrc, /event: "enqueue"/);
  assert.match(engineSrc, /event: "claim"/);
  assert.match(engineSrc, /event: "send"/);
  assert.match(engineSrc, /event: "ack"/);
  assert.match(engineSrc, /event: "retry"/);
  assert.match(engineSrc, /event: "reclaim"/);

  const logsSrc = fs.readFileSync(path.join(ROOT, "src/offline/outbox/logs.ts"), "utf8");
  assert.match(logsSrc, new RegExp(RC3_OUTBOX_TAG));
  assert.match(logsSrc, new RegExp(RC3_PHYSICAL_PRESENCE_SMOKE_TAG));
  assert.match(logsSrc, /RC3_PHYSICAL_PRESENCE_SMOKE_TAG\} OK/);

  const app = fs.readFileSync(path.join(ROOT, "App.tsx"), "utf8");
  assert.match(app, /PresenceOutboxRuntime/);

  console.log("presenceWrite.test.ts: OK enqueue-before-drain / same-key / screen unwired from POST direct");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
