/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 1 + LOT 7 — erreur de rendu d'écran explicite.
 *
 * Sans frontière d'erreur, une exception de rendu dans un seul écran démonte tout l'arbre
 * React : l'utilisateur voit un écran blanc et aucune information n'est récupérable sans ADB.
 * Ces fonctions préparent un affichage explicite et sobre : nature de l'erreur, écran, build.
 * Aucune donnée personnelle : e-mails et suites de chiffres sont masqués, longueur bornée.
 */

export const SCREEN_ERROR_COPY = {
  title: "Cet écran n'a pas pu s'afficher",
  body: "Une erreur est survenue pendant l'affichage. Vous pouvez réessayer ou revenir en arrière. Si le problème persiste, communiquez les informations ci-dessous au support.",
  retry: "Réessayer",
  back: "Retour",
} as const;

const MAX_MESSAGE_LENGTH = 160;

export function sanitizeErrorMessage(raw: unknown): string {
  const text = String(raw ?? "")
    .split("\n")[0]
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[e-mail]")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, "[numéro]")
    .trim();
  if (!text) return "Erreur inconnue";
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
}

export function describeScreenError(error: unknown, routeName?: string | null): { kind: string; message: string; route: string } {
  const err = error as { name?: unknown; message?: unknown } | null | undefined;
  const kind = String(err?.name ?? "").trim() || "Error";
  return {
    kind,
    message: sanitizeErrorMessage(err?.message ?? error),
    route: String(routeName ?? "").trim() || "inconnu",
  };
}
