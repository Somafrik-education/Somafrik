import { httpRequest } from "../../services/httpClient";
import type { OutboxTransport, OutboxTransportResult } from "./types";

function asResult(error: unknown): OutboxTransportResult {
  const status = Number(error && typeof error === "object" ? (error as { status?: number }).status : 0);
  const code = String(error && typeof error === "object" ? (error as { code?: string }).code ?? "" : "");
  if (code === "NETWORK_UNAVAILABLE" || code === "TIMEOUT" || code === "BACKEND_UNREACHABLE") {
    return { status: status || 0, code };
  }
  if (status === 401) return { status, code: code || "UNAUTHORIZED" };
  if (status === 403) return { status, code: code || "FORBIDDEN" };
  if (status === 409) return { status, code: code || "IDEMPOTENCY_KEY_REUSED" };
  if (status >= 500) return { status, code: code || "BACKEND_5XX" };
  if (status) return { status, code };
  return { status: 0, code: code || "BACKEND_UNREACHABLE" };
}

/**
 * Transport HTTP : auth lue à l'envoi (SecureStore/session), jamais depuis l'outbox.
 * Non branché aux écrans dans RC3-1.
 */
export function createHttpOutboxTransport(
  request: typeof httpRequest = httpRequest,
): OutboxTransport {
  return {
    async send(input) {
      try {
        const body = await request(input.path, {
          method: input.method,
          body: JSON.stringify(input.payload),
          idempotencyKey: input.idempotencyKey,
        });
        return { status: 201, body };
      } catch (error) {
        return asResult(error);
      }
    },
  };
}
