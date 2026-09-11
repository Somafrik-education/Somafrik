import { OUTBOX_ERROR } from "./types";

const SENSITIVE = /accessToken|refreshToken|password|authorization|bearer |l1DbKey|jwt/i;

export const OUTBOX_OPERATION_TYPES = ["presence.upsert"] as const;
export type OutboxOperationType = (typeof OUTBOX_OPERATION_TYPES)[number];

type OperationSpec = {
  method: "POST";
  path: string;
  validate(payload: unknown): void;
};

function asRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error(OUTBOX_ERROR.PAYLOAD_INVALID) as Error & { code: string };
    error.code = OUTBOX_ERROR.PAYLOAD_INVALID;
    throw error;
  }
  return payload as Record<string, unknown>;
}

function refuseSecrets(payload: unknown): void {
  const raw = JSON.stringify(payload);
  if (SENSITIVE.test(raw)) {
    const error = new Error(OUTBOX_ERROR.PAYLOAD_INVALID) as Error & { code: string };
    error.code = OUTBOX_ERROR.PAYLOAD_INVALID;
    throw error;
  }
  if (/https?:\/\//i.test(raw)) {
    const error = new Error(OUTBOX_ERROR.PAYLOAD_INVALID) as Error & { code: string };
    error.code = OUTBOX_ERROR.PAYLOAD_INVALID;
    throw error;
  }
}

const PRESENCE_UPSERT: OperationSpec = {
  method: "POST",
  path: "/presences",
  validate(payload) {
    refuseSecrets(payload);
    const body = asRecord(payload);
    const items = body.items;
    if (items !== undefined && !Array.isArray(items)) {
      const error = new Error(OUTBOX_ERROR.PAYLOAD_INVALID) as Error & { code: string };
      error.code = OUTBOX_ERROR.PAYLOAD_INVALID;
      throw error;
    }
  },
};

const REGISTRY: Record<OutboxOperationType, OperationSpec> = {
  "presence.upsert": PRESENCE_UPSERT,
};

export function resolveOutboxOperation(operationType: string): OperationSpec {
  const spec = (REGISTRY as Record<string, OperationSpec | undefined>)[operationType];
  if (!spec) {
    const error = new Error(OUTBOX_ERROR.UNKNOWN_OPERATION) as Error & { code: string };
    error.code = OUTBOX_ERROR.UNKNOWN_OPERATION;
    throw error;
  }
  return spec;
}

export function isOutboxOperationType(value: string): value is OutboxOperationType {
  return (OUTBOX_OPERATION_TYPES as readonly string[]).includes(value);
}
