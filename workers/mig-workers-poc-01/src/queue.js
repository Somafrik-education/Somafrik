import { markOutboxProcessed } from "./transaction.js";

// Consommateur POC. Le corps n'est qu'un identifiant de ligne.
// Aucun envoi Expo. Un second passage sur une ligne déjà `processed`
// accuse réception sans changer le statut. Une erreur laisse la ligne
// `queued` et demande un retry.
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
