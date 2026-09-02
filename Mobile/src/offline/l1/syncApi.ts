import { L1_ERROR, L1_RESOURCES, type L1Api, type L1Item, type L1Page, type L1Resource } from "./types";

export const L1_HTTP_PATH: Record<L1Resource, string> = {
  classes: "/mobile-sync/l1/classes",
  students: "/mobile-sync/l1/students",
  assignments: "/mobile-sync/l1/assignments",
  "school-courses": "/mobile-sync/l1/school-courses",
  "course-schedules": "/mobile-sync/l1/course-schedules",
};

const MODES = new Set(["full", "delta", "full_required", "unavailable"]);

export class L1PayloadError extends Error {
  code = L1_ERROR.PAYLOAD_INVALID;
  constructor(message = "Payload L1 invalide.") {
    super(message);
    this.name = "L1PayloadError";
  }
}

function asTrimmed(value: unknown): string {
  return String(value ?? "").trim();
}

export function validateL1Page(payload: unknown, expectedResource: L1Resource): L1Page {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new L1PayloadError("Réponse L1 absente.");
  }
  const row = payload as Record<string, unknown>;
  const resource = asTrimmed(row.resource);
  if (resource !== expectedResource || !L1_RESOURCES.includes(resource as L1Resource)) {
    throw new L1PayloadError("resource L1 invalide.");
  }
  const mode = asTrimmed(row.mode);
  if (!MODES.has(mode)) {
    throw new L1PayloadError("mode L1 invalide.");
  }
  const cursorStatus = asTrimmed(row.cursorStatus);
  if (!cursorStatus) {
    throw new L1PayloadError("cursorStatus L1 invalide.");
  }
  const scopeHash = asTrimmed(row.scopeHash);
  if (!scopeHash) {
    throw new L1PayloadError("scopeHash L1 obligatoire.");
  }
  if (!Array.isArray(row.items)) {
    throw new L1PayloadError("items L1 invalide.");
  }
  const items: L1Item[] = [];
  for (const item of row.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new L1PayloadError("item L1 invalide.");
    }
    const id = asTrimmed((item as { id?: unknown }).id);
    if (!id) throw new L1PayloadError("item.id L1 obligatoire.");
    items.push({ ...(item as Record<string, unknown>), id } as L1Item);
  }
  const nextCursor = asTrimmed(row.nextCursor);
  if (typeof row.hasMore !== "boolean") {
    throw new L1PayloadError("hasMore L1 invalide.");
  }
  if (row.hasMore && !nextCursor) {
    throw new L1PayloadError("nextCursor obligatoire lorsque hasMore=true.");
  }
  return {
    resource: resource as L1Resource,
    mode: mode as L1Page["mode"],
    cursorStatus,
    scopeHash,
    items,
    nextCursor,
    hasMore: row.hasMore,
  };
}

export function createL1Api(request: <T = unknown>(path: string) => Promise<T>): L1Api {
  return {
    async fetchPage(resource, cursor) {
      const path = cursor
        ? `${L1_HTTP_PATH[resource]}?cursor=${encodeURIComponent(cursor)}`
        : L1_HTTP_PATH[resource];
      const payload = await request<unknown>(path);
      return validateL1Page(payload, resource);
    },
  };
}
