const AUTH_PERMISSION_CATALOG_LIST = Object.freeze([
  "platform:manage",
  "countries:create",
  "countries:read",
  "countries:update",
  "countries:disable",
  "schools:create",
  "schools:read",
  "schools:update",
  "schools:disable",
  "users:create",
  "users:read",
  "users:update",
  "users:disable",
  "roles:assign",
  "sessions:revoke",
]);

const AUTH_PERMISSION_LOOKUP = Object.freeze(
  Object.assign(Object.create(null), {
    "platform:manage": true,
    "countries:create": true,
    "countries:read": true,
    "countries:update": true,
    "countries:disable": true,
    "schools:create": true,
    "schools:read": true,
    "schools:update": true,
    "schools:disable": true,
    "users:create": true,
    "users:read": true,
    "users:update": true,
    "users:disable": true,
    "roles:assign": true,
    "sessions:revoke": true,
  }),
);

export const AUTH_PERMISSION_CATALOG = AUTH_PERMISSION_CATALOG_LIST;

export function isCataloguedAuthPermission(permission) {
  return typeof permission === "string" && Object.hasOwn(AUTH_PERMISSION_LOOKUP, permission);
}
