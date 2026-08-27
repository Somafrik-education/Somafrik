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
export const RC2_OFFLINE_BOOT_TAG = "RC2_OFFLINE_BOOT";
export const RC2_OFFLINE_READ_SMOKE_TAG = "RC2_OFFLINE_READ_SMOKE";

export const RC2_L1_RESOURCES = L1_RESOURCES;

const ALLOWED_SOURCE = new Set(["l1-cache", "network", "none"]);
const ALLOWED_STATUS = new Set(["success", "empty", "offline", "error", "idle", "loading"]);
const ALLOWED_BOOT_STATUS = new Set(["partition_unresolved", "sqlcipher_unavailable"]);

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
