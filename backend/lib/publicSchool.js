function toPublicSchool(school = {}) {
  const canonicalCode = String(
    school.loginCode ?? school.publicId ?? school.code ?? "",
  ).trim().toUpperCase();
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
