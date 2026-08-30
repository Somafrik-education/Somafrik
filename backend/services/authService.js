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
  isForbiddenLegacyLoginIdentifier,
  assertCanonicalSchoolLoginCode,
} = require("../lib/canonicalLoginIdentity");
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
  Comptable: { role: "accountant", roleLabel: "Comptable" },
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

function asAssignmentRef(value) {
  return String(value ?? "").trim();
}

function readAssignmentClassId(assignment = {}) {
  return asAssignmentRef(assignment.classId ?? assignment.class_id);
}

function readAssignmentClassCode(assignment = {}) {
  return asAssignmentRef(assignment.classCode ?? assignment.class_code);
}

function readAssignmentStatus(assignment = {}) {
  if (Object.hasOwn(assignment, "status")) return assignment.status;
  if (Object.hasOwn(assignment, "assignmentStatus")) return assignment.assignmentStatus;
  if (Object.hasOwn(assignment, "assignment_status")) return assignment.assignment_status;
  return undefined;
}

function readAssignmentRowId(assignment = {}) {
  return asAssignmentRef(assignment.id ?? assignment.assignmentId ?? assignment.assignment_id);
}

function readSubjectIdentity(assignment = {}) {
  return (
    asAssignmentRef(assignment.subjectId ?? assignment.subject_id) ||
    asAssignmentRef(assignment.subjectCode ?? assignment.subject_code) ||
    asAssignmentRef(assignment.course ?? assignment.subject)
  );
}

function readAcademicYearIdentity(assignment = {}) {
  return asAssignmentRef(
    assignment.academicYearId ??
      assignment.academic_year_id ??
      assignment.academicYear ??
      assignment.academic_year_name,
  );
}

function readAssignmentRoleIdentity(assignment = {}) {
  return asAssignmentRef(assignment.assignmentRole ?? assignment.assignment_role);
}

function readClassIdentityKey(assignment = {}) {
  const classId = readAssignmentClassId(assignment);
  if (classId) return `id:${classId}`;
  const classCode = readAssignmentClassCode(assignment);
  if (classCode) return `code:${classCode}`;
  return "";
}

/**
 * Clé d'affectation sans id : classe + matière + année + rôle
 * (aligné sur uq_teacher_assignments_active_tuple). Jamais className seul.
 */
function assignmentCompositeKey(assignment = {}) {
  const classKey = readClassIdentityKey(assignment);
  if (!classKey) return "";
  return [
    `cls:${classKey}`,
    `subj:${normalizeText(readSubjectIdentity(assignment))}`,
    `year:${normalizeText(readAcademicYearIdentity(assignment))}`,
    `role:${normalizeText(readAssignmentRoleIdentity(assignment))}`,
  ].join("|");
}

function assignmentCanonicalRichness(assignment = {}) {
  let score = 0;
  if (readAssignmentRowId(assignment)) score += 16;
  if (readAssignmentClassId(assignment)) score += 8;
  if (readAssignmentClassCode(assignment)) score += 4;
  if (readSubjectIdentity(assignment)) score += 2;
  if (readAssignmentStatus(assignment) !== undefined) score += 2;
  return score;
}

function mergeCanonicalAssignment(current, incoming) {
  const incomingRicher =
    assignmentCanonicalRichness(incoming) > assignmentCanonicalRichness(current);
  const winner = incomingRicher ? incoming : current;
  const other = incomingRicher ? current : incoming;
  const rowId = readAssignmentRowId(winner) || readAssignmentRowId(other);
  const classId = readAssignmentClassId(winner) || readAssignmentClassId(other);
  const classCode = readAssignmentClassCode(winner) || readAssignmentClassCode(other);
  const className = asAssignmentRef(winner.className) || asAssignmentRef(other.className);
  const course =
    asAssignmentRef(winner.course ?? winner.subject) ||
    asAssignmentRef(other.course ?? other.subject);
  const subjectCode =
    asAssignmentRef(winner.subjectCode ?? winner.subject_code) ||
    asAssignmentRef(other.subjectCode ?? other.subject_code);
  const status = readAssignmentStatus(winner);
  const merged = {
    ...other,
    ...winner,
    className,
    course,
  };
  if (rowId) merged.id = rowId;
  if (classId) merged.classId = classId;
  if (classCode) merged.classCode = classCode;
  if (subjectCode) merged.subjectCode = subjectCode;
  if (status !== undefined) merged.status = status;
  return merged;
}

function normalizeResolvedAssignment(assignment = {}) {
  const className = asAssignmentRef(assignment.className);
  const course = asAssignmentRef(assignment.course ?? assignment.subject);
  return { className, course, ...assignment };
}

