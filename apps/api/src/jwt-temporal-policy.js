const MAX_TOKEN_LIFETIME_SECONDS = 900;
const CLOCK_SKEW_SECONDS = 30;

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isSafeNonNegativeUnixSeconds(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Future-bound check without computing evaluationTime + skew
 * (avoids silent overflow near Number.MAX_SAFE_INTEGER).
 *
 * @param {number} candidate
 * @param {number} evaluationTime
 * @returns {boolean}
 */
function isWithinFutureSkew(candidate, evaluationTime) {
  if (candidate <= evaluationTime) {
    return true;
  }
  return candidate - evaluationTime <= CLOCK_SKEW_SECONDS;
}

/**
 * Exclusive expiry bound without computing a negative or overflowing threshold
 * when evaluationTime < skew.
 *
 * @param {number} exp
 * @param {number} evaluationTime
 * @returns {boolean}
 */
function isWithinExclusiveExpirySkew(exp, evaluationTime) {
  if (evaluationTime < CLOCK_SKEW_SECONDS) {
    return true;
  }
  return exp > evaluationTime - CLOCK_SKEW_SECONDS;
}

/**
 * Pure temporal policy check for JWT access tokens (V2.1m / V2.1n).
 *
 * Returns true only for TEMPORALLY_VALID. Never authorizes access, never
 * decodes/verifies JWT material, and never consults the system clock.
 *
 * @param {unknown} iat
 * @param {unknown} nbf
 * @param {unknown} exp
 * @param {unknown} evaluationTime
 * @returns {boolean}
 */
export function isJwtTemporalPolicySatisfied(iat, nbf, exp, evaluationTime) {
  try {
    if (
      !isSafeNonNegativeUnixSeconds(iat) ||
      !isSafeNonNegativeUnixSeconds(nbf) ||
      !isSafeNonNegativeUnixSeconds(exp) ||
      !isSafeNonNegativeUnixSeconds(evaluationTime)
    ) {
      return false;
    }

    if (iat > nbf) {
      return false;
    }
    if (nbf >= exp) {
      return false;
    }

    const lifetimeSeconds = exp - iat;
    if (lifetimeSeconds <= 0 || lifetimeSeconds > MAX_TOKEN_LIFETIME_SECONDS) {
      return false;
    }

    if (!isWithinFutureSkew(iat, evaluationTime)) {
      return false;
    }
    if (!isWithinFutureSkew(nbf, evaluationTime)) {
      return false;
    }
    if (!isWithinExclusiveExpirySkew(exp, evaluationTime)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
