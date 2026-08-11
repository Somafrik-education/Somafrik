import { can } from "./permissions.js";
import { createAuthSession, isAuthSessionActive } from "./session.js";

export const AUTHORIZATION_DECISION = Object.freeze({
  AUTHORIZED: "authorized",
  UNAUTHENTICATED: "unauthenticated",
  FORBIDDEN: "forbidden",
});

export function evaluateSessionAuthorization(session, permission, now) {
  try {
    if (!isAuthSessionActive(session, now)) {
      return AUTHORIZATION_DECISION.UNAUTHENTICATED;
    }

    const validated = createAuthSession(session);
    if (can(validated.principal, permission)) {
      return AUTHORIZATION_DECISION.AUTHORIZED;
    }

    return AUTHORIZATION_DECISION.FORBIDDEN;
  } catch {
    return AUTHORIZATION_DECISION.UNAUTHENTICATED;
  }
}
