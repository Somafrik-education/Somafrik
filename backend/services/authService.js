const { AccountIdentifier } = require("./accountIdentifier");
const { verifySecret } = require("./credentialService");
const { resolveParentChildren } = require("../lib/parentChildren");
const {
  getLoginAttemptKey,
  assertLoginNotLocked,
  recordFailedLoginAttempt,
  clearFailedLoginAttempts,
} = require("../lib/loginLockout");
const { GENERIC_AUTH_ERROR, canUserAccountLogin, loginBlockedMessage } = require("../lib/userAccountRules");
const {
  sanitizeUserForResponse,
  sanitizeUsersForResponse,
} = require("../lib/sanitizeUserForResponse");

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

const managedMobileRoles = {
  "Super Administrateur Somafrik": { role: "super_admin", roleLabel: "Super Administrateur" },
  "Super Administrateur OKAFRIK": { role: "super_admin", roleLabel: "Super Administrateur" },
  "Admin Pays": { role: "country_admin", roleLabel: "Admin Pays" },
  "Admin School": { role: "school_admin", roleLabel: "Admin Établissement" },
  Proviseur: { role: "principal", roleLabel: "Proviseur" },
  Directeur: { role: "principal", roleLabel: "Proviseur" },
  "Préfet des études": { role: "prefet", roleLabel: "Préfet des études" },
  Secrétaire: { role: "secretary", roleLabel: "Secrétaire" },
  Enseignant: { role: "teacher", roleLabel: "Enseignant" },
  Parent: { role: "parent_student", roleLabel: "Parent" },
  "Élève / Étudiant": { role: "student", roleLabel: "Élève" },
};

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isTeacherRole(role) {
  const key = normalizeText(role);
  return key === "enseignant" || key.includes("prof");
}

function isStudentRole(role) {
  const key = normalizeText(role);
  return key.includes("eleve") || key.includes("etudiant");
}

function buildTeacherNameKeys(teacher = {}, user = {}) {
  const keys = new Set();
  const add = (value) => {
    const normalized = normalizeText(value);
    if (normalized) keys.add(normalized);
  };

  [teacher.name, teacher.firstName, teacher.lastName, user.firstName, user.lastName, user.name]
    .forEach(add);

  const first = normalizeText(teacher.firstName ?? user.firstName);
  const last = normalizeText(teacher.name ?? teacher.lastName ?? user.lastName);
  if (first && last) {
    keys.add(`${first} ${last}`.trim());
    keys.add(`${last} ${first}`.trim());
  }

  return keys;
}

function assignmentMatchesTeacher(assignment = {}, teacher = {}, user = {}) {
  const teacherId = String(teacher.id ?? "").trim();
  const teacherPublicId = String(teacher.publicId ?? "").trim();
  const userId = String(user.id ?? "").trim();
  const ref = String(assignment.teacherId ?? "").trim();

  if (ref && (ref === teacherId || ref === teacherPublicId || (userId && ref === userId))) {
    return true;
  }

  const nameKeys = buildTeacherNameKeys(teacher, user);
  return nameKeys.size > 0 && nameKeys.has(normalizeText(assignment.teacherName));
}

