const { publicSchoolCodeFromRecord } = require("./schoolCodeV2");

function toPublicSchool(school = {}) {
  const canonicalCode = publicSchoolCodeFromRecord(school);
  return {
    code: canonicalCode,
    loginCode: canonicalCode,
    name: String(school.name ?? "").trim(),
    city: String(school.city ?? "").trim(),
    ...(school.logoUrl ? { logoUrl: String(school.logoUrl) } : {}),
  };
}

module.exports = {
  toPublicSchool,
};
