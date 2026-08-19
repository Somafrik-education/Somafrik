/**
 * Identifiants de démo — importés uniquement par DemoLoginButtons,
 * jamais par le chemin Login de production.
 */
export const DEMO_PIN = "1234";

export type DemoAccountKind = "country_admin" | "school_admin" | "prefet" | "secretary" | "teacher";

export function demoIdentifierFor(kind: DemoAccountKind): string {
  if (kind === "country_admin") return "admin-rdc";
  if (kind === "school_admin") return "admin";
  if (kind === "prefet") return "prefet";
  if (kind === "secretary") return "secretaire";
  return "ENS-0001";
}
