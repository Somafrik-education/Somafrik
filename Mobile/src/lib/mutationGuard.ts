/**
 * Verrou d'intention : un double tap < 100 ms ne crée pas deux mutations.
 * `disabled` React ne suffit pas — deux onPress peuvent partir avant le rerender.
 */
import { createIdempotencyKey } from "./networkResilience";

export function createInFlightLock() {
  let busy = false;
  return {
    tryBegin(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    end(): void {
      busy = false;
    },
    get inFlight(): boolean {
      return busy;
    },
  };
}

export function createIntentionStore() {
  const keys = new Map<string, string>();
  return {
    getOrCreate(intentionId: string): string {
      const existing = keys.get(intentionId);
      if (existing) return existing;
      const key = createIdempotencyKey();
      keys.set(intentionId, key);
      return key;
    },
    seed(intentionId: string, key: string): string {
      const existing = keys.get(intentionId);
      if (existing) return existing;
      keys.set(intentionId, key);
      return key;
    },
    peek(intentionId: string): string | undefined {
      return keys.get(intentionId);
    },
    rotate(intentionId: string): void {
      keys.delete(intentionId);
    },
  };
}
