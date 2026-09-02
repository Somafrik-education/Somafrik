import { isCataloguedAuthPermission } from "./permission-catalog.js";
import { isCanonicalPermissionToken } from "./permission-token.js";
import { createAuthPrincipal } from "./principal.js";
import { isPermissionAllowedForRole } from "./role-permission-matrix.js";

function listContainsExactPermission(permissions, permission) {
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(permissions, "length");
  const length = lengthDescriptor ? lengthDescriptor.value : 0;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
    return false;
  }

  for (let index = 0; index < length; index += 1) {
    if (Reflect.get(permissions, String(index)) === permission) {
      return true;
    }
  }

  return false;
}

export function can(principal, permission) {
  if (!isCanonicalPermissionToken(permission)) {
    return false;
  }
  if (!isCataloguedAuthPermission(permission)) {
    return false;
  }

  try {
    const validated = createAuthPrincipal(principal);
    if (!isPermissionAllowedForRole(validated.role, permission)) {
      return false;
    }
    return listContainsExactPermission(validated.permissions, permission);
  } catch {
    return false;
  }
}
