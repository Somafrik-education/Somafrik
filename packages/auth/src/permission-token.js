function isAsciiLowerLetter(code) {
  return code >= 97 && code <= 122;
}

function isAsciiDigit(code) {
  return code >= 48 && code <= 57;
}

function isSegmentBodyChar(code) {
  return isAsciiLowerLetter(code) || isAsciiDigit(code) || code === 95 || code === 45;
}

export function isCanonicalPermissionToken(permission) {
  if (typeof permission !== "string") {
    return false;
  }

  const length = permission.length;
  if (length < 3) {
    return false;
  }

  let colonIndex = -1;

  for (let index = 0; index < length; index += 1) {
    const code = permission.charCodeAt(index);

    if (code === 58) {
      if (colonIndex !== -1) {
        return false;
      }
      colonIndex = index;
      continue;
    }

    if (!isSegmentBodyChar(code)) {
      return false;
    }
  }

  if (colonIndex <= 0 || colonIndex >= length - 1) {
    return false;
  }

  if (!isAsciiLowerLetter(permission.charCodeAt(0))) {
    return false;
  }

  if (!isAsciiLowerLetter(permission.charCodeAt(colonIndex + 1))) {
    return false;
  }

  return true;
}
