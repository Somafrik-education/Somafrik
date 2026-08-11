import { AUTHORIZATION_DECISION } from "../../../packages/auth/src/index.js";

const HTTP_STATUS_BY_DECISION = Object.freeze(
  Object.assign(Object.create(null), {
    [AUTHORIZATION_DECISION.AUTHORIZED]: 200,
    [AUTHORIZATION_DECISION.UNAUTHENTICATED]: 401,
    [AUTHORIZATION_DECISION.FORBIDDEN]: 403,
  }),
);

export function authorizationDecisionToHttpStatus(decision) {
  try {
    if (typeof decision !== "string") {
      return 401;
    }
    if (!Object.hasOwn(HTTP_STATUS_BY_DECISION, decision)) {
      return 401;
    }
    return Reflect.get(HTTP_STATUS_BY_DECISION, decision);
  } catch {
    return 401;
  }
}