function dedupeAssignments(assignments = []) {
  const seen = new Set();
  const rows = [];

  for (const assignment of assignments) {
    const className = String(assignment.className ?? "").trim();
    const course = String(assignment.course ?? assignment.subject ?? "").trim();
    const key = `${normalizeText(className)}|${normalizeText(course)}`;
    if (!className || !course || seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push({ className, course, ...assignment });
  }

  return rows;
}

function resolveTeacherAssignments(teacher, user, globalAssignments = []) {
  const embedded = Array.isArray(teacher?.assignments) ? teacher.assignments : [];
  const schoolCode = normalizeText(user?.schoolCode ?? teacher?.schoolCode);

  const matchedGlobal = (globalAssignments ?? []).filter((assignment) => {
    const assignmentSchool = normalizeText(assignment.schoolCode);
    if (
      schoolCode &&
      assignmentSchool &&
      schoolCode !== assignmentSchool &&
      String(user?.schoolCode ?? "") !== "*"
    ) {
      return false;
    }
    return assignmentMatchesTeacher(assignment, teacher, user);
  });

  return dedupeAssignments([...embedded, ...matchedGlobal]);
}

function resolveTeacherAssignedClasses(teacher, user, globalAssignments = []) {
  return [
    ...new Set(
      resolveTeacherAssignments(teacher, user, globalAssignments).map((item) => item.className).filter(Boolean),
    ),
  ];
}

class BusinessError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

class AuthService {
  constructor({
    school,
    schools = [school],
    teachers,
    students,
    relations = [],
    userAccounts,
    countries = [],
    subscriptions = [],
    assignments = [],
  }) {
    this.school = school;
    this.schools = schools.filter(Boolean);
    this.teachers = teachers;
    this.students = students;
    this.relations = relations;
    this.userAccounts = userAccounts;
    this.countries = countries;
    this.subscriptions = subscriptions;
    this.assignments = assignments;
  }

  identify({ schoolCode, identifier }) {
    this.assertRequiredFields({ schoolCode, identifier }, "Champs manquants");
    const schoolContext = this.assertSchoolCanConnect(schoolCode);
    const accountSchoolCode = this.resolveSchoolAccountCode(schoolContext);

    const managedUser = this.findManagedUser(identifier, accountSchoolCode);
    if (!managedUser) {
      throw new BusinessError(
        404,
        "Aucun compte utilisateur trouvé. Contactez l'administration de l'établissement."
      );
    }

    this.assertManagedUserCanUseMobile(managedUser);

    const managedMobileRole = this.getManagedMobileRole(managedUser);
    if (!managedMobileRole) {
      throw new BusinessError(
        403,
        "Ce compte utilisateur n'est pas autorisé sur l'application mobile."
      );
    }

    return managedMobileRole;
  }

  async login({ role, schoolCode, identifier, pin }) {
    this.assertRequiredFields({ role, schoolCode, identifier, pin }, "Champs manquants");
    const schoolContext = this.assertSchoolCanConnect(schoolCode);
    const accountSchoolCode = this.resolveSchoolAccountCode(schoolContext);
    const canonicalSchoolCode = schoolContext.loginCode || schoolCode;

    const loginKey = getLoginAttemptKey(canonicalSchoolCode, identifier);
    try {
      await assertLoginNotLocked(loginKey);
    } catch (error) {
      if (error?.code === "LOGIN_LOCKED" || error?.message === "LOCKED") {
        throw new BusinessError(
          423,
          "Compte temporairement verrouillé après plusieurs tentatives. Réessayez dans 15 minutes.",
        );
      }
      throw error;
    }

    const managedUser = this.findManagedUser(identifier, accountSchoolCode, role);
    if (!managedUser) {
      await recordFailedLoginAttempt(loginKey);
      throw new BusinessError(401, GENERIC_AUTH_ERROR);
    }

    this.assertManagedUserCanUseMobile(managedUser);

    const managedMobileRole = this.getManagedMobileRole(managedUser, role);
    if (!managedMobileRole || managedMobileRole.role !== role) {
      await recordFailedLoginAttempt(loginKey);
      throw new BusinessError(401, GENERIC_AUTH_ERROR);
    }

    if (!this.verifyUserSecret(managedUser, pin)) {
      await recordFailedLoginAttempt(loginKey);
      throw new BusinessError(401, GENERIC_AUTH_ERROR);
    }

    await clearFailedLoginAttempts(loginKey);
    return {
      role,
      user: this.buildManagedMobileUser(managedUser, role),
      school: schoolContext,
    };
  }

  userMatchesIdentifier(user, identifier) {
    const normalizedIdentifier = normalizeText(identifier);
    const fields = ["identifier", "phone", "publicId", "email"];

    return fields.some((field) => {
      const value = normalizeText(user[field]);
      if (value !== normalizedIdentifier) {
        return false;
      }

      // Le téléphone sur un compte élève réfère le parent, pas un identifiant de connexion.
      if (isStudentRole(user.role) && field === "phone") {
        return false;
      }

      return true;
    });
  }

  findManagedUser(identifier, schoolCode, preferredMobileRole = null) {
    const normalizedSchoolCode = String(schoolCode).trim().toUpperCase();

    const matches = this.userAccounts.filter(
      (user) =>
        (user.schoolCode === "*" || user.schoolCode === normalizedSchoolCode) &&
        this.userMatchesIdentifier(user, identifier)
    );

    if (matches.length > 1 && preferredMobileRole) {
      const preferred = matches.find(
        (user) => this.getManagedMobileRole(user, preferredMobileRole)?.role === preferredMobileRole
      );
      if (preferred) {
        return preferred;
      }
    }

    if (matches.length > 1 && /^\+?\d/.test(String(identifier).trim())) {
      const parentMatch = matches.find((user) => user.role === "Parent");
      if (parentMatch) {
        return parentMatch;
      }
    }

    if (matches[0]) {
      return matches[0];
    }

    const teacher = this.teachers.find(
      (item) =>
        (!item.schoolCode || normalizeText(item.schoolCode) === normalizeText(normalizedSchoolCode)) &&
        [item.identifier, item.publicId, item.id].some(
          (value) => normalizeText(value) === normalizeText(identifier)
        )
    );
    if (!teacher?.userId) {
      return undefined;
    }

    return this.userAccounts.find(
      (user) =>
        (user.schoolCode === "*" || user.schoolCode === normalizedSchoolCode) &&
        String(user.id) === String(teacher.userId)
    );
  }

  findLinkedTeacher(user) {
    const userId = String(user.id ?? "");
    const userIdentifier = normalizeText(user.identifier);
    const schoolCode = normalizeText(user.schoolCode);

    return this.teachers.find((teacher) => {
      if (userId && String(teacher.userId ?? "") === userId) {
        return true;
      }
      if (schoolCode && teacher.schoolCode && normalizeText(teacher.schoolCode) !== schoolCode) {
        return false;
      }
      return userIdentifier && normalizeText(teacher.identifier) === userIdentifier;
    });
  }

  findLinkedStudent(user, schoolCode) {
    const accountIdentifier = new AccountIdentifier(schoolCode, user.identifier);
    return this.students.find(
      (student) =>
        student.schoolCode === accountIdentifier.schoolCode &&
        (accountIdentifier.matches(student.matricule) ||
          accountIdentifier.matches(student.publicId) ||
          String(student.id) === String(user.id))
    );
  }

  findLinkedParentChildren(user, schoolCode) {
    return resolveParentChildren(user, { students: this.students, relations: this.relations }, schoolCode);
  }

  buildManagedMobileUser(user, requestedMobileRole = null) {
    const sessionRole = this.sessionRoleLabel(requestedMobileRole, user);
    const base = {
      id: user.id,
      publicId: user.publicId,
      contactId: user.contactId,
      name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.identifier,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      email: user.email,
      role: sessionRole,
      roles: user.roles,
      roleKeys: user.roleKeys,
      scopeLevel: user.scopeLevel,
      countryScope: user.countryScope,
      countryCode: user.countryCode,
      schoolCode: user.role === "Admin Pays" || sessionRole === "Admin Pays" ? "*" : user.schoolCode,
      permissions: user.permissions,
      mustChangePassword:
        user.mustChangePassword === false
          ? false
          : user.mustChangePassword != null
            ? Boolean(user.mustChangePassword)
            : Boolean(user.temporaryPassword),
    };

    if (requestedMobileRole === "teacher" || isTeacherRole(sessionRole)) {
      const teacher = this.findLinkedTeacher(user);
      if (teacher) {
        const assignments = resolveTeacherAssignments(teacher, user, this.assignments);
        const assignedClasses = resolveTeacherAssignedClasses(teacher, user, this.assignments);
        const courses = [...new Set(assignments.map((item) => item.course).filter(Boolean))];
        const safeTeacher = sanitizeUserForResponse(teacher);
        return {
          ...base,
          ...safeTeacher,
          role: sessionRole,
          roles: user.roles,
          roleKeys: user.roleKeys,
          assignments,
          assignedClasses,
          courses,
        };
      }
    }

    if (requestedMobileRole === "parent_student" || sessionRole === "Parent") {
      return {
        ...base,
        children: sanitizeUsersForResponse(this.findLinkedParentChildren(user, user.schoolCode)),
        parentPhone: user.phone ?? user.identifier,
      };
    }

    if (isStudentRole(user.role)) {
      const student = this.findLinkedStudent(user, user.schoolCode);
      if (student) {
        const safeStudent = sanitizeUserForResponse(student);
        return {
          ...base,
          ...safeStudent,
          matricule: safeStudent.matricule ?? user.identifier,
        };
      }
    }

    return base;
  }

  userGrantedMobileRoles(user) {
    const { toRoleKey, toRoleLabel } = require("../lib/userRoleLifecycle");
    const keys = [];
    if (Array.isArray(user?.roleKeys)) {
      keys.push(...user.roleKeys.map(toRoleKey));
    }
    if (Array.isArray(user?.roles)) {
      keys.push(...user.roles.map(toRoleKey));
    }
    if (user?.role) {
      keys.push(toRoleKey(user.role));
    }
    const unique = [...new Set(keys.filter(Boolean))];
    return unique.map((key) => managedMobileRoles[toRoleLabel(key)]).filter(Boolean);
  }

  getManagedMobileRole(user, requestedRole = null) {
    if (!user) return null;
    const granted = this.userGrantedMobileRoles(user);
    if (requestedRole) {
      return granted.find((item) => item.role === requestedRole) || null;
    }
    if (managedMobileRoles[user.role]) return managedMobileRoles[user.role];
    return granted[0] || null;
  }

  sessionRoleLabel(requestedMobileRole, user) {
    if (!requestedMobileRole) return user.role;
    const match = Object.entries(managedMobileRoles).find(([, value]) => value.role === requestedMobileRole);
    return match?.[0] || user.role;
  }

  assertRequiredFields(fields, message) {
    if (Object.values(fields).some((field) => !field)) {
      throw new BusinessError(400, message);
    }
  }

  assertSchoolCanConnect(schoolCode) {
    const school = this.findSchoolByCode(schoolCode);
    if (!school) {
      throw new BusinessError(401, "Code etablissement invalide");
    }

    if (school.status === "Suspendu") {
      throw new BusinessError(403, "Etablissement suspendu. Connexion indisponible.");
    }

    if (
      school.validationStatus === "En attente de validation" ||
      school.validationStatus === "En attente"
    ) {
      throw new BusinessError(
        403,
        "Établissement en attente de validation par le Super Administrateur. Connexion indisponible."
      );
    }

    if (this.isCountrySuspended(this.resolveSchoolCountryCode(school))) {
      throw new BusinessError(403, "Pays suspendu. Connexion indisponible pour ce pays.");
    }

    const { assertSchoolCanConnect } = require("./schoolSubscriptionAccessService");
    assertSchoolCanConnect(this.resolveSchoolAccountCode(school), {
      schools: this.schools,
      subscriptions: this.subscriptions,
    });

    return school;
  }

  resolveSchoolCountryCode(school) {
    if (!school) {
      return "";
    }

    return (
      this.getCountryCode(school.country) ||
      this.getCountryCode(school.countryCode) ||
      String(school.code ?? "").slice(0, 2).toUpperCase()
    );
  }

  isCountrySuspended(countryCode) {
    if (!countryCode) {
      return false;
    }

    const normalized = String(countryCode).trim().toUpperCase();
    return this.countries.some(
      (country) =>
        String(country.code ?? "").trim().toUpperCase() === normalized &&
        country.status === "Suspendu"
    );
  }

  getCountryCode(countryScope) {
    const normalized = String(countryScope ?? "").trim().toUpperCase();
    const codes = {
      RDC: "CD",
      "RÉPUBLIQUE DÉMOCRATIQUE DU CONGO": "CD",
      "REPUBLIQUE DEMOCRATIQUE DU CONGO": "CD",
      BURUNDI: "BI",
      BI: "BI",
      CONGO: "CG",
      CG: "CG",
      SENEGAL: "SN",
      "SÉNÉGAL": "SN",
      SN: "SN",
    };
    return codes[normalized] ?? (/^[A-Z]{2}$/.test(normalized) ? normalized : "");
  }

  verifyUserSecret(user, secret) {
    if (!user) {
      return false;
    }

    const normalizedSecret = String(secret ?? "");

    if (user.passwordHash && verifySecret(normalizedSecret, user.passwordHash)) {
      return true;
    }

    if (user.pinHash && verifySecret(normalizedSecret, user.pinHash)) {
      return true;
    }

    const temporaryPassword = String(user.temporaryPassword ?? "").trim();
    if (temporaryPassword && temporaryPassword === normalizedSecret) {
      return true;
    }

    return String(user.password ?? "") === normalizedSecret || String(user.pin ?? "") === normalizedSecret;
  }

  resolveSchoolAccountCode(school) {
    return String(school?.code ?? school?.legacySchoolCode ?? school?.publicId ?? "").trim().toUpperCase();
  }

  matchesSchoolCode(schoolCode) {
    return Boolean(this.findSchoolByCode(schoolCode));
  }

  findSchoolByCode(schoolCode) {
    const normalizedCode = String(schoolCode).trim().toUpperCase();
    return this.schools.find((school) =>
      [school.loginCode, school.code, school.publicId, school.legacySchoolCode].some(
        (value) => String(value ?? "").trim().toUpperCase() === normalizedCode
      )
    );
  }

  assertManagedUserCanUseMobile(user) {
    if (!canUserAccountLogin(user)) {
      throw new BusinessError(403, loginBlockedMessage(user));
    }

    if (
      user?.accessChannel === "BackOffice" &&
      !["Super Administrateur Somafrik", "Super Administrateur OKAFRIK", "Admin Pays", "Admin School"].includes(user.role)
    ) {
      throw new BusinessError(
        403,
        "Ce compte est réservé à la plateforme Somafrik. Utilisez le portail PC/tablette/web."
      );
    }
  }
}

module.exports = {
  AuthService,
  BusinessError,
  assignmentMatchesTeacher,
  buildTeacherNameKeys,
  dedupeAssignments,
  resolveTeacherAssignments,
  resolveTeacherAssignedClasses,
};
