/**
 * HOTFIX-RBAC-ADMIN-01 — L'audit métier n'est jamais writable côté client.
 * Le PUT /backoffice/state doit exclure `auditLog` (produit uniquement serveur).
 */

export function stripClientAuditLogFromPutPayload<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, "auditLog"> {
  if (!Object.prototype.hasOwnProperty.call(payload, "auditLog")) {
    return payload;
  }
  const rest = { ...payload };
  delete rest.auditLog;
  return rest;
}
