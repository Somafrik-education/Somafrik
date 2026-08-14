import type { PlatformNotification } from "./scope";

export function isUnreadNotification(item: PlatformNotification): boolean {
  const status = String(item.status ?? "").trim();
  return status !== "Lu" && status.toLowerCase() !== "read";
}

/** Payload POST : jamais d'identifiant client (ntf-*). */
export function buildPlatformNotificationCreatePayload(
  item: PlatformNotification,
): Record<string, unknown> {
  const { id: _clientId, ...payload } = item;
  return payload;
}

/** Remplace l'éventuelle ligne locale par la notification canonique PostgreSQL. */
export function applyCreatedPlatformNotification(
  current: PlatformNotification[],
  created: PlatformNotification,
  clientId?: string,
): PlatformNotification[] {
  const withoutStale = current.filter(
    (row) => row.id !== clientId && row.id !== created.id,
  );
  return [created, ...withoutStale];
}

/** PATCH lecture : uniquement le statut, identifiant serveur obligatoire. */
export function buildPlatformNotificationReadPatch(
  item: PlatformNotification,
): { id: string; patch: Record<string, unknown> } {
  const id = String(item.id ?? "").trim();
  if (!id || id.startsWith("ntf-")) {
    throw new Error("PLATFORM_NOTIFICATION_SERVER_ID_REQUIRED");
  }
  return { id, patch: { status: "Lu" } };
}

/** Fusionne la réponse PATCH dans la liste locale. */
export function applyReadPlatformNotification(
  current: PlatformNotification[],
  updated: PlatformNotification,
): PlatformNotification[] {
  return current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row));
}

/** Parcours création → marquer lu : l'ID PATCH doit être celui renvoyé par le POST. */
export function resolveMarkReadTargetId(
  created: PlatformNotification,
  clientId?: string,
): string {
  const serverId = String(created.id ?? "").trim();
  if (!serverId) {
    throw new Error("PLATFORM_NOTIFICATION_SERVER_ID_REQUIRED");
  }
  if (clientId && serverId === clientId) {
    throw new Error("PLATFORM_NOTIFICATION_CLIENT_ID_NOT_CANONICAL");
  }
  return serverId;
}
