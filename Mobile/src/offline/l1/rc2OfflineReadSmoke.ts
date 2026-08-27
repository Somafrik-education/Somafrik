/**
 * Instrumentation RC2 Offline Read Smoke — marqueurs logcat non sensibles.
 *
 * Une ligne = tokens whitelistés + un entier `rows`.
 * Aucun secret, aucune identité nominative, aucun identifiant de session.
 */
import { safeLogger } from "../../services/safeLogger";
import type { ResourceSnapshot } from "../../lib/dataTruth";
import { L1_RESOURCES, type L1Resource } from "./types";

export const RC2_L1_READ_TAG = "RC2_L1_READ";
export const RC2_L1_SYNC_TAG = "RC2_L1_SYNC";
export const RC2_L1_SYNC_START_TAG = "RC2_L1_SYNC_START";
export const RC2_L1_PAGE_TAG = "RC2_L1_PAGE";
export const RC2_L1_STAGE_TAG = "RC2_L1_STAGE";
export const RC2_L1_SYNC_EXCEPTION_TAG = "RC2_L1_SYNC_EXCEPTION";
export const RC2_L1_REFUSAL_TAG = "RC2_L1_REFUSAL";
export const RC2_OFFLINE_BOOT_TAG = "RC2_OFFLINE_BOOT";
export const RC2_OFFLINE_READ_SMOKE_TAG = "RC2_OFFLINE_READ_SMOKE";

export const RC2_L1_RESOURCES = L1_RESOURCES;

const ALLOWED_SOURCE = new Set(["l1-cache", "network", "none"]);
const ALLOWED_STATUS = new Set(["success", "empty", "offline", "error", "idle", "loading"]);
const ALLOWED_BOOT_STATUS = new Set(["partition_unresolved", "sqlcipher_unavailable"]);
const ALLOWED_SYNC_OUTCOME = new Set([
  "ready",
  "blocked_authorization",
  "discarded",
  "network_preserved",
  "error",
]);
const ALLOWED_SYNC_CODE = new Set([
  "UNAUTHORIZED",
  "PERMISSION_DENIED",
  "FORBIDDEN",
  "MOBILE_SYNC_SCOPE_CHANGED",
  "MOBILE_SYNC_CURSOR_EXPIRED",
  "MOBILE_SYNC_CURSOR_INVALID",
  "L1_CURSOR_INVALID_LOOP",
  "L1_SCOPE_HASH_MISMATCH",
  "L1_PAYLOAD_INVALID",
  "NETWORK_UNAVAILABLE",
  "TIMEOUT",
  "BACKEND_5XX",
  "SYNC_ERROR",
  "L1_PAGE_LIMIT",
]);
const ALLOWED_REFUSAL = new Set([
  "empty",
  "reconciling",
  "blocked_authorization",
  "metadata_absent",
  "partition_mismatch",
  "sqlcipher_unavailable",
  "partition_unresolved",
]);
const ALLOWED_PAGE_MODE = new Set(["full", "delta", "full_required", "unavailable"]);
const ALLOWED_HAS_MORE = new Set(["true", "false"]);
const ALLOWED_EXCEPTION_REASON = new Set(["unexpected"]);
const ALLOWED_EXCEPTION_STAGE = new Set(["meta", "reconcile", "fetch", "apply"]);
const ALLOWED_STAGE = new Set([
  "meta_start",
  "meta_ok",
  "reconcile_start",
  "reconcile_ok",
  "fetch_start",
  "apply_start",
  "apply_ok",
]);

export type Rc2SmokeLogger = { warn: (message: string) => void };

type SeenHit = { source: string; status: string; rows: number };

let emitWarn: Rc2SmokeLogger["warn"] = (message) => {
  safeLogger.warn(message);
};
let bootReady = false;
let smokeOkEmitted = false;
const seen = new Map<L1Resource, SeenHit>();

function token(value: unknown, allowed: Set<string>, fallback: string): string {
  const raw = String(value ?? "").trim();
  return allowed.has(raw) ? raw : fallback;
}

function rowCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function asL1Resource(value: unknown): L1Resource | null {
  const raw = String(value ?? "");
  return (RC2_L1_RESOURCES as readonly string[]).includes(raw) ? (raw as L1Resource) : null;
}

function emit(line: string): void {
  emitWarn(line);
}

function maybeEmitOk(): void {
  if (smokeOkEmitted || !bootReady) return;
  for (const resource of RC2_L1_RESOURCES) {
    const hit = seen.get(resource);
    if (!hit) return;
    if (hit.source !== "l1-cache") return;
    if (hit.status !== "success" && hit.status !== "empty") return;
  }
  smokeOkEmitted = true;
  emit(`${RC2_OFFLINE_READ_SMOKE_TAG} OK`);
}

export function resetRc2OfflineReadSmokeForTests(deps?: { logger?: Rc2SmokeLogger }): void {
  bootReady = false;
  smokeOkEmitted = false;
  seen.clear();
  emitWarn = deps?.logger?.warn ?? ((message) => safeLogger.warn(message));
}

