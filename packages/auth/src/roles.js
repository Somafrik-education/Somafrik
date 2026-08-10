export const CANONICAL_ROLES = Object.freeze([
  "super_admin",
  "country_admin",
  "school_admin",
  "principal",
  "prefet",
  "secretary",
  "accountant",
  "teacher",
  "parent",
  "student",
]);

const CANONICAL_ROLE_SET = new Set(CANONICAL_ROLES);

export function isCanonicalRole(role) {
  return typeof role === "string" && CANONICAL_ROLE_SET.has(role);
}
