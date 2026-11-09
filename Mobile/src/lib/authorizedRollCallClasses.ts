/**
 * NFC-ROLES-ACCESS-01 — classes accessibles au parcours d'appel direct.
 * Seules les métadonnées minimales de la liste d'autorisation serveur sont utilisées.
 * Ne jamais déduire une autorisation à partir des classes déjà visibles dans l'écran.
 */
export type AuthorizedRollCallClass = {
  classId: string;
  classCode: string;
  className: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseAuthorizedRollCallClasses(raw: unknown): AuthorizedRollCallClass[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { classes?: unknown }).classes)) {
    throw new Error("Liste des classes d'appel invalide.");
  }
  const classes = (raw as { classes: unknown[] }).classes;
  if (classes.length > 5000) throw new Error("Liste des classes d'appel trop volumineuse.");
  const seen = new Set<string>();
  const result: AuthorizedRollCallClass[] = [];
  for (const value of classes) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const classId = typeof row.classId === "string" ? row.classId.toLowerCase() : "";
    if (!UUID.test(classId) || seen.has(classId)) continue;
    const classCode = typeof row.classCode === "string" ? row.classCode.trim().slice(0, 48) : "";
    const className = typeof row.className === "string" ? row.className.trim().slice(0, 120) : "";
    if (!className) continue;
    seen.add(classId);
    result.push({ classId, classCode, className });
  }
  return result.sort((a, b) => a.className.localeCompare(b.className, "fr"));
}
