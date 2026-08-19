/**
 * File d'intentions de mutation allowlistée.
 * PostgreSQL reste la source de vérité — ceci n'est pas une réplique locale.
 */
import { classifyMutationFailure, executeMutation } from "./networkResilience";

export const OUTBOX_ALLOWED_DOMAINS = ["messages", "presences", "notes", "payments"] as const;
export type OutboxDomain = (typeof OUTBOX_ALLOWED_DOMAINS)[number];

export type OutboxStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "blocked_scope_mismatch"
  | "blocked_logout";

export type OutboxEntry = {
  id: string;
  idempotencyKey: string;
  domain: OutboxDomain;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  payload: unknown;
  createdAt: string;
  attemptCount: number;
  status: OutboxStatus;
  lastError: string | null;
  userId: string;
  schoolScope: string;
};

export type OutboxSession = {
  userId: string;
  schoolScope: string;
};

export type OutboxStorage = {
  read(): Promise<OutboxEntry[]>;
  write(entries: OutboxEntry[]): Promise<void>;
};

const SENSITIVE_KEY = /accessToken|refreshToken|password|pin|secret|authorization/i;
const OUTBOX_FILE = "somafrik-mutation-outbox.json";

const memoryStore: { entries: OutboxEntry[] } = { entries: [] };

const memoryStorage: OutboxStorage = {
  async read() {
    return memoryStore.entries.map((entry) => ({ ...entry }));
  },
  async write(entries) {
    memoryStore.entries = entries.map((entry) => ({ ...entry }));
  },
};

const fileStorage: OutboxStorage = {
  async read() {
    try {
      const FileSystem = require("expo-file-system/legacy") as typeof import("expo-file-system/legacy");
      const directory = FileSystem.documentDirectory;
      if (!directory) return memoryStorage.read();
      const path = `${directory}${OUTBOX_FILE}`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return [];
      const raw = await FileSystem.readAsStringAsync(path);
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
    } catch {
      return memoryStorage.read();
    }
  },
  async write(entries) {
    try {
      const FileSystem = require("expo-file-system/legacy") as typeof import("expo-file-system/legacy");
      const directory = FileSystem.documentDirectory;
      if (!directory) return memoryStorage.write(entries);
      const path = `${directory}${OUTBOX_FILE}`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(entries));
    } catch {
      await memoryStorage.write(entries);
    }
  },
};

let storage: OutboxStorage = fileStorage;

export function setOutboxStorageForTests(next: OutboxStorage | null) {
  storage = next ?? memoryStorage;
  if (!next) memoryStore.entries = [];
}

export function isOutboxDomain(value: string): value is OutboxDomain {
  return (OUTBOX_ALLOWED_DOMAINS as readonly string[]).includes(value);
}

export function freezePayload(payload: unknown): unknown {
  return JSON.parse(JSON.stringify(payload ?? null));
}

function assertNoSecrets(payload: unknown, path = "payload") {
  if (!payload || typeof payload !== "object") return;
  if (Array.isArray(payload)) {
    payload.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error(`OUTBOX_SECRET_FORBIDDEN:${path}.${key}`);
    }
    assertNoSecrets(value, `${path}.${key}`);
  }
}

async function loadEntries(): Promise<OutboxEntry[]> {
  try {
    return await storage.read();
  } catch {
    return [];
  }
}

async function saveEntries(entries: OutboxEntry[]): Promise<void> {
  await storage.write(entries);
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  return loadEntries();
}

export async function countPendingOutbox(session?: OutboxSession): Promise<number> {
  const entries = await loadEntries();
  return entries.filter((entry) => {
    if (entry.status !== "pending" && entry.status !== "sending") return false;
    if (!session) return true;
    return entry.userId === session.userId && entry.schoolScope === session.schoolScope;
  }).length;
}

export async function enqueueOutbox(input: {
  idempotencyKey: string;
  domain: OutboxDomain;
  method: OutboxEntry["method"];
  path: string;
  payload: unknown;
  userId: string;
  schoolScope: string;
}): Promise<OutboxEntry> {
  if (!isOutboxDomain(input.domain)) {
    throw new Error("OUTBOX_DOMAIN_FORBIDDEN");
  }
  const payload = freezePayload(input.payload);
  assertNoSecrets(payload);
  const entries = await loadEntries();
  const existing = entries.find((entry) => entry.idempotencyKey === input.idempotencyKey);
  if (existing) return existing;
  const entry: OutboxEntry = {
    id: input.idempotencyKey,
    idempotencyKey: input.idempotencyKey,
    domain: input.domain,
    method: input.method,
    path: input.path,
    payload,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    status: "pending",
    lastError: null,
    userId: String(input.userId ?? "").trim(),
    schoolScope: String(input.schoolScope ?? "").trim().toUpperCase(),
  };
  entries.push(entry);
  await saveEntries(entries);
  return entry;
}

