import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { handleNotificationBatch } from "../src/queue.js";
import { enqueueNotification, redeliverQueuedNotification } from "../src/queueDelivery.js";
import { insertQueuedOutbox, readOutbox } from "../src/transaction.js";

const connectionString = process.env.POC_DATABASE_URL ?? "";

function message(id, calls) {
  return {
    body: { id },
    ack() {
      calls.ack.push(id);
    },
    retry() {
      calls.retry.push(id);
    },
  };
}

test("outbox — échec de publication, doublon, traitement répété, reprise", async () => {
  assert.ok(connectionString, "POC_DATABASE_URL manquant");
  const id = randomUUID();
  const failing = {
    async send() {
      throw new Error("queue indisponible");
    },
  };

  await assert.rejects(
    enqueueNotification({ connectionString, queue: failing, id }),
    (error) => error?.code === "POC_QUEUE_PUBLISH_FAILED",
  );
  assert.deepEqual(await readOutbox(connectionString, id), { id, status: "queued" });

  const sent = [];
  const queue = {
    async send(body) {
      sent.push(body);
    },
  };
  assert.deepEqual(await redeliverQueuedNotification({ connectionString, queue, id }), {
    id,
    status: "queued",
  });
  assert.deepEqual(sent, [{ id }]);
  assert.equal(JSON.stringify(sent).includes("expo"), false);
  assert.deepEqual(await readOutbox(connectionString, id), { id, status: "queued" });

  const first = { ack: [], retry: [] };
  await handleNotificationBatch(
    { messages: [message(id, first), message(id, first)] },
    connectionString,
  );
  assert.deepEqual(first.ack, [id, id]);
  assert.deepEqual(first.retry, []);
  assert.deepEqual(await readOutbox(connectionString, id), { id, status: "processed" });

  const repeated = { ack: [], retry: [] };
  await handleNotificationBatch({ messages: [message(id, repeated)] }, connectionString);
  assert.deepEqual(repeated.ack, [id]);
  assert.deepEqual(repeated.retry, []);
  assert.deepEqual(await readOutbox(connectionString, id), { id, status: "processed" });

  const recoveryId = randomUUID();
  await insertQueuedOutbox(connectionString, recoveryId);
  const failedAttempt = { ack: [], retry: [] };
  await handleNotificationBatch(
    { messages: [message(recoveryId, failedAttempt)] },
    "postgresql://local:local@127.0.0.1:5432/somafrik",
  );
  assert.deepEqual(failedAttempt.retry, [recoveryId]);
  assert.deepEqual(failedAttempt.ack, []);
  assert.deepEqual(await readOutbox(connectionString, recoveryId), {
    id: recoveryId,
    status: "queued",
  });

  const recovered = { ack: [], retry: [] };
  await handleNotificationBatch(
    { messages: [message(recoveryId, recovered)] },
    connectionString,
  );
  assert.deepEqual(recovered.ack, [recoveryId]);
  assert.deepEqual(recovered.retry, []);
  assert.deepEqual(await readOutbox(connectionString, recoveryId), {
    id: recoveryId,
    status: "processed",
  });
});
