/** Utilitaires établissements — miroir web/src/lib/schoolModule.ts */
const SCHOOL_TYPES = [
  "École primaire",
  "Collège",
  "Lycée",
  "Université",
  "Institut",
  "Centre de formation",
];

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function generateSchoolCode(countryCode, schools = []) {
  const code = String(countryCode ?? "").trim().toUpperCase();
  if (!code) return "";
  const year = new Date().getFullYear();
  const prefix = `${code}-${year}-`;
  const maxNum = schools.reduce((max, school) => {
    const value = String(school.code ?? "").trim().toUpperCase();
    if (!value.startsWith(prefix)) return max;
    const match = value.match(/-(\d{4})$/);
    return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
  }, 0);
  return `${prefix}${String(maxNum + 1).padStart(4, "0")}`;
}

function isSchoolDeleted(school) {
  return (
    normalize(school.status) === "supprime" ||
    normalize(school.status) === "deleted" ||
    Boolean(school.deletedAt)
  );
}

function filterActiveSchools(schools = []) {
  return schools.filter((school) => !isSchoolDeleted(school));
}

function validateSchoolPayload(school, schools, { isNew = false } = {}) {
  const name = String(school.name ?? "").trim();
  if (name.length < 2) return "Le nom de l'établissement doit contenir au moins 2 caractères.";
  if (!String(school.type ?? "").trim()) return "Le type d'établissement est obligatoire.";
  if (!String(school.country ?? "").trim()) return "Le pays est obligatoire.";
  if (!String(school.city ?? "").trim()) return "La ville est obligatoire.";
  if (!String(school.phone ?? "").trim()) return "Le téléphone est obligatoire.";
  const email = String(school.email ?? "").trim();
  if (!email) return "L'email est obligatoire.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Format email invalide.";
  if (!String(school.principalName ?? "").trim()) return "Le responsable principal est obligatoire.";

  const code = String(school.code ?? "").trim().toUpperCase();
  if (!code) return "Le code établissement est obligatoire.";
  const duplicateCode = isNew
    ? schools.some((item) => normalize(item.code) === normalize(code))
    : schools.some((item) => normalize(item.code) === normalize(code) && item.code !== school.code);
  if (duplicateCode) return "Ce code établissement existe déjà.";

  return null;
}

function findPotentialDuplicates(school, schools = []) {
  const name = normalize(school.name);
  const city = normalize(school.city);
  const email = normalize(school.email);
  const phone = normalize(school.phone);
  const code = normalize(school.code);

  return schools.filter((item) => {
    if (code && normalize(item.code) === code) return false;
    if (email && normalize(item.email) === email) return true;
    if (phone && normalize(item.phone) === phone) return true;
    if (name && city && normalize(item.name) === name && normalize(item.city) === city) return true;
    return false;
  });
}

module.exports = {
  SCHOOL_TYPES,
  normalize,
  generateSchoolCode,
  isSchoolDeleted,
  filterActiveSchools,
  validateSchoolPayload,
  findPotentialDuplicates,
};
