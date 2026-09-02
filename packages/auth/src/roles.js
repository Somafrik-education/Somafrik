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

const CANONICAL_ROLE_LOOKUP = Object.freeze(
  Object.assign(Object.create(null), {
    super_admin: true,
    country_admin: true,
    school_admin: true,
    principal: true,
    prefet: true,
    secretary: true,
    accountant: true,
    teacher: true,
    parent: true,
    student: true,
  }),
);

export function isCanonicalRole(role) {
  return typeof role === "string" && Object.hasOwn(CANONICAL_ROLE_LOOKUP, role);
}
