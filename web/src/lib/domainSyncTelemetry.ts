import type { DomainKey } from "./domainLoaders";

export type DomainSyncEvent =
  | "DOMAIN_FETCH_START"
  | "DOMAIN_FETCH_SUCCESS"
  | "DOMAIN_FETCH_ERROR"
  | "DOMAIN_INVALIDATED"
  | "DOMAIN_SERVER_REPLACE"
  | "OUTBOX_PENDING"
  | "OUTBOX_FAILED"
  | "OUTBOX_ACK";

export interface DomainSyncLogPayload {
  domain?: DomainKey | string;
  domains?: DomainKey[];
  schoolCode?: string;
  generation?: number;
  count?: number;
  error?: string;
  entity?: string;
  recordId?: string;
}

function shouldLog(): boolean {
  if (typeof import.meta !== "undefined" && import.meta.env?.MODE === "production") return false;
  return true;
}

/** Instrumentation dev/test — aucune donnée personnelle ni secret. */
export function logDomainSync(event: DomainSyncEvent, payload: DomainSyncLogPayload = {}): void {
  if (!shouldLog()) return;
  const safe: DomainSyncLogPayload = { ...payload };
  if (safe.error) {
    safe.error = safe.error.slice(0, 200);
  }
  // eslint-disable-next-line no-console
  console.info(`[SYNC] ${event}`, safe);
}
