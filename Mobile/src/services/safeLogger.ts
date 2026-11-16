/**
 * S2.3 — Journalisation sanitisée (jamais de JWT / headers / secrets).
 */

const SENSITIVE_KEY = /(authorization|access[_-]?token|refresh[_-]?token|card[_-]?token|token[_-]?hash|capability|password|passwd|secret|apikey|api[_-]?key|client[_-]?secret|bearer|cookie|set-cookie|expo[_-]?push[_-]?token)/i;
const JWT_LIKE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const EXPO_PUSH_TOKEN = /Expo(nent)?PushToken\[[^\]]+\]/gi;
// Canonical NFC capability: 16-byte public ID and 32-byte secret, base64url.
const NFC_CAPABILITY = /(?:somafrik:card:)?[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g;
const HAS_NFC_CAPABILITY = /(?:somafrik:card:)?[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/;

function redactText(value: string): string {
  return value.replace(JWT_LIKE, "[REDACTED_JWT]")
    .replace(EXPO_PUSH_TOKEN, "[REDACTED_PUSH_TOKEN]")
    .replace(NFC_CAPABILITY, "[REDACTED_NFC_CAPABILITY]");
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[…]";
  if (value == null) return value;
  if (typeof value === "string") {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(item, depth + 1);
    }
    return out;
  }
  return value;
}

function toSafeArgs(args: unknown[]) {
  return args.map((arg) => {
    if (typeof arg === "string") return redactText(arg);
    if (arg instanceof Error) {
      return {
        name: arg.name,
        message: redactText(String(arg.message ?? "")),
      };
    }
    try {
      return redactValue(arg);
    } catch {
      return "[unserializable]";
    }
  });
}

const isProdRuntime =
  typeof __DEV__ !== "undefined" ? !__DEV__ : process.env.NODE_ENV === "production";

export const safeLogger = {
  debug(...args: unknown[]) {
    if (isProdRuntime) return;
    // eslint-disable-next-line no-console
    console.log(...toSafeArgs(args));
  },
  info(...args: unknown[]) {
    if (isProdRuntime) return;
    // eslint-disable-next-line no-console
    console.log(...toSafeArgs(args));
  },
  warn(...args: unknown[]) {
    // eslint-disable-next-line no-console
    console.warn(...toSafeArgs(args));
  },
  error(...args: unknown[]) {
    // eslint-disable-next-line no-console
    console.error(...toSafeArgs(args));
  },
};

export function sanitizeUserFacingError(error: unknown, fallback = "Une erreur est survenue. Réessayez."): string {
  if (!error) return fallback;
  const message = error instanceof Error ? error.message : String(error);
  if (/axios|stack|typeerror|fetch failed|network request failed|econnrefused|etimedout/i.test(message)) {
    return fallback;
  }
  if (HAS_NFC_CAPABILITY.test(message) || JWT_LIKE.test(message) || /bearer\s+\S+/i.test(message)) {
    return fallback;
  }
  // Messages métier courts déjà propres
  if (message.length > 0 && message.length <= 180 && !/at\s+\S+\s+\(/.test(message)) {
    return message;
  }
  return fallback;
}
