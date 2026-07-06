const { AccountIdentifier } = require("./accountIdentifier");
const { verifySecret } = require("./credentialService");

const failedLoginAttempts = new Map();
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

class BusinessError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

class AuthService {
  constructor({ school, schools = [school], teachers, students, userAccounts, countries = [] }) {
    this.school = school;
    this.schools = schools.filter(Boolean);
    this.teachers = teachers;
    this.students = students;
    this.userAccounts = userAccounts;
    this.countries = countries;
  }

  identify({ schoolCode, identifier }) {
    this.assertRequiredFields({ schoolCode, identifier }, "Champs manquants");
    this.assertSchoolCanConnect(schoolCode);

    const managedUser = this.findManagedUser(identifier, schoolCode);
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

  login({ role, schoolCode, identifier, pin }) {
    this.assertRequiredFields({ role, schoolCode, identifier, pin }, "Champs manquants");
    const schoolContext = this.assertSchoolCanConnect(schoolCode);

    const loginKey = this.getLoginAttemptKey(schoolCode, identifier);
    this.assertLoginNotLocked(loginKey);

    const managedUser = this.findManagedUser(identifier, schoolCode, role);
    if (!managedUser) {
      this.recordFailedLoginAttempt(loginKey);
      throw new BusinessError(
        401,
        "Compte utilisateur requis. Contactez l'administration de l'établissement."
      );
    }

    this.assertManagedUserCanUseMobile(managedUser);

    const managedMobileRole = this.getManagedMobileRole(managedUser);
    if (!managedMobileRole || managedMobileRole.role !== role) {
      this.recordFailedLoginAttempt(loginKey);
      throw new BusinessError(401, "Identifiants incorrects");
    }

    if (!this.verifyUserSecret(managedUser, pin)) {
      this.recordFailedLoginAttempt(loginKey);
      throw new BusinessError(401, "Identifiants incorrects");
    }

    this.clearFailedLoginAttempts(loginKey);
    return {
      role,
      user: this.buildManagedMobileUser(managedUser),
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
        (user) => this.getManagedMobileRole(user)?.role === preferredMobileRole
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
    const normalizedSchoolCode = String(schoolCode).trim().toUpperCase();
    const parentPhone = normalizeText(user.identifier) || normalizeText(user.phone);
    if (!parentPhone) {
      return [];
    }

    return this.students.filter(
      (student) =>
        student.schoolCode === normalizedSchoolCode &&
        normalizeText(student.parentPhone) === parentPhone
    );
  }

  buildManagedMobileUser(user) {
    const base = {
      id: user.id,
      publicId: user.publicId,
      name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.identifier,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      email: user.email,
      role: user.role,
      scopeLevel: user.scopeLevel,
      countryScope: user.countryScope,
      countryCode: user.countryCode,
      schoolCode: user.role === "Admin Pays" ? "*" : user.schoolCode,
      permissions: user.permissions,
      mustChangePassword:
        user.mustChangePassword != null
          ? Boolean(user.mustChangePassword)
          : Boolean(user.temporaryPassword),
    };

    if (isTeacherRole(user.role)) {
      const teacher = this.findLinkedTeacher(user);
      if (teacher) {
        const assignedClasses = [...new Set((teacher.assignments ?? []).map((item) => item.className))];
        const courses = [...new Set((teacher.assignments ?? []).map((item) => item.course))];
        const { password: _password, passwordHash: _passwordHash, pinHash: _pinHash, ...safeTeacher } = teacher;
        return {
          ...base,
          ...safeTeacher,
          assignedClasses,
          courses,
        };
      }
    }

    if (user.role === "Parent") {
      const children = this.findLinkedParentChildren(user, user.schoolCode).map(
        ({ pin: _pin, pinHash: _pinHash, password: _password, ...safeStudent }) => safeStudent
      );
      return {
        ...base,
        children,
        parentPhone: user.phone ?? user.identifier,
      };
    }

    if (isStudentRole(user.role)) {
      const student = this.findLinkedStudent(user, user.schoolCode);
      if (student) {
        const { pin: _pin, pinHash: _pinHash, password: _password, ...safeStudent } = student;
        return {
          ...base,
          ...safeStudent,
          matricule: safeStudent.matricule ?? user.identifier,
        };
      }
    }

    return base;
  }

  getManagedMobileRole(user) {
    return user ? managedMobileRoles[user.role] : null;
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

    if (user.passwordHash || user.pinHash) {
      return verifySecret(secret, user.passwordHash) || verifySecret(secret, user.pinHash);
    }

    return user.password === secret || user.pin === secret;
  }

  getLoginAttemptKey(schoolCode, identifier) {
    return `${String(schoolCode).trim().toUpperCase()}:${String(identifier).trim().toLowerCase()}`;
  }

  assertLoginNotLocked(key) {
    const current = failedLoginAttempts.get(key);

    if (!current?.lockedUntil) {
      return;
    }

    if (current.lockedUntil <= Date.now()) {
      failedLoginAttempts.delete(key);
      return;
    }

    throw new BusinessError(423, "Compte temporairement verrouille apres plusieurs tentatives. Reessayez dans 15 minutes.");
  }

  recordFailedLoginAttempt(key) {
    const current = failedLoginAttempts.get(key) ?? { count: 0, lockedUntil: null };
    const count = current.count + 1;
    failedLoginAttempts.set(key, {
      count,
      lockedUntil: count >= MAX_FAILED_LOGIN_ATTEMPTS ? Date.now() + LOGIN_LOCK_DURATION_MS : null,
    });
  }

  clearFailedLoginAttempts(key) {
    failedLoginAttempts.delete(key);
  }

  matchesSchoolCode(schoolCode) {
    return Boolean(this.findSchoolByCode(schoolCode));
  }

  findSchoolByCode(schoolCode) {
    const normalizedCode = String(schoolCode).trim().toUpperCase();
    return this.schools.find((school) =>
      [school.code, school.publicId].some(
        (value) => String(value ?? "").trim().toUpperCase() === normalizedCode
      )
    );
  }

  assertManagedUserCanUseMobile(user) {
    if (
      user &&
      (user.validationStatus === "En attente de validation" ||
        user.status === "En attente de validation")
    ) {
      throw new BusinessError(
        403,
        "Compte en attente de validation par le Super Administrateur. Connexion indisponible."
      );
    }

    if (user && user.status !== "Actif") {
      throw new BusinessError(403, "Compte suspendu ou desactive. Connexion indisponible.");
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

module.exports = { AuthService, BusinessError };
