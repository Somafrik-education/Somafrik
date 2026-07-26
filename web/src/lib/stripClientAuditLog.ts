/**
 * HOTFIX-RBAC-ADMIN-01 — L'audit métier n'est jamais writable côté client.
 * Le PUT /backoffice/state doit exclure `auditLog` (produit uniquement serveur).
 */

export function stripClientAuditLogFromPutPayload<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, "auditLog"> {
  const { auditLog: _ignored, ...rest } = payload;
  return rest;
}
