"use strict";

const { isV2SchoolLoginCode, normalizeSchoolCode } = require("./schoolCodeV2");

/**
 * Garantit schoolId + schoolPublicCode sur la session login.
 * N'utilise jamais leftover schools.school_code comme autorité.
 */
function attachCanonicalSchoolIdentity(user, school) {
  if (!user || typeof user !== "object") return user;
  const fromUser = normalizeSchoolCode(user.schoolPublicCode);
  const fromSchoolLogin = normalizeSchoolCode(school?.loginCode ?? school?.login_code);
  const fromSchoolPublicId = normalizeSchoolCode(school?.publicId);
  const fromSchoolCode = normalizeSchoolCode(school?.code);
  const publicCode = [
    fromUser,
    isV2SchoolLoginCode(fromSchoolLogin) ? fromSchoolLogin : "",
    isV2SchoolLoginCode(fromSchoolPublicId) ? fromSchoolPublicId : "",
    isV2SchoolLoginCode(fromSchoolCode) ? fromSchoolCode : "",
  ].find((value) => Boolean(value));
  const schoolId = String(user.schoolId || school?.id || school?.schoolId || "").trim();
  return {
    ...user,
    ...(schoolId ? { schoolId } : {}),
    ...(publicCode ? { schoolPublicCode: publicCode } : {}),
  };
}

module.exports = {
  attachCanonicalSchoolIdentity,
};