export async function patchOutbox(idempotencyKey: string, patch: Partial<OutboxEntry>): Promise<void> {
  const entries = await loadEntries();
  const next = entries.map((entry) =>
    entry.idempotencyKey === idempotencyKey ? { ...entry, ...patch, payload: entry.payload } : entry,
  );
  await saveEntries(next);
}

export async function blockOutboxOnLogout(): Promise<void> {
  const entries = await loadEntries();
  await saveEntries(
    entries.map((entry) =>
      entry.status === "pending" || entry.status === "sending"
        ? { ...entry, status: "blocked_logout" as const, lastError: "session_ended" }
        : entry,
    ),
  );
}

export async function bindOutboxToSession(session: OutboxSession): Promise<void> {
  const userId = String(session.userId ?? "").trim();
  const schoolScope = String(session.schoolScope ?? "").trim().toUpperCase();
  const entries = await loadEntries();
  await saveEntries(
    entries.map((entry) => {
      if (entry.status === "sent") return entry;
      if (entry.userId !== userId || entry.schoolScope !== schoolScope) {
        return { ...entry, status: "blocked_scope_mismatch" as const, lastError: "blocked_scope_mismatch" };
      }
      if (entry.status === "blocked_logout") {
        return { ...entry, status: "pending" as const, lastError: null };
      }
      return entry;
    }),
  );
}

export type ProtectedMutationOutcome<T> =
  | { outcome: "confirmed"; result: T }
  | { outcome: "queued"; error: unknown }
  | { outcome: "failed"; error: unknown };

export async function submitProtectedMutation<T>(input: {
  domain: OutboxDomain;
  method: OutboxEntry["method"];
  path: string;
  payload: unknown;
  idempotencyKey: string;
  userId: string;
  schoolScope: string;
  request: () => Promise<T>;
  persistOutbox: boolean;
}): Promise<ProtectedMutationOutcome<T>> {
  let queued = false;
  if (input.persistOutbox) {
    await enqueueOutbox({
      idempotencyKey: input.idempotencyKey,
      domain: input.domain,
      method: input.method,
      path: input.path,
      payload: input.payload,
      userId: input.userId,
      schoolScope: input.schoolScope,
    });
    queued = true;
  }
  try {
    const result = await executeMutation({ request: input.request });
    if (queued) {
      await patchOutbox(input.idempotencyKey, { status: "sent", lastError: null });
    }
    return { outcome: "confirmed", result };
  } catch (error) {
    const kind = classifyMutationFailure(error);
    const message = error instanceof Error ? error.message : String(error ?? "échec");
    if (queued && (kind === "retryable" || kind === "unknown" || kind === "auth_required")) {
      await patchOutbox(input.idempotencyKey, { status: "pending", lastError: message });
      return { outcome: "queued", error };
    }
    if (queued) {
      await patchOutbox(input.idempotencyKey, { status: "failed", lastError: message });
    }
    return { outcome: "failed", error };
  }
}

export async function processOutbox(
  session: OutboxSession,
  dispatch: (entry: OutboxEntry) => Promise<unknown>,
): Promise<{ sent: number; blocked: number; failed: number }> {
  const userId = String(session.userId ?? "").trim();
  const schoolScope = String(session.schoolScope ?? "").trim().toUpperCase();
  const entries = await loadEntries();
  let sent = 0;
  let blocked = 0;
  let failed = 0;

  for (const entry of entries) {
    if (entry.status === "sent" || entry.status === "failed") continue;
    if (entry.status === "blocked_scope_mismatch" || entry.status === "blocked_logout") {
      blocked += 1;
      continue;
    }
    if (entry.userId !== userId || entry.schoolScope !== schoolScope) {
      await patchOutbox(entry.idempotencyKey, {
        status: "blocked_scope_mismatch",
        lastError: "blocked_scope_mismatch",
      });
      blocked += 1;
      continue;
    }
    if (!isOutboxDomain(entry.domain)) {
      await patchOutbox(entry.idempotencyKey, { status: "failed", lastError: "OUTBOX_DOMAIN_FORBIDDEN" });
      failed += 1;
      continue;
    }
    await patchOutbox(entry.idempotencyKey, { status: "sending", attemptCount: entry.attemptCount + 1 });
    try {
      await dispatch(entry);
      await patchOutbox(entry.idempotencyKey, { status: "sent", lastError: null });
      sent += 1;
    } catch (error) {
      const kind = classifyMutationFailure(error);
      const message = error instanceof Error ? error.message : String(error ?? "échec");
      if (kind === "auth_required") {
        await patchOutbox(entry.idempotencyKey, { status: "pending", lastError: message });
        break;
      }
      if (kind === "retryable" && entry.attemptCount + 1 < 3) {
        await patchOutbox(entry.idempotencyKey, { status: "pending", lastError: message });
      } else if (kind === "retryable" || kind === "unknown") {
        await patchOutbox(entry.idempotencyKey, { status: "pending", lastError: message });
      } else {
        await patchOutbox(entry.idempotencyKey, { status: "failed", lastError: message });
        failed += 1;
      }
    }
  }

  return { sent, blocked, failed };
}
