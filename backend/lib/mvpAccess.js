/**
 * S1.4 — Contrôle d'accès + scoping pour /api/mvp/{readiness,snapshot,dashboard}.
 */

const {
  canAccessBackOfficeRole,
  SUPER_ADMIN_ROLES,
} = require("./establishmentRoles");

const MVP_ALLOWED_EXTRA_ROLES = new Set([
  "Enseignant",
]);

/**
 * @param {{ role?: string } | null | undefined} principal
 * @returns {boolean}
 */
function canAccessMvpRoutes(principal) {
  const role = principal?.role ?? "";
  if (!role) return false;
  if (canAccessBackOfficeRole(role)) return true;
  return MVP_ALLOWED_EXTRA_ROLES.has(role);
}

/**
 * Filtre les collections MVP selon le tenant du principal.
 * Super Admin : pas de filtre.
 * Admin Pays : pays (préfixe schoolCode / countryCode).
 * Autres : établissement (+ classes enseignant via filterRows si fourni).
 *
 * @param {object} dataset
 * @param {{ role?: string, schoolCode?: string, countryCode?: string, classNames?: string[] } | null} principal
 * @param {{ filterRows: Function }} tenantScopeService
 */
function scopeMvpDatasetForPrincipal(dataset, principal, tenantScopeService) {
  const role = principal?.role ?? "";
  const students = dataset.students ?? [];
  const classes = dataset.classes ?? [];
  const courses = dataset.courses ?? [];
  const notes = dataset.notes ?? [];
  const payments = dataset.payments ?? [];
  const schools = dataset.platformSchools ?? dataset.schools ?? [];

  if (!principal || SUPER_ADMIN_ROLES.includes(role)) {
    return {
      school: dataset.school,
      students,
      classes,
      courses,
      notes,
      payments,
    };
  }

  if (role === "Admin Pays") {
    const countryCode = String(principal.countryCode ?? "").trim().toUpperCase();
    const countrySchools = schools.filter((school) => {
      const code = String(school.countryCode ?? school.code ?? "").trim().toUpperCase();
      return countryCode && (code === countryCode || code.startsWith(countryCode));
    });
    const schoolCodes = new Set(
      countrySchools.map((school) => String(school.code ?? "").trim().toUpperCase()).filter(Boolean),
    );
    const school =
      countrySchools.find((item) => item.code === dataset.school?.code) ??
      countrySchools[0] ??
      { code: "", name: "" };

    const inCountry = (row) => {
      const rowSchool = String(row.schoolCode ?? "").trim().toUpperCase();
      if (rowSchool) return schoolCodes.has(rowSchool);
      const rowCountry = String(row.countryCode ?? "").trim().toUpperCase();
      return Boolean(countryCode) && rowCountry === countryCode;
    };

    return {
      school,
      students: students.filter(inCountry),
      classes: classes.filter(inCountry),
      courses: courses.filter(inCountry),
      notes: notes.filter(inCountry),
      payments: payments.filter(inCountry),
    };
  }

  const principalSchool = String(principal.schoolCode ?? "").trim().toUpperCase();
  const school =
    schools.find((item) => String(item.code ?? "").trim().toUpperCase() === principalSchool) ??
    (String(dataset.school?.code ?? "").trim().toUpperCase() === principalSchool
      ? dataset.school
      : { code: principal.schoolCode ?? "", name: "" });

  const scope = {
    schoolStudentIds: students
      .filter((row) => String(row.schoolCode ?? "").trim().toUpperCase() === principalSchool)
      .map((row) => String(row.id ?? "").trim())
      .filter(Boolean),
    schoolClassNames: classes
      .filter((row) => String(row.schoolCode ?? "").trim().toUpperCase() === principalSchool)
      .map((row) => row.name)
      .filter(Boolean),
  };

  return {
    school,
    students: tenantScopeService.filterRows(students, principal, scope),
    classes: tenantScopeService.filterRows(classes, principal, scope),
    courses: tenantScopeService.filterRows(courses, principal, scope),
    notes: tenantScopeService.filterRows(notes, principal, {
      ...scope,
      schoolField: "schoolCode",
    }),
    payments: tenantScopeService.filterRows(payments, principal, scope),
  };
}

module.exports = {
  MVP_ALLOWED_EXTRA_ROLES,
  canAccessMvpRoutes,
  scopeMvpDatasetForPrincipal,
};
