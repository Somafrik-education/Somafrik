import { safeLogger } from "../../services/safeLogger";

export const RC3_OUTBOX_TAG = "RC3_OUTBOX";

const ALLOWED_STATE = new Set([
  "pending",
  "in_flight",
  "blocked_authorization",
  "failed_terminal",
  "acked",
]);
const ALLOWED_OPERATION = new Set(["presence.upsert"]);
const ALLOWED_EVENT = new Set(["enqueue", "claim", "send", "retry", "reclaim", "ack"]);
const ALLOWED_CLASSIFICATION = new Set([
  "NETWORK_UNAVAILABLE",
  "TIMEOUT",
  "BACKEND_UNREACHABLE",
  "BACKEND_5XX",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "IDEMPOTENCY_KEY_REUSED",
  "BUSINESS_400",
  "HORIZON_EXPIRED",
  "PAYLOAD_TAMPERED",
  "SUCCESS",
  "IDEMPOTENT_REPLAY",
]);

function token(value: unknown, allowed: Set<string>, fallback = ""): string {
  const raw = String(value ?? "").trim();
  return allowed.has(raw) ? raw : fallback;
}

function attemptCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function logRc3Outbox(input: {
  event?: string | null;
  operationType?: string | null;
  state?: string | null;
  attemptCount?: number;
  classification?: string | null;
  retry?: boolean;
}): void {
  const operationType = token(input.operationType, ALLOWED_OPERATION);
  if (!operationType) return;
  const event = token(input.event, ALLOWED_EVENT);
  const parts = event
    ? [`${RC3_OUTBOX_TAG} ${event}`, `operationType=${operationType}`]
    : [`${RC3_OUTBOX_TAG} operationType=${operationType}`];
  const state = token(input.state, ALLOWED_STATE);
  if (state) parts.push(`state=${state}`);
  if (input.attemptCount != null) parts.push(`attemptCount=${attemptCount(input.attemptCount)}`);
  const classification = token(input.classification, ALLOWED_CLASSIFICATION);
  if (classification) parts.push(`classification=${classification}`);
  if (typeof input.retry === "boolean") parts.push(`retry=${input.retry ? "true" : "false"}`);
  safeLogger.warn(parts.join(" "));
}

export const RC3_PHYSICAL_PRESENCE_SMOKE_TAG = "RC3_PHYSICAL_PRESENCE_SMOKE";

const ALLOWED_SMOKE = new Set(["empty", "pending", "ok"]);

export function logRc3PhysicalPresenceSmoke(status: "empty" | "pending" | "ok"): void {
  const tokenStatus = token(status, ALLOWED_SMOKE);
  if (!tokenStatus) return;
  if (tokenStatus === "ok") {
    safeLogger.warn(`${RC3_PHYSICAL_PRESENCE_SMOKE_TAG} OK`);
    return;
  }
  safeLogger.warn(`${RC3_PHYSICAL_PRESENCE_SMOKE_TAG} ${tokenStatus}`);
}
