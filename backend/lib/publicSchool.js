function toPublicSchool(school = {}) {
  return {
    code: String(school.code ?? "").trim(),
    name: String(school.name ?? "").trim(),
    city: String(school.city ?? "").trim(),
    ...(school.logoUrl ? { logoUrl: String(school.logoUrl) } : {}),
  };
}

module.exports = {
  toPublicSchool,
};
