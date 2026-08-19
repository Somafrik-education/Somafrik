/**
 * Identifiants de démo — module DEV ONLY.
 * Interdit dans le graphe / bundle production (require derrière `if (__DEV__)` uniquement).
 * PIN : uniquement EXPO_PUBLIC_DEMO_PIN, sans fallback.
 */
export type DemoAccountKind = "country_admin" | "school_admin" | "prefet" | "secretary" | "teacher";

export function resolveDemoPin(): string | null {
  const pin = String(process.env.EXPO_PUBLIC_DEMO_PIN ?? "").trim();
  if (!pin) return null;
  return pin;
}

export function demoIdentifierFor(kind: DemoAccountKind): string {
  if (kind === "country_admin") return "admin-rdc";
  if (kind === "school_admin") return "admin";
  if (kind === "prefet") return "prefet";
  if (kind === "secretary") return "secretaire";
  return "ENS-0001";
}