/**
 * Déduplique des projections d'une même affectation (embed vs ligne PG).
 * Deux matières actives dans la même classe restent deux assignments.
 * Le scope classe (classIds/classCodes uniques) se dérive ensuite, pas ici.
 */
function dedupeAssignments(assignments = []) {
  const byId = new Map();
  const byComposite = new Map();
  const displayOnly = [];

  const forget = (row) => {
    if (!row) return;
    const rowId = readAssignmentRowId(row);
    const composite = assignmentCompositeKey(row);
    if (rowId && byId.get(rowId) === row) byId.delete(rowId);
    if (composite && byComposite.get(composite) === row) byComposite.delete(composite);
  };

  const remember = (row) => {
    const rowId = readAssignmentRowId(row);
    const composite = assignmentCompositeKey(row);
    if (rowId) byId.set(rowId, row);
    if (composite) byComposite.set(composite, row);
  };

  for (const assignment of assignments) {
    if (!assignment || typeof assignment !== "object") continue;
    const rowId = readAssignmentRowId(assignment);
    const composite = assignmentCompositeKey(assignment);
    if (!rowId && !composite) {
      displayOnly.push(normalizeResolvedAssignment(assignment));
      continue;
    }

    const existing =
      (rowId && byId.get(rowId)) || (composite && byComposite.get(composite)) || null;
    if (!existing) {
      remember(normalizeResolvedAssignment(assignment));
      continue;
    }
    const merged = mergeCanonicalAssignment(existing, assignment);
    forget(existing);
    remember(merged);
  }

  const canonical = [];
  const seen = new Set();
  for (const row of [...byId.values(), ...byComposite.values()]) {
    if (seen.has(row)) continue;
    seen.add(row);
    canonical.push(row);
  }
  return [...canonical, ...displayOnly];
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

  // Source JWT : affectations canoniques (PG / table globale) avant l'embed historique.
  return dedupeAssignments([...matchedGlobal, ...embedded]);
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
    this.assertRequiredFields({ identifier }, "Champs manquants");
    this.assertCanonicalAuthIdentifiers({ schoolCode, identifier });
    const requestedSchool = String(schoolCode ?? "").trim();
    if (!requestedSchool) {
      const platformUser = this.findPlatformManagedUser(identifier);
      if (!platformUser) {
        throw new BusinessError(400, "Champs manquants");
      }
      this.assertManagedUserCanUseMobile(platformUser);
      const managedMobileRole = this.getManagedMobileRole(platformUser);
      if (!managedMobileRole || !this.isPlatformMobileRole(managedMobileRole.role)) {
        throw new BusinessError(400, "Champs manquants");
      }
      return managedMobileRole;
    }

    const schoolContext = this.assertSchoolCanConnect(requestedSchool);
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
    this.assertRequiredFields({ role, identifier, pin }, "Champs manquants");
    this.assertCanonicalAuthIdentifiers({ schoolCode, identifier });
    const requestedSchool = String(schoolCode ?? "").trim();
    if (!requestedSchool) {
      return this.loginPlatformAccount({ role, identifier, pin });
    }

    const schoolContext = this.assertSchoolCanConnect(requestedSchool);
    const accountSchoolCode = this.resolveSchoolAccountCode(schoolContext);
    const canonicalSchoolCode = schoolContext.loginCode || requestedSchool;

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

  async loginPlatformAccount({ role, identifier, pin }) {
    if (!this.isPlatformMobileRole(role)) {
      throw new BusinessError(400, "Champs manquants");
    }

    const loginKey = getLoginAttemptKey("*", identifier);
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

    const managedUser = this.findPlatformManagedUser(identifier, role);
    if (!managedUser || !this.isPlatformAccount(managedUser)) {
      await recordFailedLoginAttempt(loginKey);
      throw new BusinessError(400, "Champs manquants");
    }

    this.assertManagedUserCanUseMobile(managedUser);

    const managedMobileRole = this.getManagedMobileRole(managedUser, role);
    if (!managedMobileRole || managedMobileRole.role !== role || !this.isPlatformMobileRole(managedMobileRole.role)) {
      await recordFailedLoginAttempt(loginKey);
      throw new BusinessError(401, GENERIC_AUTH_ERROR);
    }

    if (!this.verifyUserSecret(managedUser, pin)) {
      await recordFailedLoginAttempt(loginKey);
      throw new BusinessError(401, GENERIC_AUTH_ERROR);
    }

    await clearFailedLoginAttempts(loginKey);
    const countryCode =
      this.getCountryCode(managedUser.countryScope) ||
      this.getCountryCode(managedUser.countryCode) ||
      "";
    return {
      role,
      user: this.buildManagedMobileUser(managedUser, role),
      platformContext: {
        kind: role === "super_admin" ? "global" : "country",
        countryCode: role === "country_admin" ? countryCode : "",
      },
    };
  }

  isPlatformMobileRole(role) {
    return role === "super_admin" || role === "country_admin";
  }

  isPlatformAccount(user) {
    if (!user) return false;
    const granted = this.userGrantedMobileRoles(user);
    return granted.some((item) => this.isPlatformMobileRole(item.role));
  }

  findPlatformManagedUser(identifier, preferredMobileRole = null) {
    const matches = this.userAccounts.filter(
      (user) => this.userMatchesIdentifier(user, identifier) && this.isPlatformAccount(user),
    );
    if (matches.length > 1 && preferredMobileRole) {
      const preferred = matches.find(
        (user) => this.getManagedMobileRole(user, preferredMobileRole)?.role === preferredMobileRole,
      );
      if (preferred) return preferred;
    }
    return matches[0] || null;
  }

  assertCanonicalAuthIdentifiers({ schoolCode, identifier }) {
    if (isForbiddenLegacyLoginIdentifier(identifier)) {
      throw new BusinessError(401, "Identifiant de connexion legacy refusé.");
    }
    const requestedSchool = String(schoolCode ?? "").trim();
    if (!requestedSchool) return;
    try {
      assertCanonicalSchoolLoginCode(requestedSchool, { required: true });
    } catch (error) {
      throw new BusinessError(error.statusCode || 401, error.message);
    }
  }

  userMatchesIdentifier(user, identifier) {
    const normalizedIdentifier = normalizeText(identifier);
    if (!normalizedIdentifier) return false;

    const userCode = normalizeText(user.userCode ?? user.user_code ?? user.identifier);
    if (userCode && userCode === normalizedIdentifier) {
      return true;
    }

    const email = normalizeText(user.email);
    if (email && email === normalizedIdentifier) {
      return true;
    }

    const phone = normalizeText(user.phone);
    if (phone && phone === normalizedIdentifier && !isStudentRole(user.role)) {
      return true;
    }

    return false;
  }

  findManagedUser(identifier, schoolCode, preferredMobileRole = null) {
    const school = this.findSchoolByCode(schoolCode);
    const tenantKeys = new Set(
      [schoolCode, school?.loginCode]
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter(Boolean),
    );

    const matches = this.userAccounts.filter((user) => {
      const userSchool = String(user.schoolCode ?? "").trim().toUpperCase();
      return (
        (userSchool === "*" || tenantKeys.has(userSchool)) &&
        this.userMatchesIdentifier(user, identifier)
      );
    });

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

    return matches[0] || undefined;
  }

  findLinkedTeacher(user) {
    const userId = String(user.id ?? "").trim();
    if (!userId) return undefined;
    return this.teachers.find((teacher) => String(teacher.userId ?? "") === userId);
  }

  findLinkedStudent(user, schoolCode) {
    const school = String(schoolCode ?? "").trim().toUpperCase();
    const code = String(user.identifier ?? "").trim().toUpperCase();
    if (!school || !code) return undefined;
    return this.students.find((student) => {
      const studentSchool = String(student.schoolCode ?? "").trim().toUpperCase();
      const studentCode = String(student.studentCode ?? student.student_code ?? "").trim().toUpperCase();
      return studentSchool === school && studentCode === code;
    });
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
      identifier: user.identifier,
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
          // La fiche teacher ne doit jamais écraser users.id : sinon JWT.sub
          // devient teachers.id et GET /assignments résout 0 rôle live.
          id: base.id,
          publicId: base.publicId,
          identifier: base.identifier,
          contactId: base.contactId,
          schoolCode: base.schoolCode,
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
    return String(school?.loginCode ?? "").trim().toUpperCase();
  }

  matchesSchoolCode(schoolCode) {
    return Boolean(this.findSchoolByCode(schoolCode));
  }

  findSchoolByCode(schoolCode) {
    const { isLegacySchoolCodeFormat, normalizeSchoolCode } = require("../lib/schoolCodeV2");
    const normalizedCode = normalizeSchoolCode(schoolCode);
    if (!normalizedCode || isLegacySchoolCodeFormat(normalizedCode)) {
      return undefined;
    }
    return this.schools.find((school) => {
      const login = normalizeSchoolCode(school.loginCode);
      return login === normalizedCode;
    });
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
