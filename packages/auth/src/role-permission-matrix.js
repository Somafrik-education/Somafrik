function freezeNullProtoLookup(entries) {
  return Object.freeze(Object.assign(Object.create(null), entries));
}

function freezePermissionSet(permissions) {
  const lookup = Object.create(null);
  for (let index = 0; index < permissions.length; index += 1) {
    Reflect.set(lookup, Reflect.get(permissions, String(index)), true);
  }
  return Object.freeze(lookup);
}

const ROLE_PERMISSION_ALLOWLIST = freezeNullProtoLookup({
  super_admin: freezePermissionSet([
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
  ]),
  country_admin: freezePermissionSet([
    "countries:read",
    "countries:update",
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
  ]),
  school_admin: freezePermissionSet([
    "schools:read",
    "schools:update",
    "users:create",
    "users:read",
    "users:update",
    "users:disable",
    "roles:assign",
    "sessions:revoke",
  ]),
  principal: freezePermissionSet([
    "schools:read",
    "users:create",
    "users:read",
    "users:update",
    "users:disable",
    "roles:assign",
    "sessions:revoke",
  ]),
  secretary: freezePermissionSet([
    "schools:read",
    "users:create",
    "users:read",
    "users:update",
  ]),
  prefet: freezePermissionSet(["schools:read", "users:read"]),
  accountant: freezePermissionSet([]),
  teacher: freezePermissionSet([]),
  parent: freezePermissionSet([]),
  student: freezePermissionSet([]),
});

export function isPermissionAllowedForRole(role, permission) {
  if (typeof role !== "string" || typeof permission !== "string") {
    return false;
  }
  if (!Object.hasOwn(ROLE_PERMISSION_ALLOWLIST, role)) {
    return false;
  }
  const allowed = Reflect.get(ROLE_PERMISSION_ALLOWLIST, role);
  return Object.hasOwn(allowed, permission);
}
