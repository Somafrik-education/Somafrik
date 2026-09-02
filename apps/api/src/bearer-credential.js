const BEARER_SCHEME = "Bearer";
const BEARER_SCHEME_LENGTH = 6;
const MAX_CREDENTIAL_LENGTH = 4096;

function isAsciiLetter(codeUnit) {
  return (
    (codeUnit >= 65 && codeUnit <= 90) ||
    (codeUnit >= 97 && codeUnit <= 122)
  );
}

function isAsciiDigit(codeUnit) {
  return codeUnit >= 48 && codeUnit <= 57;
}

function isBearerTokenBodyCharacter(codeUnit) {
  return (
    isAsciiLetter(codeUnit) ||
    isAsciiDigit(codeUnit) ||
    codeUnit === 45 ||
    codeUnit === 46 ||
    codeUnit === 95 ||
    codeUnit === 126 ||
    codeUnit === 43 ||
    codeUnit === 47
  );
}

function startsWithBearerScheme(value) {
  if (value.length < BEARER_SCHEME_LENGTH) {
    return false;
  }

  for (let index = 0; index < BEARER_SCHEME_LENGTH; index += 1) {
    const actual = value.charCodeAt(index);
    const expected = BEARER_SCHEME.charCodeAt(index);
    if (!isAsciiLetter(actual) || (actual | 32) !== (expected | 32)) {
      return false;
    }
  }

  return true;
}

function isValidBearerCredential(credential) {
  const length = credential.length;
  if (length === 0 || length > MAX_CREDENTIAL_LENGTH) {
    return false;
  }

  let index = 0;
  let sawBodyCharacter = false;
  while (index < length) {
    const codeUnit = credential.charCodeAt(index);
    if (!isBearerTokenBodyCharacter(codeUnit)) {
      break;
    }
    sawBodyCharacter = true;
    index += 1;
  }

  if (!sawBodyCharacter) {
    return false;
  }

  while (index < length) {
    if (credential.charCodeAt(index) !== 61) {
      return false;
    }
    index += 1;
  }

  return true;
}

export function extractBearerCredential(authorizationHeader) {
  try {
    if (typeof authorizationHeader !== "string") {
      return null;
    }
    if (authorizationHeader.length < BEARER_SCHEME_LENGTH + 2) {
      return null;
    }
    if (!startsWithBearerScheme(authorizationHeader)) {
      return null;
    }
    if (authorizationHeader.charCodeAt(BEARER_SCHEME_LENGTH) !== 32) {
      return null;
    }

    const credential = authorizationHeader.slice(BEARER_SCHEME_LENGTH + 1);
    if (!isValidBearerCredential(credential)) {
      return null;
    }
    return credential;
  } catch {
    return null;
  }
}
