/**
 * Scope Communications request-scoped — établissement actif de l'application.
 * Jamais "*" ni une valeur saisie dans le composer.
 */

export function resolveCommunicationSchoolScope(activeSchoolCode?: string | null): string {
  const code = String(activeSchoolCode ?? "").trim();
  if (!code || code === "*") return "";
  return code;
}

export function hasCommunicationSchoolScope(activeSchoolCode?: string | null): boolean {
  return Boolean(resolveCommunicationSchoolScope(activeSchoolCode));
}

export function withCommunicationSchoolScope(path: string, effectiveSchoolCode?: string | null): string {
  const scope = resolveCommunicationSchoolScope(effectiveSchoolCode);
  if (!scope) return path;
  const hashIndex = path.indexOf("#");
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const qIndex = withoutHash.indexOf("?");
  const base = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
  const existing = qIndex >= 0 ? withoutHash.slice(qIndex + 1) : "";
  const params = new URLSearchParams(existing);
  params.set("effectiveSchoolCode", scope);
  return `${base}?${params.toString()}${hash}`;
}

export function withCommunicationSchoolPayload<T extends Record<string, unknown>>(
  payload: T,
  effectiveSchoolCode?: string | null,
): T & { effectiveSchoolCode?: string } {
  const scope = resolveCommunicationSchoolScope(effectiveSchoolCode);
  if (!scope) return payload;
  return { ...payload, effectiveSchoolCode: scope };
}
