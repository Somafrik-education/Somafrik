import { can } from "./permissions.js";
import { createAuthSession, isAuthSessionActive } from "./session.js";

export const AUTHORIZATION_DECISION = Object.freeze({
  AUTHORIZED: "authorized",
  UNAUTHENTICATED: "unauthenticated",
  FORBIDDEN: "forbidden",
});

export function evaluateSessionAuthorization(session, permission, now) {
  try {
    const validated = createAuthSession(session);

    if (!isAuthSessionActive(validated, now)) {
      return AUTHORIZATION_DECISION.UNAUTHENTICATED;
    }

    return can(validated.principal, permission)
      ? AUTHORIZATION_DECISION.AUTHORIZED
      : AUTHORIZATION_DECISION.FORBIDDEN;
  } catch {
    return AUTHORIZATION_DECISION.UNAUTHENTICATED;
  }
}
