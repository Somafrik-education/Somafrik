import { createAuthPrincipal } from "./principal.js";

function isExactPermissionToken(permission) {
  return typeof permission === "string" && permission.trim() !== "";
}

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
  if (!isExactPermissionToken(permission)) {
    return false;
  }

  try {
    const validated = createAuthPrincipal(principal);
    return listContainsExactPermission(validated.permissions, permission);
  } catch {
    return false;
  }
}
