import { markOutboxProcessed } from "./transaction.js";

export async function handleNotificationBatch(batch, connectionString) {
  for (const message of batch.messages) {
    const id = message?.body?.id;
    try {
      if (typeof id === "string" && id.length > 0) {
        await markOutboxProcessed(connectionString, id);
      }
      message.ack();
    } catch {
      message.retry();
    }
  }
}
