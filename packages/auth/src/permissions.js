import { createAuthPrincipal } from "./principal.js";

function isExactPermissionToken(permission) {
  return typeof permission === "string" && permission.trim() !== "";
}

export function can(principal, permission) {
  if (!isExactPermissionToken(permission)) {
    return false;
  }

  try {
    const validated = createAuthPrincipal(principal);
    return validated.permissions.includes(permission);
  } catch {
    return false;
  }
}
