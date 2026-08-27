function stableSerialize(value: unknown): string {
  if (value == null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function serializeOutboxPayload(payload: unknown): string {
  return JSON.stringify(payload);
}

export async function hashOutboxPayload(payload: unknown): Promise<string> {
  const serialized = stableSerialize(payload);
  try {
    const crypto = require("crypto") as { createHash?: (alg: string) => { update: (s: string) => { digest: (enc: string) => string } } };
    if (typeof crypto.createHash === "function") {
      return crypto.createHash("sha256").update(serialized).digest("hex");
    }
  } catch {
    // React Native : expo-crypto
  }
  const Crypto = require("expo-crypto") as {
    CryptoDigestAlgorithm: { SHA256: string };
    digestStringAsync: (alg: string, value: string) => Promise<string>;
  };
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, serialized);
}

export function parsePayloadJson(payloadJson: string): unknown {
  return JSON.parse(payloadJson) as unknown;
}
