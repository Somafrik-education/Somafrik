import { insertQueuedOutbox, readOutbox } from "./transaction.js";

function bindingError() {
  const error = new Error("POC_QUEUE_BINDING_REQUIRED");
  error.code = "POC_QUEUE_BINDING_REQUIRED";
  return error;
}

function publishError() {
  const error = new Error("POC_QUEUE_PUBLISH_FAILED");
  error.code = "POC_QUEUE_PUBLISH_FAILED";
  return error;
}

async function sendId(queue, id) {
  if (!queue || typeof queue.send !== "function") throw bindingError();
  try {
    await queue.send({ id });
  } catch (error) {
    if (error?.code === "POC_QUEUE_BINDING_REQUIRED") throw error;
    throw publishError();
  }
}

export async function enqueueNotification({ connectionString, queue, id }) {
  await insertQueuedOutbox(connectionString, id);
  await sendId(queue, id);
  return { id, status: "queued" };
}

export async function redeliverQueuedNotification({ connectionString, queue, id }) {
  const row = await readOutbox(connectionString, id);
  if (!row) {
    const error = new Error("POC_OUTBOX_NOT_FOUND");
    error.code = "POC_OUTBOX_NOT_FOUND";
    throw error;
  }
  if (row.status !== "queued") return { id, status: row.status };
  await sendId(queue, id);
  return { id, status: "queued" };
}
