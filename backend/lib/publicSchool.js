const { publicSchoolCodeFromRecord } = require("./schoolCodeV2");
const { presentPublicSchoolLogoFields } = require("./schoolLogo");

function toPublicSchool(school = {}) {
  const canonicalCode = publicSchoolCodeFromRecord(school);
  return {
    code: canonicalCode,
    loginCode: canonicalCode,
    name: String(school.name ?? "").trim(),
    city: String(school.city ?? "").trim(),
    ...presentPublicSchoolLogoFields(school),
  };
}

module.exports = {
  toPublicSchool,
};