export function logRc2OfflineBoot(input: {
  permissions?: string | null;
  status?: string;
}): void {
  if (input.permissions !== "ready_offline") return;
  const status = String(input.status ?? "").trim();
  if (status && ALLOWED_BOOT_STATUS.has(status)) {
    emit(`${RC2_OFFLINE_BOOT_TAG} permissions=ready_offline status=${status}`);
    return;
  }
  emit(`${RC2_OFFLINE_BOOT_TAG} permissions=ready_offline`);
  bootReady = true;
  maybeEmitOk();
}

export function logRc2L1Read(input: {
  resource: L1Resource | string;
  source?: string | null;
  status?: string | null;
  rows?: number;
}): void {
  const resource = asL1Resource(input.resource);
  if (!resource) return;
  const source = token(input.source ?? "none", ALLOWED_SOURCE, "none");
  const status = token(input.status, ALLOWED_STATUS, "offline");
  const rows = rowCount(input.rows);
  emit(`${RC2_L1_READ_TAG} resource=${resource} source=${source} status=${status} rows=${rows}`);
  seen.set(resource, { source, status, rows });
  maybeEmitOk();
}

export function logRc2L1ReadFromSnapshot(
  resource: L1Resource,
  snapshot: Pick<ResourceSnapshot<unknown>, "source" | "status" | "data">,
): void {
  logRc2L1Read({
    resource,
    source: snapshot.source ?? "none",
    status: snapshot.status,
    rows: Array.isArray(snapshot.data) ? snapshot.data.length : 0,
  });
}

export function logRc2L1Sync(input: {
  resource: L1Resource | string;
  outcome?: string | null;
  code?: string | null;
}): void {
  const resource = asL1Resource(input.resource);
  if (!resource) return;
  const outcome = token(input.outcome, ALLOWED_SYNC_OUTCOME, "");
  if (!outcome) return;
  const code = token(input.code, ALLOWED_SYNC_CODE, "");
  if (code) {
    emit(`${RC2_L1_SYNC_TAG} resource=${resource} outcome=${outcome} code=${code}`);
    return;
  }
  emit(`${RC2_L1_SYNC_TAG} resource=${resource} outcome=${outcome}`);
}

export function logRc2L1SyncResults(
  results: readonly { resource: string; outcome: string; code?: string }[],
): void {
  for (const row of results) {
    logRc2L1Sync(row);
  }
}

export function logRc2L1SyncStart(input: { resource: L1Resource | string }): void {
  const resource = asL1Resource(input.resource);
  if (!resource) return;
  emit(`${RC2_L1_SYNC_START_TAG} resource=${resource}`);
}

export function logRc2L1Page(input: {
  resource: L1Resource | string;
  mode?: string | null;
  hasMore?: boolean | string | null;
  page?: number;
}): void {
  const resource = asL1Resource(input.resource);
  if (!resource) return;
  const mode = token(input.mode, ALLOWED_PAGE_MODE, "");
  if (!mode) return;
  const hasMoreRaw =
    typeof input.hasMore === "boolean" ? (input.hasMore ? "true" : "false") : String(input.hasMore ?? "");
  const hasMore = token(hasMoreRaw, ALLOWED_HAS_MORE, "");
  if (!hasMore) return;
  const page = rowCount(input.page);
  emit(`${RC2_L1_PAGE_TAG} resource=${resource} mode=${mode} hasMore=${hasMore} page=${page}`);
}

export function logRc2L1Stage(input: {
  resource: L1Resource | string;
  stage?: string | null;
}): void {
  const resource = asL1Resource(input.resource);
  if (!resource) return;
  const stage = token(input.stage, ALLOWED_STAGE, "");
  if (!stage) return;
  emit(`${RC2_L1_STAGE_TAG} resource=${resource} stage=${stage}`);
}

export function logRc2L1SyncException(input: {
  resource: L1Resource | string;
  reason?: string | null;
  stage?: string | null;
}): void {
  const resource = asL1Resource(input.resource);
  if (!resource) return;
  const reason = token(input.reason, ALLOWED_EXCEPTION_REASON, "unexpected");
  const stage = token(input.stage, ALLOWED_EXCEPTION_STAGE, "");
  if (stage) {
    emit(`${RC2_L1_SYNC_EXCEPTION_TAG} resource=${resource} stage=${stage} reason=${reason}`);
    return;
  }
  emit(`${RC2_L1_SYNC_EXCEPTION_TAG} resource=${resource} reason=${reason}`);
}

export function logRc2L1Refusal(input: {
  resource: L1Resource | string;
  reason?: string | null;
}): void {
  const resource = asL1Resource(input.resource);
  if (!resource) return;
  const reason = token(input.reason, ALLOWED_REFUSAL, "");
  if (!reason) return;
  emit(`${RC2_L1_REFUSAL_TAG} resource=${resource} reason=${reason}`);
}
